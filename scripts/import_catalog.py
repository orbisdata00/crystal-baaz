#!/usr/bin/env python3
"""Reconcile the client workbook into reviewable storefront catalog data.

This importer uses only Python's standard library so the workbook can be read
without installing spreadsheet packages. It keeps source rows and raw details
in private reports, while emitting only normalized display data to the app.
Publication stays disabled until prices, stock, image rights, and copy are
reviewed.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import posixpath
import re
import unicodedata
import zipfile
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree as ET


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


class DescriptionTextExtractor(HTMLParser):
    """Convert workbook HTML descriptions to readable, plain storefront copy."""

    BLOCK_TAGS = {"address", "article", "blockquote", "br", "dd", "div", "dl", "dt", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "section", "tr", "ul"}
    IGNORED_TAGS = {"script", "style", "svg"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.ignored_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.IGNORED_TAGS:
            self.ignored_depth += 1
        elif not self.ignored_depth and tag in self.BLOCK_TAGS:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in self.IGNORED_TAGS and self.ignored_depth:
            self.ignored_depth -= 1
        elif not self.ignored_depth and tag in self.BLOCK_TAGS:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.ignored_depth:
            self.parts.append(data)


def storefront_description(description_html: str) -> str:
    """Keep client copy in the preview while flattening workbook HTML safely."""
    extractor = DescriptionTextExtractor()
    extractor.feed(description_html or "")
    extractor.close()
    return re.sub(r"\s+", " ", "".join(extractor.parts)).strip()


def column_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref).group(0)
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter) - ord("A") + 1
    return value - 1


def read_workbook(path: Path) -> dict[str, dict]:
    """Read worksheet values and row numbers directly from the XLSX package."""
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.attrib["Id"]: item.attrib["Target"] for item in relationships}
        strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            strings = ["".join(node.text or "" for node in item.findall(".//a:t", NS)) for item in shared.findall("a:si", NS)]

        sheets: dict[str, dict] = {}
        for sheet in workbook.findall("a:sheets/a:sheet", NS):
            name = sheet.attrib["name"]
            target = targets[sheet.attrib[f"{{{NS['r']}}}id"]]
            sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
            root = ET.fromstring(archive.read(sheet_path))
            xml_rows = root.findall(".//a:sheetData/a:row", NS)
            nonempty_rows: list[tuple[int, list[str]]] = []
            for xml_row in xml_rows:
                values: list[str] = []
                for cell in xml_row.findall("a:c", NS):
                    index = column_index(cell.attrib["r"])
                    raw_value = cell.find("a:v", NS)
                    inline = cell.find("a:is", NS)
                    value = "".join(node.text or "" for node in inline.findall(".//a:t", NS)) if inline is not None else (raw_value.text or "" if raw_value is not None else "")
                    if cell.attrib.get("t") == "s" and value:
                        value = strings[int(value)]
                    while len(values) <= index:
                        values.append("")
                    values[index] = value
                if any(value != "" for value in values):
                    nonempty_rows.append((int(xml_row.attrib.get("r", "0")), values))

            if not nonempty_rows:
                sheets[name] = {"headers": [], "rows": [], "state": sheet.attrib.get("state", "visible")}
                continue
            header_row_number, header_values = nonempty_rows[0]
            headers = [value.strip() for value in header_values]
            rows = []
            for row_number, values in nonempty_rows[1:]:
                item = {headers[index]: values[index].strip() for index in range(min(len(headers), len(values))) if headers[index]}
                item["_row"] = row_number
                if any(value not in ("", None) for key, value in item.items() if key != "_row"):
                    rows.append(item)
            sheets[name] = {"headers": headers, "rows": rows, "state": sheet.attrib.get("state", "visible"), "header_row": header_row_number}
        return sheets


def normalized_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def decimal_value(value: str):
    if value in (None, ""):
        return None
    try:
        parsed = Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        return None
    if not parsed.is_finite():
        return None
    # XLSX often stores currency values as binary-float artifacts such as
    # 1598.9999999999998. Round only that serialization noise, retaining cents.
    parsed = parsed.quantize(Decimal("0.01"))
    return int(parsed) if parsed == parsed.to_integral_value() else float(parsed)


def clean_number(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def split_tags(value: str) -> list[str]:
    return [part.strip() for part in re.split(r"[,;|\n]", value or "") if part.strip()]


def valid_image_url(value: str) -> bool:
    parsed = urlparse((value or "").strip())
    return parsed.scheme.lower() == "https" and bool(parsed.netloc)


def append_unique(values: list[str], incoming):
    if not incoming:
        return
    existing = {item.casefold() for item in values}
    for value in incoming:
        value = str(value).strip()
        if value and value.casefold() not in existing:
            values.append(value)
            existing.add(value.casefold())


def looks_like_planning_note(value: str) -> bool:
    text = (value or "").strip()
    folded = text.casefold()
    return (
        not text
        or len(text) > 100
        or folded.startswith(("all ", "add all", "based on", "i will", "making", "http://", "https://", "please "))
    )


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: list[dict], fields: list[str]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path, help="Path to New Website Product Catalog.xlsx")
    parser.add_argument("--output", type=Path, default=Path("reports/catalog"))
    parser.add_argument("--storefront-output", type=Path, default=Path("src/data/client-catalog.json"))
    args = parser.parse_args()
    if not args.workbook.is_file():
        raise SystemExit(f"Workbook not found: {args.workbook}")

    sheets = read_workbook(args.workbook)
    required_sheets = {"Listing", "Common", "Categories", "Category wise products- Tuhin", "SKUs in each category", "All Collections Count - Tuhin"}
    missing_sheets = required_sheets - set(sheets)
    if missing_sheets:
        raise SystemExit("Missing required sheets: " + ", ".join(sorted(missing_sheets)))

    issues: list[dict] = []
    def issue(kind, severity, sheet="", row="", handle="", sku="", details=""):
        issues.append({"issue": kind, "severity": severity, "sheet": sheet, "row": row, "handle": handle, "sku": sku, "details": details})

    listing = sheets["Listing"]["rows"]
    common = sheets["Common"]["rows"]
    category_rows = sheets["Categories"]["rows"]
    categorywise = sheets["Category wise products- Tuhin"]["rows"]
    curated = sheets["SKUs in each category"]["rows"]
    collection_rows = sheets["All Collections Count - Tuhin"]["rows"]
    if not collection_rows:
        raise SystemExit("The collection registry sheet is empty.")

    collections = []
    registry_by_key = {}
    for row in collection_rows:
        title = row.get("Collection Title", "").strip()
        handle = row.get("Collection Handle", "").strip()
        if not title or not handle:
            issue("invalid_collection_registry_row", "error", "All Collections Count - Tuhin", row.get("_row", ""), details=str(row))
            continue
        record = {
            "title": title,
            "handle": handle,
            "target_assignments": decimal_value(row.get("Products Assigned", "")),
            "source_row": row.get("_row"),
        }
        collections.append(record)
        registry_by_key[normalized_key(title)] = record
        registry_by_key[normalized_key(handle)] = record

    # Workbook spelling variants that point to an exact client registry entry.
    aliases = {
        "gift": "gifts", "anklets": "anklet", "diya": "diyas", "kavach": "kawachyantra",
        "kawach": "kawachyantra", "rudraksha kavach": "kawachyantra", "tiger eye": "tigers eye",
        "tiger's eye": "tigers eye", "tiger’s eye": "tigers eye", "cat's eye": "cats eye", "cat’s eye": "cats eye",
        "bracelet": "bracelets", "pendant": "pendants", "ring": "rings", "rashi": "zodiac",
        "bracelet": "bracelets", "pendant": "pendants", "ring": "rings", "rashi": "zodiac",
    }
    alias_map = {normalized_key(key): registry_by_key.get(normalized_key(target)) for key, target in aliases.items()}
    def resolve_collection(label: str):
        key = normalized_key(label)
        return registry_by_key.get(key) or alias_map.get(key)

    product_by_handle: dict[str, dict] = {}
    variants: list[dict] = []
    variant_by_identity: dict[tuple[str, str], dict] = {}
    sku_rows: dict[str, list[dict]] = defaultdict(list)
    sku_source_rows: dict[str, list[dict]] = defaultdict(list)
    attribute_columns = {
        "Crystal Category", "Jewellery", "Intention", "Puja", "Zodiac", "Festival",
        "Home Decor/Vastu", "Gift", "Malas & Jap Malas", "Shop by budget", "Kawach/Yantra",
        "Karungali", "Bracelets", "Best seller", "Crystal",
    }
    for row in listing:
        handle = row.get("Handle", "").strip()
        sku = row.get("Variant SKU", "").strip()
        if not handle:
            if sku or row.get("Title") or row.get("Image Src"):
                issue("listing_row_missing_handle", "error", "Listing", row.get("_row", ""), sku=sku, details="A populated product, variant, or image row has no handle.")
            continue
        product = product_by_handle.setdefault(handle, {
            "handle": handle, "title": "", "description_html": "", "tags": [], "keywords": [], "images": [],
            "source_rows": [], "title_values": [], "description_values": [], "variants": [],
            "collection_handles": [], "classifications": {}, "classification_values": defaultdict(list),
        })
        product["source_rows"].append(row.get("_row"))
        title = row.get("Title", "").strip()
        description = row.get("Body (HTML)", "").strip()
        if title and title not in product["title_values"]:
            product["title_values"].append(title)
        if description and description not in product["description_values"]:
            product["description_values"].append(description)
        append_unique(product["tags"], split_tags(row.get("Keywords/Tags", "")))
        image = row.get("Image Src", "").strip()
        if image and image not in product["images"]:
            product["images"].append(image)
        if not sku:
            continue

        price = decimal_value(row.get("Final price", ""))
        mrp = decimal_value(row.get("MRP", ""))
        stock = decimal_value(row.get("Stock", ""))
        grams = decimal_value(row.get("Variant Grams", ""))
        key = (handle, sku)
        variant = variant_by_identity.get(key)
        if variant is None:
            variant = {
                "id": f"{handle}:{sku}", "handle": handle, "sku": sku, "title": sku,
                "price": price, "compare_at_price": mrp, "stock_source_value": stock,
                "weight_grams_source_value": grams, "option_values": None,
                "source_sheet": "Listing", "source_row": row.get("_row"), "source_rows": [row.get("_row")],
                "publication_status": "preview_only", "common_source_row": None,
            }
            variant_by_identity[key] = variant
            variants.append(variant)
            product["variants"].append(variant)
            sku_rows[sku].append(variant)
        else:
            variant["source_rows"].append(row.get("_row"))
            for field, value, label in (("price", price, "Final price"), ("compare_at_price", mrp, "MRP")):
                existing = variant.get(field)
                if existing is not None and value is not None and existing != value:
                    issue("duplicate_variant_value_conflict", "review", "Listing", ",".join(map(str, variant["source_rows"])), handle, sku, f"Duplicate {handle}/{sku} rows disagree on {label}: {existing} vs {value}.")
                elif existing is None and value is not None:
                    variant[field] = value
            for field, value in (("stock_source_value", stock), ("weight_grams_source_value", grams)):
                if variant.get(field) is None and value is not None:
                    variant[field] = value
        sku_source_rows[sku].append({"handle": handle, "row": row.get("_row")})

    for handle, product in product_by_handle.items():
        product["title"] = product["title_values"][0] if product["title_values"] else ""
        product["description_html"] = product["description_values"][0] if product["description_values"] else ""
        if len(product["title_values"]) > 1:
            issue("conflicting_product_titles", "blocker", "Listing", ",".join(map(str, product["source_rows"])), handle, details=" | ".join(product["title_values"]))
        if len(product["description_values"]) > 1:
            issue("conflicting_product_descriptions", "review", "Listing", ",".join(map(str, product["source_rows"])), handle, details=f"{len(product['description_values'])} different descriptions appear for this handle.")
        product.pop("title_values")
        product.pop("description_values")

    # Common is a SKU keyed enrichment source. Listing values win; Common fills
    # blank fields only when the SKU and product handle identify one exact row.
    common_by_sku: dict[str, list[dict]] = defaultdict(list)
    for row in common:
        sku = row.get("Variant SKU", "").strip()
        if sku:
            common_by_sku[sku].append(row)
    raw_listing_sku_rows = sum(bool(row.get("Variant SKU", "").strip()) for row in listing)
    raw_listing_price_missing = sum(bool(row.get("Variant SKU", "").strip()) and (decimal_value(row.get("Final price", "")) is None or decimal_value(row.get("Final price", "")) <= 0) for row in listing)
    listing_skus = set(sku_rows)
    common_skus = set(common_by_sku)
    for sku in sorted(listing_skus - common_skus):
        issue("sku_missing_from_common", "review", "Listing", ",".join(str(row["row"]) for row in sku_source_rows[sku]), ",".join(sorted({item["handle"] for item in sku_rows[sku]})), sku, "SKU occurs in Listing but not Common.")
    for sku in sorted(common_skus - listing_skus):
        rows = common_by_sku[sku]
        issue("sku_missing_from_listing", "review", "Common", ",".join(str(row.get("_row", "")) for row in rows), ",".join(sorted({row.get("Handle", "") for row in rows})), sku, "Common SKU is not represented by a Listing product; it was not added as a product without a Listing handle record.")
    for sku in sorted(listing_skus & common_skus):
        listing_handles = {item["handle"] for item in sku_rows[sku]}
        common_handles = {row.get("Handle", "").strip() for row in common_by_sku[sku] if row.get("Handle", "").strip()}
        if len(common_by_sku[sku]) != 1:
            issue("duplicate_common_sku", "review", "Common", ",".join(str(row.get("_row", "")) for row in common_by_sku[sku]), ",".join(sorted(listing_handles | common_handles)), sku, f"Common has {len(common_by_sku[sku])} records for this SKU; enrichment is ambiguous.")
        if listing_handles != common_handles:
            issue("sku_handle_mismatch", "review", "Common", ",".join(str(row.get("_row", "")) for row in common_by_sku[sku]), ",".join(sorted(listing_handles | common_handles)), sku, f"Listing handles={sorted(listing_handles)}; Common handles={sorted(common_handles)}.")
        if len(common_by_sku[sku]) != 1:
            continue
        source = common_by_sku[sku][0]
        source_handle = source.get("Handle", "").strip()
        variant = variant_by_identity.get((source_handle, sku))
        product = product_by_handle.get(source_handle)
        if not variant or not product:
            continue
        variant["common_source_row"] = source.get("_row")
        for field, source_field in (("price", "Final price"), ("compare_at_price", "MRP"), ("stock_source_value", "Stock"), ("weight_grams_source_value", "Variant Grams")):
            if variant.get(field) is None:
                variant[field] = decimal_value(source.get(source_field, ""))
        if not product["title"] and source.get("Title", "").strip():
            product["title"] = source["Title"].strip()
            issue("title_filled_from_common", "info", "Common", source.get("_row", ""), source_handle, sku, "Listing title was blank; the exact matching Common SKU title was used.")
        if not product["description_html"] and source.get("Body (HTML)", "").strip():
            product["description_html"] = source["Body (HTML)"].strip()
            issue("description_filled_from_common", "info", "Common", source.get("_row", ""), source_handle, sku, "Listing description was blank; the exact matching Common SKU description was used.")
        common_image = source.get("Image Src", "").strip()
        if common_image and common_image not in product["images"]:
            product["images"].append(common_image)
        append_unique(product["keywords"], split_tags(source.get("Keywords", "")))
        for column in attribute_columns:
            value = source.get(column, "").strip()
            if not value or value.casefold() in {"no", "n/a", "na", "-"}:
                continue
            if looks_like_planning_note(value):
                issue("planning_rule_not_rendered", "info", "Common", source.get("_row", ""), source_handle, sku, f"{column}: {value}")
                continue
            product["classification_values"][column].append(value)

    # Keyword tags are SKU scoped; keep all nonempty keywords for search.
    keyword_rows = sheets.get("Keywords", {}).get("rows", [])
    keyword_skus = set()
    for row in keyword_rows:
        sku = row.get("Variant SKU", "").strip()
        if not sku:
            continue
        keyword_skus.add(sku)
        targets = sku_rows.get(sku, [])
        if not targets:
            issue("keyword_sku_not_in_listing", "review", "Keywords", row.get("_row", ""), sku=sku, details="Keyword row has no matching Listing SKU.")
            continue
        target_handles = {variant["handle"] for variant in targets}
        if len(target_handles) != 1:
            issue("keyword_sku_ambiguous", "review", "Keywords", row.get("_row", ""), ",".join(sorted(target_handles)), sku, "Keywords cannot be assigned to one product because the SKU maps to multiple Listing handles.")
            continue
        product = product_by_handle[next(iter(target_handles))]
        append_unique(product["tags"], split_tags(row.get("Tags", "")))

    # Categories contains product-level classifications; apply only concrete
    # values and leave prose rules out of customer-facing fields.
    for row in category_rows:
        handle = row.get("Handle", "").strip()
        product = product_by_handle.get(handle)
        if not product:
            continue
        if not product["title"] and row.get("Title", "").strip():
            product["title"] = row["Title"].strip()
            issue("title_filled_from_categories", "info", "Categories", row.get("_row", ""), handle, row.get("Variant SKU", ""), "Listing and exact Common SKU titles were blank; Categories title was used.")
        category_sku = row.get("Variant SKU", "").strip()
        if category_sku and category_sku not in {variant["sku"] for variant in product["variants"]}:
            issue("category_sku_not_on_product", "review", "Categories", row.get("_row", ""), handle, category_sku, "The category row SKU does not belong to this Listing handle.")
        for column in sheets["Categories"]["headers"]:
            if not column or column in {"Handle", "Title", "Variant SKU"}:
                continue
            value = row.get(column, "").strip()
            if not value or value.casefold() in {"no", "n/a", "na", "-"} or looks_like_planning_note(value):
                continue
            product["classification_values"][column].append(value)

    duplicate_skus = {}
    for sku, sku_variants in sku_rows.items():
        distinct_handles = {variant["handle"] for variant in sku_variants}
        if len(distinct_handles) > 1:
            duplicate_skus[sku] = sku_variants
            issue("duplicate_sku", "blocker", "Listing", ",".join(str(row["row"]) for row in sku_source_rows[sku]), ",".join(sorted(distinct_handles)), sku, f"SKU occurs across {len(distinct_handles)} product handles; variant purchases are blocked until this is resolved.")
            for variant in sku_variants:
                variant["publication_status"] = "blocked_duplicate_sku"
        elif len(sku_source_rows[sku]) > 1:
            issue("duplicate_listing_sku_rows_same_handle", "review", "Listing", ",".join(str(row["row"]) for row in sku_source_rows[sku]), next(iter(distinct_handles)), sku, "Repeated SKU rows were merged into one variant for the same product handle.")

    for product in product_by_handle.values():
        for column, values in product["classification_values"].items():
            unique_values = list(dict.fromkeys(value.strip() for value in values if value.strip()))
            if len(unique_values) > 1:
                issue("conflicting_product_classification", "review", "Categories/Common", ",".join(map(str, product["source_rows"])), product["handle"], details=f"{column}: {unique_values}")
            if unique_values:
                product["classifications"][column] = unique_values
        product["variant_skus"] = list(dict.fromkeys(variant["sku"] for variant in product["variants"]))
        product["has_ambiguous_variant_options"] = len(product["variants"]) > 1
        if product["has_ambiguous_variant_options"]:
            issue("variant_options_not_supplied", "review", "Listing", ",".join(str(v["source_row"]) for v in product["variants"]), product["handle"], details=f"{len(product['variants'])} distinct SKUs exist; workbook provides SKUs but no customer option names or values.")
        if not product["title"]:
            issue("missing_product_title", "blocker", "Listing", ",".join(map(str, product["source_rows"])), product["handle"], details="No Listing, exact matching Common, or Categories title is available; the UI uses a reviewable handle fallback.")
        if not product["description_html"]:
            issue("missing_product_description", "review", "Listing", ",".join(map(str, product["source_rows"])), product["handle"], details="No Listing or exact SKU-matched Common description is available.")
        else:
            issue("description_copy_needs_client_review", "review", "Listing/Common", ",".join(map(str, product["source_rows"])), product["handle"], details="Workbook copy is rendered as sanitized plain text; review claims before publishing.")
        if not product["images"]:
            issue("missing_product_image", "review", "Listing/Common", ",".join(map(str, product["source_rows"])), product["handle"], details="No image URL is available.")
        for url in product["images"]:
            if not valid_image_url(url):
                issue("invalid_or_non_https_image_url", "review", "Listing/Common", ",".join(map(str, product["source_rows"])), product["handle"], details=url)
        product["images"] = list(dict.fromkeys(url for url in product["images"] if valid_image_url(url)))
        product["has_usable_image"] = bool(product["images"])
        for variant in product["variants"]:
            sku = variant["sku"]
            price = variant["price"]
            mrp = variant["compare_at_price"]
            stock = variant["stock_source_value"]
            grams = variant["weight_grams_source_value"]
            variant["price"] = clean_number(price)
            variant["compare_at_price"] = clean_number(mrp)
            variant["weight_grams_source_value"] = clean_number(grams)
            variant["availability"] = "unknown"
            variant["available"] = None
            variant["can_purchase"] = bool(price is not None and price > 0 and sku not in duplicate_skus)
            if price is None or price <= 0:
                issue("missing_or_invalid_final_price", "blocker", "Listing/Common", variant.get("source_row", ""), product["handle"], sku, "No positive final price exists in Listing or its exact matching Common row; this variant is blocked from the preview cart.")
            if stock == 200:
                issue("placeholder_stock_value", "review", "Listing/Common", variant.get("source_row", ""), product["handle"], sku, "Workbook stock is 200; shown as unknown availability, not live inventory.")
            elif stock is None or stock < 0:
                issue("missing_or_invalid_stock", "review", "Listing/Common", variant.get("source_row", ""), product["handle"], sku, "Availability cannot be verified from this value.")
            if grams == 0:
                issue("zero_or_placeholder_weight", "review", "Listing/Common", variant.get("source_row", ""), product["handle"], sku, "Workbook weight is 0 grams; weight is omitted from customer-facing fields.")
            elif grams is None or grams < 0:
                issue("missing_or_invalid_weight", "review", "Listing/Common", variant.get("source_row", ""), product["handle"], sku, "Weight is omitted until a valid value is provided.")
            if mrp is not None and price is not None and mrp < price:
                issue("compare_at_price_below_final_price", "review", "Listing/Common", variant.get("source_row", ""), product["handle"], sku, "MRP is below final price; confirm the source values.")
        product["source_rows"] = list(dict.fromkeys(product["source_rows"]))

    # Exact and curated assignments only. Prose such as "all products" remains
    # unresolved so a developer cannot silently expand the import scope.
    membership_sources: dict[tuple[str, str], set[str]] = defaultdict(set)
    membership_source_rows: dict[tuple[str, str], list[str]] = defaultdict(list)
    curated_group_members: dict[str, set[str]] = defaultdict(set)
    curated_group_unresolved: Counter = Counter()
    curated_orphan_skus: set[str] = set()
    curated_group_records: dict[str, dict] = {}
    curated_group_ids: dict[str, str] = {}
    for column in sheets["SKUs in each category"]["headers"]:
        if not column:
            continue
        collection = resolve_collection(column)
        if collection:
            continue
        group_id = "group-" + re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", normalized_key(column))).strip("-")
        curated_group_ids[normalized_key(column)] = group_id
        curated_group_records[group_id] = {"id": group_id, "title": column, "collection_handle": None, "product_handles": []}
        issue("curated_navigation_group_not_in_registry", "review", "SKUs in each category", details=f"{column} is a workbook navigation group without a handle in the 111-collection registry; it is kept as a separate preview group.")

    def assign(handle: str, collection: dict, source: str, row_number, sku=""):
        if handle not in product_by_handle:
            issue("membership_handle_not_in_listing", "blocker", source.split(":")[0], row_number, handle, sku, f"Collection {collection['title']} references a handle not present in Listing.")
            return
        key = (handle, collection["handle"])
        membership_sources[key].add(source)
        membership_source_rows[key].append(str(row_number))

    for row in categorywise:
        handle = row.get("Handle", "").strip()
        for column in [key for key in row if key.startswith("Category ")]:
            label = row.get(column, "").strip()
            if not label:
                continue
            collection = resolve_collection(label)
            if collection:
                assign(handle, collection, f"Category wise products- Tuhin:{column}", row.get("_row"), row.get("Variant SKU", ""))
            else:
                issue("unmapped_collection_label", "review", "Category wise products- Tuhin", row.get("_row", ""), handle, row.get("Variant SKU", ""), f"{column}={label}")

    for row in curated:
        for column, label in row.items():
            if column == "_row" or not label.strip():
                continue
            collection = resolve_collection(column)
            if not re.fullmatch(r"[A-Za-z]{1,6}[-/]?[A-Za-z0-9]*\d+[A-Za-z0-9-]*", label.strip()):
                issue("curated_non_sku_entry", "info", "SKUs in each category", row.get("_row", ""), sku=label.strip(), details=f"Header {column!r} contains a planning label rather than a SKU; it was not imported.")
                continue
            candidate_rows = sku_rows.get(label.strip(), [])
            candidate_handles = {item["handle"] for item in candidate_rows}
            if not candidate_rows:
                curated_orphan_skus.add(label.strip())
                if not collection:
                    curated_group_unresolved[column] += 1
                issue("curated_sku_not_in_listing", "blocker", "SKUs in each category", row.get("_row", ""), sku=label.strip(), details=f"Header {column!r} references a SKU not present in Listing.")
            elif len(candidate_handles) > 1 or label.strip() in duplicate_skus:
                if not collection:
                    curated_group_unresolved[column] += 1
                issue("curated_sku_has_duplicate_mapping", "blocker", "SKUs in each category", row.get("_row", ""), ",".join(sorted(candidate_handles)), label.strip(), f"Header {column!r} cannot be assigned until the duplicate SKU is resolved.")
            else:
                handle = next(iter(candidate_handles))
                if collection:
                    assign(handle, collection, f"SKUs in each category:{column}", row.get("_row"), label.strip())
                else:
                    curated_group_members[curated_group_ids[normalized_key(column)]].add(handle)

    for group_id, record in curated_group_records.items():
        record["product_handles"] = sorted(curated_group_members[group_id])
        record["explicit_product_count"] = len(record["product_handles"])
        record["unresolved_sku_count"] = curated_group_unresolved[next(column for column, key in curated_group_ids.items() if key == group_id)]

    categories_header = sheets["Categories"]["headers"]
    base_columns = {"Handle", "Title", "Variant SKU"}
    for row in category_rows:
        handle = row.get("Handle", "").strip()
        for column in categories_header:
            if not column or column in base_columns:
                continue
            value = row.get(column, "").strip()
            if not value or value.casefold() in {"no", "n/a", "na", "-"}:
                continue
            column_collection = resolve_collection(column)
            if value.casefold() == "yes":
                if column_collection:
                    assign(handle, column_collection, f"Categories:{column}=Yes", row.get("_row"), row.get("Variant SKU", ""))
                else:
                    issue("category_flag_without_registry_collection", "review", "Categories", row.get("_row", ""), handle, row.get("Variant SKU", ""), f"{column}=Yes")
                continue
            value_collection = resolve_collection(value)
            if value_collection:
                assign(handle, value_collection, f"Categories:{column}", row.get("_row"), row.get("Variant SKU", ""))
            elif column == "Jewellery" and value:
                issue("unmapped_jewellery_form", "review", "Categories", row.get("_row", ""), handle, row.get("Variant SKU", ""), f"Jewellery={value}")
            else:
                issue("category_rule_or_label_pending_review", "review", "Categories", row.get("_row", ""), handle, row.get("Variant SKU", ""), f"{column}={value}")

    memberships = []
    actual_counts = Counter()
    for (handle, collection_handle), sources in sorted(membership_sources.items()):
        collection = next(item for item in collections if item["handle"] == collection_handle)
        membership = {
            "product_handle": handle, "collection_handle": collection_handle,
            "collection_title": collection["title"], "sources": sorted(sources),
            "source_rows": sorted(set(membership_source_rows[(handle, collection_handle)]), key=lambda item: int(item) if item.isdigit() else 0),
        }
        memberships.append(membership)
        actual_counts[collection_handle] += 1
        product_by_handle[handle]["collection_handles"].append(collection_handle)

    for product in product_by_handle.values():
        product["collection_handles"] = sorted(set(product["collection_handles"]))
        product["group_ids"] = sorted(group_id for group_id, members in curated_group_members.items() if product["handle"] in members)
        product["publishable"] = False
        reasons = []
        if not product["title"]: reasons.append("missing_title")
        if not product["variants"]: reasons.append("missing_sku_variant")
        if any(variant["price"] is None or variant["price"] <= 0 for variant in product["variants"]): reasons.append("missing_or_invalid_price")
        if product["has_ambiguous_variant_options"]: reasons.append("variant_options_not_supplied")
        if any(variant["stock_source_value"] == 200 for variant in product["variants"]): reasons.append("placeholder_inventory")
        if any(variant["weight_grams_source_value"] in (None, 0) for variant in product["variants"]): reasons.append("weight_unverified")
        if any(variant["sku"] in duplicate_skus for variant in product["variants"]): reasons.append("duplicate_sku")
        if not product["images"]: reasons.append("missing_image")
        if product["description_html"]: reasons.append("description_copy_needs_review")
        product["unresolved_reasons"] = sorted(set(reasons))

    # Collection registry validation and assignment count reconciliation.
    duplicate_handles = [handle for handle, count in Counter(item["handle"] for item in collections).items() if count > 1]
    duplicate_titles = [title for title, count in Counter(item["title"].casefold() for item in collections).items() if count > 1]
    for handle in duplicate_handles:
        issue("duplicate_collection_handle", "blocker", "All Collections Count - Tuhin", details=handle)
    for title in duplicate_titles:
        issue("duplicate_collection_title", "review", "All Collections Count - Tuhin", details=title)
    for collection in collections:
        actual = actual_counts[collection["handle"]]
        target = collection["target_assignments"]
        collection["actual_explicit_assignments"] = actual
        collection["count_difference"] = (actual - target) if target is not None else None
        if target is not None and actual != target:
            issue("collection_assignment_count_mismatch", "review", "All Collections Count - Tuhin", collection.get("source_row", ""), details=f"{collection['title']} ({collection['handle']}): target={target}, explicit assignments={actual}.")
        collection.pop("source_row", None)

    common_final_prices_missing = sum(1 for row in common if row.get("Variant SKU") and decimal_value(row.get("Final price", "")) is None)
    listing_price_missing = sum(1 for variant in variants if variant["price"] is None or variant["price"] <= 0)
    common_image_rows = [row for row in common if row.get("Image Src", "").strip()]
    common_stock = Counter(row.get("Stock", "").strip() for row in common if row.get("Variant SKU"))
    common_weights = Counter(row.get("Variant Grams", "").strip() for row in common if row.get("Variant SKU"))
    common_handle_set = {row.get("Handle", "").strip() for row in common if row.get("Handle", "").strip()}
    listing_handle_set = set(product_by_handle)
    categories_handle_set = {row.get("Handle", "").strip() for row in category_rows if row.get("Handle", "").strip()}
    report = []
    def metric(key, count, severity, details): report.append({"metric": key, "count": count, "severity": severity, "details": details})
    metric("workbook_sheets", len(sheets), "info", ", ".join(f"{name} ({sheet['state']})" for name, sheet in sheets.items()))
    metric("listing_data_rows", len(listing), "info", "Repeated handles are media/variant rows; rows were grouped by product handle.")
    metric("listing_unique_product_handles", len(product_by_handle), "info", "Grouped from Listing.Handle.")
    metric("listing_sku_source_rows", raw_listing_sku_rows, "info", "Raw SKU-bearing rows in Listing, before duplicate rows for one handle/SKU are merged.")
    metric("listing_handle_sku_variants", len(variants), "info", "Unique product-handle/SKU variant identities after merging repeated rows.")
    metric("listing_unique_skus", len(sku_rows), "info", "Unique SKU values in Listing.")
    metric("listing_duplicate_sku_values", len(duplicate_skus), "blocker", "Resolve duplicate SKU values before Shopify import.")
    metric("listing_skus_missing_price", listing_price_missing, "blocker", "These SKU rows have no positive final price.")
    metric("common_skus_missing_price_and_mrp", common_final_prices_missing, "blocker", "Counted from Common rows without a final price; MRP also requires review.")
    metric("listing_image_references", sum(1 for row in listing if row.get("Image Src", "").strip()), "info", "Source image references grouped by handle; remote reachability and rights were not checked.")
    metric("listing_unique_image_urls", len({row.get("Image Src", "").strip() for row in listing if row.get("Image Src", "").strip()}), "info", "Duplicate image URLs are not repeated in product galleries.")
    metric("product_images_not_fetched_or_rights_checked", sum(1 for product in product_by_handle.values() if product["images"]), "review", "Image URLs come from the client workbook; remote reachability, usage rights, and alt text still need approval.")
    metric("products_without_listing_category_row", len(listing_handle_set - categories_handle_set), "review", ", ".join(sorted(listing_handle_set - categories_handle_set)))
    metric("category_handles_not_in_common", len(categories_handle_set - common_handle_set), "review", "Category assignments need SKU/product reconciliation against Common.")
    metric("common_handles_not_in_listing", len(common_handle_set - listing_handle_set), "blocker", "Common records without a Listing product handle need reconciliation.")
    metric("common_stock_values", len(common_stock), "blocker", json.dumps(dict(common_stock), ensure_ascii=False))
    metric("common_weight_values_grams", len(common_weights), "blocker", json.dumps(dict(common_weights), ensure_ascii=False))
    metric("collections_in_registry", len(collections), "info", "Workbook target assignments may overlap across collections.")
    metric("explicit_product_collection_assignments", len(memberships), "info", "Exact collection labels and unique curated SKU references only; prose rules are not auto-applied.")
    metric("products_blocked_from_publication", sum(1 for product in product_by_handle.values() if product["unresolved_reasons"]), "blocker", "Price, stock, weight, SKU/variant options, image rights, and content require review before live publishing.")
    issue_counts = Counter(item["issue"] for item in issues)
    for kind, count in sorted(issue_counts.items()):
        metric(f"issue:{kind}", count, next((item["severity"] for item in issues if item["issue"] == kind), "review"), "See unresolved-items.csv for source rows and details.")

    # Preview pages use actual workbook product copy. Publication stays blocked
    # in the validation outputs until the client reviews the claims and content.
    storefront_products = []
    for product in sorted(product_by_handle.values(), key=lambda item: item["title"].casefold()):
        priced_variants = [variant for variant in product["variants"] if variant["price"] is not None and variant["price"] > 0]
        lowest_variant = min(priced_variants, key=lambda item: item["price"], default=None)
        price = lowest_variant["price"] if lowest_variant else None
        compare_at = lowest_variant["compare_at_price"] if lowest_variant else None
        category_titles = [next((collection["title"] for collection in collections if collection["handle"] == handle), handle) for handle in product["collection_handles"]]
        description = storefront_description(product["description_html"])
        storefront_quality = [reason for reason in product["unresolved_reasons"] if reason != "description_copy_needs_review"]
        product_type = next((value for key in ("Jewellery", "Crystal Category", "Malas & Jap Malas", "Puja", "Home Decor/Vastu", "Kawach/Yantra") for value in product["classifications"].get(key, [])), "")
        attributes = [
            {"label": label, "value": ", ".join(values)}
            for label, values in product["classifications"].items()
            if values
        ]
        storefront_variants = []
        for variant in product["variants"]:
            storefront_variants.append({
                "id": variant["id"],
                "sku": variant["sku"],
                "title": variant["title"],
                "selectedOptions": variant["option_values"] or [],
                "price": variant["price"],
                "compareAt": variant["compare_at_price"],
                "weightGrams": variant["weight_grams_source_value"] if variant["weight_grams_source_value"] and variant["weight_grams_source_value"] > 0 else None,
                "availability": "unknown",
                "available": None,
                "canPurchase": variant["can_purchase"],
            })
        storefront_products.append({
            "id": product["handle"], "handle": product["handle"], "title": product["title"] or product["handle"].replace("-", " ").title(),
            "type": product_type, "productType": product_type,
            "category": product_type or (category_titles[0] if category_titles else ""),
            "primaryCategory": product_type or (category_titles[0] if category_titles else ""),
            "tags": product["tags"], "keywords": product["keywords"],
            "attributes": attributes,
            "image": product["images"][0] if product["images"] else "", "images": product["images"],
            "price": price, "compareAt": compare_at,
            "priceStatus": "missing" if not priced_variants else "partial" if len(priced_variants) < len(product["variants"]) else "complete",
            "description": description,
            "collectionHandles": product["collection_handles"], "collectionTitles": category_titles, "groupIds": product["group_ids"],
            "skuCount": len(product["variants"]), "previewOnly": True, "canPurchase": False,
            "availability": "unknown", "seo": None,
            "variants": storefront_variants,
            "dataQuality": storefront_quality,
        })

    # Build menu links from workbook labels and the 111-collection registry.
    main_headers = sheets.get("MAIN", {}).get("rows", [])
    structure_rows = sheets.get("Structure", {}).get("rows", [])
    sheet10_rows = sheets.get("Sheet10", {}).get("rows", [])
    zodiac = [
        {"name": "Aries", "hindi": "मेष", "symbol": "♈"}, {"name": "Taurus", "hindi": "वृषभ", "symbol": "♉"},
        {"name": "Gemini", "hindi": "मिथुन", "symbol": "♊"}, {"name": "Cancer", "hindi": "कर्क", "symbol": "♋"},
        {"name": "Leo", "hindi": "सिंह", "symbol": "♌"}, {"name": "Virgo", "hindi": "कन्या", "symbol": "♍"},
        {"name": "Libra", "hindi": "तुला", "symbol": "♎"}, {"name": "Scorpio", "hindi": "वृश्चिक", "symbol": "♏"},
        {"name": "Sagittarius", "hindi": "धनु", "symbol": "♐"}, {"name": "Capricorn", "hindi": "मकर", "symbol": "♑"},
        {"name": "Aquarius", "hindi": "कुंभ", "symbol": "♒"}, {"name": "Pisces", "hindi": "मीन", "symbol": "♓"},
    ]

    group_aliases = {
        "121mukhi": "rudraksha121mukhi", "gemsbracelets": "gembracelets",
        "rudrakshabracelets": "rudrakshabracelet",
    }
    def menu_item(label, kind="collection", key=None):
        collection = resolve_collection(label)
        if collection:
            return {"label": label, "kind": "collection", "target": collection["handle"], "collectionTitle": collection["title"]}
        group_id = curated_group_ids.get(normalized_key(label)) or curated_group_ids.get(group_aliases.get(normalized_key(label), ""))
        if group_id:
            return {"label": label, "kind": "group", "target": group_id}
        return {"label": label, "kind": kind if kind != "collection" else "search", "target": key or label}

    def column_values(sheet_name, column):
        sheet = sheets.get(sheet_name, {})
        return [row.get(column, "").strip() for row in sheet.get("rows", []) if row.get(column, "").strip()]

    all_main = [row.get("Main Categories", "").strip() for row in main_headers]
    all_main = [value for value in all_main if value]
    if not all_main:
        all_main = ["Best Seller", "New Arrivals", "Rashi | Zodiac", "Bracelets", "Rudraksha", "Crystal", "Puja", "Remedy"]
    # The source sheet uses multiple adjacent columns for editorial notes and
    # rules. Use only the actual category columns and do not turn prose notes
    # or third-party URLs into storefront links.
    groups = [
        {"label": "Best Seller", "kind": "pending", "items": [menu_item(row.get("Rashi Rings", "")) for row in sheet10_rows if row.get("Rashi Rings", "").strip()]},
        {"label": "New Arrivals", "kind": "pending", "items": [menu_item(label) for label in column_values("Structure", "New Arrivals") if not label.lower().startswith(("all ", "http"))]},
        {"label": "Rashi | Zodiac", "kind": "zodiac", "items": [menu_item("Rashi bracelets", "search", "rashi bracelet"), menu_item("Rashi Rings"), menu_item("Rashi Pendants"), menu_item("Yantra"), menu_item("Pen")] + [menu_item(sign["name"], "zodiac", sign["name"]) for sign in zodiac]},
        {"label": "Bracelets", "kind": "collection", "target": "bracelets", "items": [menu_item(label) for label in column_values("Structure", "Bracelets") if resolve_collection(label)]},
        {"label": "Rudraksha", "kind": "collection", "target": "rudraksha", "items": [menu_item(label) for label in column_values("MAIN", "Rudraksha") if label]},
        {"label": "Crystal", "kind": "collection", "target": "crystal", "items": [menu_item(label) for label in column_values("Structure", "Crystal") if resolve_collection(label)], "formItems": [menu_item(label) for label in column_values("MAIN", "Crystal") if resolve_collection(label)]},
        {"label": "Puja", "kind": "collection", "target": "puja", "items": [menu_item(label) for label in column_values("MAIN", "Puja") if resolve_collection(label)]},
        {"label": "Remedy", "kind": "collection", "target": "remedy", "items": [menu_item(label) for label in ["Money", "Focus", "Confidence", "Love", "Nazar", "Business Losses"]]},
    ]
    groups[0]["items"] = [menu_item(row.get("Rashi Rings", "")) for row in sheet10_rows if row.get("Rashi Rings", "").strip() and row.get("Rashi Rings", "").strip().casefold() not in {"rashi rings", "best seller"}]
    # Keep only unique workbook menu labels. Duplicate links are confusing in mega menus.
    for group in groups:
        seen = set()
        items = []
        for item in group["items"]:
            key = normalized_key(item["label"])
            if key and key not in seen:
                seen.add(key)
                items.append(item)
        group["items"] = items

    storefront_data = {
        "source": args.workbook.name,
        "catalogStatus": "preview_only",
        "publicationReady": False,
        "collections": collections,
        "groups": sorted(curated_group_records.values(), key=lambda item: item["title"].casefold()),
        "navigation": groups,
        "zodiacSigns": zodiac,
        "products": storefront_products,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output / "canonical-products.json", sorted(product_by_handle.values(), key=lambda item: item["handle"]))
    write_json(args.output / "canonical-variants.json", variants)
    write_json(args.output / "canonical-collections.json", collections)
    write_json(args.output / "canonical-memberships.json", memberships)
    write_json(args.output / "canonical-navigation-groups.json", sorted(curated_group_records.values(), key=lambda item: item["title"].casefold()))
    write_csv(args.output / "catalog-validation-report.csv", report, ["metric", "count", "severity", "details"])
    write_csv(args.output / "unresolved-items.csv", issues, ["issue", "severity", "sheet", "row", "handle", "sku", "details"])
    write_json(args.output / "catalog-quality-report.json", {
        "source": args.workbook.name,
        "catalogStatus": "preview_only",
        "publicationReady": False,
        "summary": {
            "products": len(product_by_handle),
            "listingSkuSourceRows": raw_listing_sku_rows,
            "listingHandleSkuVariants": len(variants),
            "distinctSkus": len(sku_rows),
            "collections": len(collections),
            "explicitProductCollectionAssignments": len(memberships),
            "productImageReferences": sum(len(product["images"]) for product in product_by_handle.values()),
            "uniqueProductImageUrls": len({url for product in product_by_handle.values() for url in product["images"]}),
            "productsWithDescription": sum(bool(storefront_description(product["description_html"])) for product in product_by_handle.values()),
            "productsMissingDescription": sum(not bool(storefront_description(product["description_html"])) for product in product_by_handle.values()),
            "productsWithUsableImage": sum(product["has_usable_image"] for product in product_by_handle.values()),
            "productsMissingImage": sum(not product["has_usable_image"] for product in product_by_handle.values()),
            "productsMissingTitle": sum(not product["title"] for product in product_by_handle.values()),
            "productsWithNoPricedVariant": sum(not any(variant["price"] is not None and variant["price"] > 0 for variant in product["variants"]) for product in product_by_handle.values()),
            "productsWithAtLeastOneUnpricedVariant": sum(any(variant["price"] is None or variant["price"] <= 0 for variant in product["variants"]) for product in product_by_handle.values()),
            "variantsWithPrice": sum(variant["price"] is not None and variant["price"] > 0 for variant in variants),
            "variantsMissingPrice": listing_price_missing,
            "rawListingSkuRowsMissingPrice": raw_listing_price_missing,
            "productsWithTagsOrKeywords": sum(bool(product["tags"] or product["keywords"]) for product in product_by_handle.values()),
            "commonSkusNotInListing": len(common_skus - listing_skus),
            "keywordSkusNotInListing": len({row.get("Variant SKU", "").strip() for row in keyword_rows if row.get("Variant SKU", "").strip()} - listing_skus),
            "curatedSkuReferencesNotInListing": len(curated_orphan_skus),
            "duplicateSkuValues": len(duplicate_skus),
            "variantsBlockedForDuplicateSku": sum(1 for variant in variants if variant["sku"] in duplicate_skus),
            "collectionCountDiscrepancies": sum(collection["count_difference"] not in (None, 0) for collection in collections),
            "blockedProducts": sum(bool(product["unresolved_reasons"]) for product in product_by_handle.values()),
            "seoFieldsAvailable": False,
        },
        "metrics": report,
        "issues": issues,
    })
    write_json(args.storefront_output, storefront_data)

    top_issues = sorted(issue_counts.items(), key=lambda item: (-item[1], item[0]))[:20]
    summary_rows = "".join(f"<tr><td>{html.escape(kind)}</td><td>{count}</td></tr>" for kind, count in top_issues)
    summary = f"""<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Crystal Baaz catalog validation</title>
    <style>body{{max-width:1040px;margin:40px auto;padding:0 20px;font:16px/1.55 system-ui;color:#28332d;background:#f7f6f1}}h1,h2{{font-family:Georgia,serif;font-weight:400}}.notice{{padding:16px 20px;background:#efe9df;border-left:3px solid #8e7253}}.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}}.stats div,table{{background:#fff;border:1px solid #e4e0d7;padding:13px}}.stats b{{display:block;font-size:24px}}table{{width:100%;border-collapse:collapse}}td,th{{padding:9px 12px;text-align:left;border-bottom:1px solid #e8e5dc}}a{{color:#455d49}}</style>
    <h1>Crystal Baaz catalog validation</h1><p class=\"notice\">Preview report only. No products have been imported or published. Price, inventory, weight, variant options, image rights, and descriptions require review.</p>
    <div class=\"stats\"><div><b>{len(product_by_handle):,}</b>product handles</div><div><b>{len(sku_rows):,}</b>distinct Listing SKUs</div><div><b>{len(collections):,}</b>collections</div><div><b>{len(memberships):,}</b>explicit assignments</div></div>
    <h2>Most common unresolved items</h2><table><thead><tr><th>Issue</th><th>Rows</th></tr></thead><tbody>{summary_rows}</tbody></table>
    <p><a href=\"catalog-validation-report.csv\">Aggregate validation CSV</a> · <a href=\"unresolved-items.csv\">Row-level exceptions CSV</a></p></html>"""
    (args.output / "import-preview.html").write_text(summary, encoding="utf-8")

    print(json.dumps({
        "sheets": len(sheets), "product_handles": len(product_by_handle), "listing_sku_source_rows": raw_listing_sku_rows, "handle_sku_variants": len(variants),
        "unique_skus": len(sku_rows), "duplicate_skus": len(duplicate_skus), "missing_prices": listing_price_missing,
        "collections": len(collections), "explicit_memberships": len(memberships), "issues": len(issues),
        "output": str(args.output), "storefront_output": str(args.storefront_output),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
