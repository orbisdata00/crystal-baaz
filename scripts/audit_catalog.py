#!/usr/bin/env python3
"""Compare every workbook product and mapping record with the storefront JSON."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from import_catalog import decimal_value, normalized_key, read_workbook, split_tags, storefront_description, valid_image_url, write_csv, write_json


ATTRIBUTE_COLUMNS = {
    "Crystal Category", "Jewellery", "Intention", "Puja", "Zodiac", "Festival",
    "Home Decor/Vastu", "Gift", "Malas & Jap Malas", "Shop by budget", "Kawach/Yantra",
    "Karungali", "Bracelets", "Best seller", "Crystal",
}


def is_planning_note(value: str) -> bool:
    text = (value or "").strip()
    folded = text.casefold()
    return not text or len(text) > 100 or folded.startswith(("all ", "add all", "based on", "i will", "making", "http://", "https://", "please "))


def json_value(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def unique_casefold(values):
    """Match the importer's case-insensitive set semantics while preserving source order."""
    result = []
    seen = set()
    for value in values:
        key = str(value).casefold()
        if key not in seen:
            result.append(value)
            seen.add(key)
    return result


def status(expected, actual, source_complete=True):
    if not source_complete:
        return "SOURCE INCOMPLETE"
    if actual is None or actual == "":
        return "MISSING"
    if expected != actual:
        return "MISMATCH"
    return "MATCH"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--catalog", type=Path, default=Path("src/data/client-catalog.json"))
    parser.add_argument("--output", type=Path, default=Path("reports/catalog"))
    args = parser.parse_args()
    sheets = read_workbook(args.workbook)
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))

    listing = sheets["Listing"]["rows"]
    common = sheets["Common"]["rows"]
    category_rows = sheets["Categories"]["rows"]
    categorywise = sheets["Category wise products- Tuhin"]["rows"]
    curated = sheets["SKUs in each category"]["rows"]
    registry_rows = sheets["All Collections Count - Tuhin"]["rows"]

    registry = []
    registry_index = {}
    for row in registry_rows:
        item = {"title": row.get("Collection Title", "").strip(), "handle": row.get("Collection Handle", "").strip(), "target": decimal_value(row.get("Products Assigned", "")), "row": row.get("_row")}
        registry.append(item)
        registry_index[normalized_key(item["title"])] = item
        registry_index[normalized_key(item["handle"])] = item
    aliases = {
        "gift": "gifts", "anklets": "anklet", "diya": "diyas", "kavach": "kawachyantra",
        "kawach": "kawachyantra", "rudraksha kavach": "kawachyantra", "tiger eye": "tigers eye",
        "tiger's eye": "tigers eye", "tiger’s eye": "tigers eye", "cat's eye": "cats eye",
        "cat’s eye": "cats eye", "bracelet": "bracelets", "pendant": "pendants", "ring": "rings", "rashi": "zodiac",
    }
    alias_index = {normalized_key(key): registry_index.get(normalized_key(target)) for key, target in aliases.items()}
    def resolve(label):
        return registry_index.get(normalized_key(label)) or alias_index.get(normalized_key(label))

    products = {}
    variant_by_identity = {}
    sku_rows = defaultdict(list)
    sku_source_rows = defaultdict(list)
    common_by_sku = defaultdict(list)
    for row in listing:
        handle = row.get("Handle", "").strip()
        sku = row.get("Variant SKU", "").strip()
        if not handle:
            continue
        product = products.setdefault(handle, {"handle": handle, "title_values": [], "description_values": [], "images": [], "tags": [], "keywords": [], "classes": defaultdict(list), "source_rows": [], "variants": [], "collection_handles": set(), "group_ids": set()})
        product["source_rows"].append(row.get("_row"))
        title = row.get("Title", "").strip()
        description = row.get("Body (HTML)", "").strip()
        if title and title not in product["title_values"]:
            product["title_values"].append(title)
        if description and description not in product["description_values"]:
            product["description_values"].append(description)
        product["tags"].extend(split_tags(row.get("Keywords/Tags", "")))
        image = row.get("Image Src", "").strip()
        if image and image not in product["images"]:
            product["images"].append(image)
        if not sku:
            continue
        values = {"price": decimal_value(row.get("Final price", "")), "compareAt": decimal_value(row.get("MRP", "")), "stock": decimal_value(row.get("Stock", "")), "weight": decimal_value(row.get("Variant Grams", "")), "rows": [row.get("_row")]}
        key = (handle, sku)
        variant = variant_by_identity.get(key)
        if variant is None:
            variant = {"handle": handle, "sku": sku, **values}
            variant_by_identity[key] = variant
            products[handle]["variants"].append(variant)
            sku_rows[sku].append(variant)
        else:
            variant["rows"].append(row.get("_row"))
            for field in ("price", "compareAt", "stock", "weight"):
                if variant[field] is None and values[field] is not None:
                    variant[field] = values[field]
        sku_source_rows[sku].append(row)

    for row in common:
        sku = row.get("Variant SKU", "").strip()
        if sku:
            common_by_sku[sku].append(row)

    exact_common = {}
    for sku, rows in common_by_sku.items():
        if len(rows) != 1:
            continue
        source = rows[0]
        handle = source.get("Handle", "").strip()
        variant = variant_by_identity.get((handle, sku))
        product = products.get(handle)
        if not variant or not product:
            continue
        exact_common[sku] = source
        for field, source_field in (("price", "Final price"), ("compareAt", "MRP"), ("stock", "Stock"), ("weight", "Variant Grams")):
            if variant[field] is None:
                variant[field] = decimal_value(source.get(source_field, ""))
        if not product["title_values"] and source.get("Title", "").strip():
            product["title_values"].append(source["Title"].strip())
        if not product["description_values"] and source.get("Body (HTML)", "").strip():
            product["description_values"].append(source["Body (HTML)"].strip())
        image = source.get("Image Src", "").strip()
        if image and image not in product["images"]:
            product["images"].append(image)
        product["keywords"].extend(split_tags(source.get("Keywords", "")))
        for column in ATTRIBUTE_COLUMNS:
            value = source.get(column, "").strip()
            if value and value.casefold() not in {"no", "n/a", "na", "-"} and not is_planning_note(value):
                product["classes"][column].append(value)

    for row in sheets.get("Keywords", {}).get("rows", []):
        sku = row.get("Variant SKU", "").strip()
        targets = sku_rows.get(sku, [])
        handles = {variant["handle"] for variant in targets}
        if sku and len(handles) == 1:
            products[next(iter(handles))]["tags"].extend(split_tags(row.get("Tags", "")))

    for row in category_rows:
        handle = row.get("Handle", "").strip()
        product = products.get(handle)
        if not product:
            continue
        if not product["title_values"] and row.get("Title", "").strip():
            product["title_values"].append(row["Title"].strip())
        for column in sheets["Categories"]["headers"]:
            if column in {"Handle", "Title", "Variant SKU", ""}:
                continue
            value = row.get(column, "").strip()
            if value and value.casefold() not in {"no", "n/a", "na", "-"} and not is_planning_note(value):
                product["classes"][column].append(value)

    # Mirror only the workbook's exact row-level mapping logic; aggregate counts
    # alone are not converted into guessed product relationships.
    membership_sources = defaultdict(set)
    membership_rows = defaultdict(list)
    def assign(handle, collection, source, row_num):
        if handle in products:
            key = (handle, collection["handle"])
            membership_sources[key].add(source)
            membership_rows[key].append(row_num)
    for row in categorywise:
        handle = row.get("Handle", "").strip()
        for column in [key for key in row if key.startswith("Category ")]:
            collection = resolve(row.get(column, "").strip())
            if collection:
                assign(handle, collection, f"Category wise products- Tuhin:{column}", row.get("_row"))
    for row in curated:
        for column, value in row.items():
            if column == "_row" or not value.strip() or not re.fullmatch(r"[A-Za-z]{1,6}[-/]?[A-Za-z0-9]*\d+[A-Za-z0-9-]*", value.strip()):
                continue
            collection = resolve(column)
            sku = value.strip()
            candidates = sku_rows.get(sku, [])
            handles = {variant["handle"] for variant in candidates}
            if collection and len(handles) == 1 and all(item["sku"] not in {s for s, v in sku_rows.items() if len({x['handle'] for x in v}) > 1} for item in candidates):
                assign(next(iter(handles)), collection, f"SKUs in each category:{column}", row.get("_row"))
            elif collection and not candidates:
                pass
    for row in category_rows:
        handle = row.get("Handle", "").strip()
        for column in sheets["Categories"]["headers"]:
            if column in {"Handle", "Title", "Variant SKU", ""}:
                continue
            value = row.get(column, "").strip()
            if not value or value.casefold() in {"no", "n/a", "na", "-"}:
                continue
            by_column = resolve(column)
            if value.casefold() == "yes":
                if by_column:
                    assign(handle, by_column, f"Categories:{column}=Yes", row.get("_row"))
                continue
            by_value = resolve(value)
            if by_value:
                assign(handle, by_value, f"Categories:{column}", row.get("_row"))

    sku_duplicate_handles = {sku: sorted({variant["handle"] for variant in entries}) for sku, entries in sku_rows.items() if len({variant["handle"] for variant in entries}) > 1}
    for (handle, collection_handle), _sources in membership_sources.items():
        products[handle]["collection_handles"].add(collection_handle)

    curated_group_ids = {}
    group_members = defaultdict(set)
    for column in sheets["SKUs in each category"]["headers"]:
        if not column or resolve(column):
            continue
        group_id = "group-" + re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", normalized_key(column))).strip("-")
        curated_group_ids[normalized_key(column)] = group_id
    for row in curated:
        for column, value in row.items():
            if column == "_row" or not value.strip() or not re.fullmatch(r"[A-Za-z]{1,6}[-/]?[A-Za-z0-9]*\d+[A-Za-z0-9-]*", value.strip()):
                continue
            sku = value.strip()
            handles = {variant["handle"] for variant in sku_rows.get(sku, [])}
            if len(handles) == 1 and sku not in sku_duplicate_handles and normalized_key(column) in curated_group_ids:
                group_members[curated_group_ids[normalized_key(column)]].add(next(iter(handles)))
    for handle, product in products.items():
        product["group_ids"] = {group_id for group_id, members in group_members.items() if handle in members}

    storefront_by_handle = {item["handle"]: item for item in catalog["products"]}
    field_rows = []
    all_fields = Counter()
    status_counts = Counter()
    for handle, source in products.items():
        output = storefront_by_handle.get(handle)
        source_title = source["title_values"][0] if source["title_values"] else ""
        source_desc_html = source["description_values"][0] if source["description_values"] else ""
        source_desc = storefront_description(source_desc_html)
        source_images = list(dict.fromkeys(url for url in source["images"] if valid_image_url(url)))
        source_tags = unique_casefold(item for item in source["tags"] if item)
        source_keywords = unique_casefold(item for item in source["keywords"] if item)
        classes = []
        for label, values in source["classes"].items():
            unique = list(dict.fromkeys(value.strip() for value in values if value.strip()))
            if unique:
                classes.append({"label": label, "value": ", ".join(unique)})
        classes.sort(key=lambda item: item["label"])
        expected_variants = [{"sku": item["sku"], "price": item["price"] if item["price"] and item["price"] > 0 else None, "compareAt": item["compareAt"]} for item in source["variants"]]
        expected_collection_handles = sorted(source["collection_handles"])
        expected_collection_titles = [next((row["title"] for row in registry if row["handle"] == coll), coll) for coll in expected_collection_handles]
        primary_type = next((value for label in ("Jewellery", "Crystal Category", "Malas & Jap Malas", "Puja", "Home Decor/Vastu", "Kawach/Yantra") for value in source["classes"].get(label, []) if value), "")
        expected_category = primary_type or (expected_collection_titles[0] if expected_collection_titles else "")
        try:
            expected_skus = [item["sku"] for item in source["variants"]]
            actual_skus = [item.get("sku") for item in (output or {}).get("variants", [])]
            expected_variant_prices = [{"sku": item["sku"], "price": item["price"] if item["price"] and item["price"] > 0 else None} for item in source["variants"]]
            actual_variant_prices = [{"sku": item.get("sku"), "price": item.get("price") if item.get("price") and item.get("price") > 0 else None} for item in (output or {}).get("variants", [])]
            expected_mrps = [{"sku": item["sku"], "compareAt": item["compareAt"]} for item in source["variants"]]
            actual_mrps = [{"sku": item.get("sku"), "compareAt": item.get("compareAt")} for item in (output or {}).get("variants", [])]
            fields = [
                ("handle", handle, (output or {}).get("handle"), True, "Listing.Handle", ",".join(map(str, source["source_rows"])), "Primary product key."),
                ("title", source_title, (output or {}).get("title"), bool(source_title), "Listing.Title / exact Common SKU / Categories.Title", ",".join(map(str, source["source_rows"])), "Missing source title uses the handle-derived display fallback." if not source_title else ""),
                ("description", source_desc, (output or {}).get("description"), bool(source_desc), "Listing.Body (HTML) / exact Common SKU", ",".join(map(str, source["source_rows"])), "Description HTML is converted to plain text; absent copy is not invented." if not source_desc else "Sanitized HTML text."),
                ("images", source_images, (output or {}).get("images"), bool(source_images), "Listing.Image Src / exact Common SKU", ",".join(map(str, source["source_rows"])), "Only HTTPS image URLs are customer-usable; missing/invalid source image is incomplete." if not source_images else "Image order retained; duplicate URLs removed."),
                ("variant_skus", expected_skus, actual_skus, bool(expected_skus), "Listing.Variant SKU", ",".join(str(v) for item in source["variants"] for v in item["rows"]), ""),
                ("variant_prices", expected_variant_prices, actual_variant_prices, bool(source["variants"]) and all(v["price"] is not None and v["price"] > 0 for v in source["variants"]), "Listing.Final price / exact Common SKU", "", "Unpriced SKUs remain null and blocked from add-to-cart."),
                ("variant_mrp", expected_mrps, actual_mrps, bool(source["variants"]) and all(v["compareAt"] is not None and v["compareAt"] > 0 for v in source["variants"]), "Listing.MRP / exact Common SKU", "", "Missing MRP remains null."),
                ("attributes", classes, (output or {}).get("attributes", []), bool(classes), "Common classification columns / Categories", "", "Planning notes are excluded from customer-facing attributes." if not classes else ""),
                ("tags", source_tags, (output or {}).get("tags", []), bool(source_tags), "Listing.Keywords/Tags / Keywords.Tags by unique SKU", "", "No tag source values supplied." if not source_tags else ""),
                ("keywords", source_keywords, (output or {}).get("keywords", []), bool(source_keywords), "Common.Keywords by exact unique SKU", "", "No keyword source values supplied." if not source_keywords else ""),
                ("collection_assignments", expected_collection_handles, (output or {}).get("collectionHandles", []), bool(expected_collection_handles), "Categories / Category wise products- Tuhin / SKUs in each category", "", "Aggregate collection counts do not identify which products belong to a collection." if not expected_collection_handles else "Distinct product memberships; repeated source assignments deduplicated."),
                ("collection_titles", expected_collection_titles, (output or {}).get("collectionTitles", []), bool(expected_collection_titles), "All Collections Count - Tuhin titles", "", "Derived from verified membership handles." if expected_collection_titles else "No product-level mapping supplied."),
                ("catalog_type", primary_type, (output or {}).get("type"), bool(primary_type), "Common classification / Categories", "", "No specific product type supplied." if not primary_type else ""),
                ("primary_category", expected_category, (output or {}).get("primaryCategory"), bool(expected_category), "Common classification / Categories / collection mapping", "", "No product-level category value supplied." if not expected_category else ""),
                ("curated_group_ids", sorted(source["group_ids"]), sorted((output or {}).get("groupIds", [])), bool(source["group_ids"]), "SKUs in each category exact SKU references", "", "No unambiguous curated group SKU mapping supplied." if not source["group_ids"] else ""),
                ("stock_availability", None, (output or {}).get("availability"), False, "Listing/Common.Stock", "", "Source stock is not independently verified; storefront deliberately reports unknown availability."),
                ("variant_weights", [item["weight"] for item in source["variants"]], [item.get("weightGrams") for item in (output or {}).get("variants", [])], False, "Listing/Common.Variant Grams", "", "Zero, blank, or unverified weights are omitted from storefront fields."),
                ("ratings_reviews", None, None, False, "No rating/review fields in workbook", "", "The source workbook does not provide rating or review data; none should be fabricated."),
                ("SEO metadata", None, (output or {}).get("seo"), False, "No SEO fields in workbook sheets", "", "No SEO title/description columns exist in the source workbook."),
            ]
        except Exception:
            raise
        for field, expected, actual, complete, source_sheets, source_rows, details in fields:
            comparison_expected, comparison_actual = expected, actual
            if field == "attributes":
                comparison_expected = sorted(expected or [], key=lambda item: (item.get("label", ""), item.get("value", "")))
                comparison_actual = sorted(actual or [], key=lambda item: (item.get("label", ""), item.get("value", "")))
            elif field in {"tags", "keywords"}:
                comparison_expected = sorted(str(item).casefold() for item in (expected or []))
                comparison_actual = sorted(str(item).casefold() for item in (actual or []))
            field_status = status(comparison_expected, comparison_actual, complete)
            field_rows.append({"handle": handle, "field": field, "status": field_status, "source_sheets": source_sheets, "source_rows": source_rows, "source_value": "" if expected is None else json_value(expected), "catalog_value": "" if actual is None else json_value(actual), "details": details})
            all_fields[field] += 1
            status_counts[field_status] += 1

    variant_rows = []
    for (handle, sku), source in variant_by_identity.items():
        output_product = storefront_by_handle.get(handle)
        output_variant = next((item for item in (output_product or {}).get("variants", []) if item.get("sku") == sku), None)
        common_rows = common_by_sku.get(sku, [])
        exact_rows = [row for row in common_rows if row.get("Handle", "").strip() == handle]
        listing_values = [decimal_value(row.get("Final price", "")) for row in sku_source_rows[sku] if row.get("Handle", "").strip() == handle]
        listing_positive = [value for value in listing_values if value is not None and value > 0]
        common_values = [decimal_value(row.get("Final price", "")) for row in exact_rows]
        common_positive = [value for value in common_values if value is not None and value > 0]
        expected_price = source["price"] if source["price"] is not None and source["price"] > 0 else (common_positive[0] if source["price"] is None and len(common_rows) == 1 and len(exact_rows) == 1 and common_positive else None)
        actual_price = output_variant.get("price") if output_variant else None
        actual_price = actual_price if actual_price is not None and actual_price > 0 else None
        if actual_price != expected_price:
            price_status = "MISSING" if expected_price is not None and actual_price is None else "MISMATCH"
        elif expected_price is None:
            price_status = "SOURCE INCOMPLETE"
        elif len(set(listing_positive)) > 1 or len(set(common_positive)) > 1:
            price_status = "SOURCE INCOMPLETE"
        else:
            price_status = "MATCH"
        if actual_price is None:
            if len(common_rows) > 1 or (common_rows and not exact_rows):
                reason = "Duplicate/conflicting SKU or missing handle join; Common row cannot safely enrich this product handle."
            elif len(set(listing_positive)) > 1 or len(set(common_positive)) > 1:
                reason = "Source-sheet disagreement: repeated price values differ; needs client resolution."
            elif any(value is not None and value <= 0 for value in listing_values + common_values):
                reason = "Zero or invalid source price; no positive final price is available."
            else:
                reason = "Blank source price in Listing and/or exact Common SKU row."
        elif actual_price != expected_price:
            reason = "Import transformation error: generated price differs from the positive source value."
        elif len(common_rows) > 1 or (common_rows and not exact_rows):
            reason = "Priced from Listing; Common SKU is duplicate or linked to another handle, so no enrichment was applied."
        elif len(set(listing_positive)) > 1:
            reason = "Listing rows disagree; importer retained the first positive value, needs client confirmation."
        else:
            reason = "Positive source price preserved." if actual_price is not None else ""
        expected_mrp = source["compareAt"] if source["compareAt"] is not None else (decimal_value(exact_rows[0].get("MRP", "")) if source["compareAt"] is None and len(common_rows) == 1 and len(exact_rows) == 1 else None)
        actual_mrp = output_variant.get("compareAt") if output_variant else None
        mrp_status = "SOURCE INCOMPLETE" if expected_mrp is None else ("MATCH" if actual_mrp == expected_mrp else "MISSING" if actual_mrp is None else "MISMATCH")
        source_rows = [row.get("_row") for row in sku_source_rows[sku] if row.get("Handle", "").strip() == handle]
        variant_rows.append({
            "handle": handle, "sku": sku, "listing_rows": ",".join(map(str, source["rows"])),
            "listing_price_values": json_value(listing_values), "common_rows_for_sku": ",".join(str(row.get("_row")) for row in common_rows),
            "common_handles_for_sku": json_value(sorted({row.get("Handle", "").strip() for row in common_rows})),
            "exact_common_row": exact_rows[0].get("_row", "") if len(exact_rows) == 1 and len(common_rows) == 1 else "",
            "source_final_price": expected_price, "catalog_final_price": actual_price, "price_status": price_status, "price_explanation": reason,
            "source_mrp": expected_mrp, "catalog_mrp": actual_mrp, "mrp_status": mrp_status,
            "duplicate_sku_across_handles": sku in sku_duplicate_handles, "can_purchase": bool(output_variant and output_variant.get("canPurchase")),
            "availability": (output_variant or {}).get("availability", ""), "source_stock": source["stock"],
            "source_weight_grams": source["weight"], "catalog_weight_grams": (output_variant or {}).get("weightGrams"), "details": "Stock stays unknown; checkout is disabled in this preview. Zero/blank weights are not rendered.",
        })

    actual_memberships = {(row.get("product_handle"), row.get("collection_handle")): row for row in json.loads((args.output / "canonical-memberships.json").read_text(encoding="utf-8"))} if (args.output / "canonical-memberships.json").exists() else {}
    collection_rows_out = []
    count_delta = Counter()
    issue_counts = Counter()
    for coll in registry:
        handle = coll["handle"]
        source_members = [key for key in membership_sources if key[1] == handle]
        imported_members = [item for item in catalog.get("products", []) if handle in item.get("collectionHandles", [])]
        imported_count = len({item["handle"] for item in imported_members})
        raw_count = sum(len(membership_rows[key]) for key in source_members)
        duplicate_sources = max(0, raw_count - len(source_members))
        variant_count = sum(len(products[product_handle]["variants"]) for product_handle, _ in source_members)
        column = next((key for key in sheets["SKUs in each category"]["headers"] if resolve(key) and resolve(key)["handle"] == handle), "")
        orphan_skus = []
        if column:
            for row in curated:
                value = row.get(column, "").strip()
                if value and re.fullmatch(r"[A-Za-z]{1,6}[-/]?[A-Za-z0-9]*\d+[A-Za-z0-9-]*", value) and not sku_rows.get(value):
                    orphan_skus.append(value)
        unmapped_labels = []
        for row in categorywise:
            for key, value in row.items():
                if key.startswith("Category ") and value.strip() and resolve(value.strip()) is None and normalized_key(value) == normalized_key(coll["title"]):
                    unmapped_labels.append((row.get("_row"), key, value.strip()))
        delta = imported_count - coll["target"] if coll["target"] is not None else None
        if delta not in (None, 0):
            count_delta["discrepant"] += 1
            if imported_count == 0:
                explanation = "The registry supplies only an aggregate target count; no exact product handles for this collection are present in the row-level mapping sheets. Do not infer membership from the count."
                issue_counts["registry_count_only_no_explicit_mappings"] += 1
            elif delta > 0:
                explanation = f"{abs(delta)} more distinct products are explicitly assigned than the registry target. The row-level mapping sheets contain {raw_count} assignment rows and {duplicate_sources} repeated cross-sheet assignment rows; repeated assignments are deduplicated. Client should confirm the registry count or membership list."
                issue_counts["explicit_assignments_exceed_registry"] += 1
            else:
                explanation = f"The registry target exceeds mapped distinct products by {abs(delta)}. Only {imported_count} product handles are explicitly mapped; {len(orphan_skus)} curated SKU references are orphaned and are listed in the explanation when relevant. No missing handles can be derived from an aggregate count."
                if orphan_skus:
                    explanation += f" Orphaned SKU references: {', '.join(orphan_skus[:12])}."
                issue_counts["registry_target_exceeds_explicit_mappings"] += 1
        else:
            explanation = "Distinct product assignments match the registry count." if coll["target"] is not None else "No registry target count was supplied."
        if coll["target"] == variant_count and delta not in (None, 0):
            explanation += " The registry target equals the number of variants on mapped products, so the source count may use variant rather than distinct-product units; this is not confirmed."
            issue_counts["possible_variant_vs_product_count"] += 1
        collection_rows_out.append({
            "collection_handle": handle, "collection_title": coll["title"], "registry_source_row": coll["row"],
            "excel_expected_count": coll["target"], "imported_distinct_product_count": imported_count,
            "difference_imported_minus_expected": delta, "mapped_source_assignment_rows": raw_count,
            "repeated_source_assignments_deduplicated": duplicate_sources, "mapped_variant_count": variant_count,
            "curated_orphan_sku_count": len(orphan_skus), "curated_orphan_skus": ";".join(sorted(set(orphan_skus))),
            "explicit_product_mappings": " | ".join(sorted({source for key in source_members for source in membership_sources[key]})),
            "explanation": explanation,
        })

    args.output.mkdir(parents=True, exist_ok=True)
    write_csv(args.output / "catalog-field-audit.csv", field_rows, ["handle", "field", "status", "source_sheets", "source_rows", "source_value", "catalog_value", "details"])
    write_csv(args.output / "catalog-variant-audit.csv", variant_rows, ["handle", "sku", "listing_rows", "listing_price_values", "common_rows_for_sku", "common_handles_for_sku", "exact_common_row", "source_final_price", "catalog_final_price", "price_status", "price_explanation", "source_mrp", "catalog_mrp", "mrp_status", "duplicate_sku_across_handles", "can_purchase", "availability", "source_stock", "source_weight_grams", "catalog_weight_grams", "details"])
    write_csv(args.output / "catalog-collection-audit.csv", collection_rows_out, ["collection_handle", "collection_title", "registry_source_row", "excel_expected_count", "imported_distinct_product_count", "difference_imported_minus_expected", "mapped_source_assignment_rows", "repeated_source_assignments_deduplicated", "mapped_variant_count", "curated_orphan_sku_count", "curated_orphan_skus", "explicit_product_mappings", "explanation"])
    no_product_in_catalog = sorted(set(products) - set(storefront_by_handle))
    extra_catalog = sorted(set(storefront_by_handle) - set(products))
    summary = {
        "source_workbook": args.workbook.name,
        "catalog_file": str(args.catalog),
        "products_compared": len(products),
        "catalog_products": len(storefront_by_handle),
        "product_handles_missing_from_catalog": no_product_in_catalog,
        "catalog_handles_not_in_listing": extra_catalog,
        "field_rows": len(field_rows),
        "field_status_counts": dict(status_counts),
        "field_status_counts_by_field": {field: dict(Counter(row["status"] for row in field_rows if row["field"] == field)) for field in sorted(all_fields)},
        "variant_rows": len(variant_rows),
        "variant_price_status_counts": dict(Counter(row["price_status"] for row in variant_rows)),
        "unpriced_variants": sum(row["catalog_final_price"] is None for row in variant_rows),
        "unpriced_variant_causes": dict(Counter(row["price_explanation"] for row in variant_rows if row["catalog_final_price"] is None)),
        "unpriced_duplicate_or_join_variants": sum(row["catalog_final_price"] is None and ("duplicate/conflicting sku" in row["price_explanation"].lower() or "handle join" in row["price_explanation"].lower()) for row in variant_rows),
        "source_sheet_disagreements_in_unpriced_variants": sum(row["catalog_final_price"] is None and "disagree" in row["price_explanation"].lower() for row in variant_rows),
        "collection_rows": len(collection_rows_out),
        "collection_count_discrepancies": count_delta["discrepant"],
        "collection_explanation_counts": dict(issue_counts),
        "collection_diff_values": dict(Counter(str(row["difference_imported_minus_expected"]) for row in collection_rows_out if row["difference_imported_minus_expected"] not in (None, 0))),
        "explicit_membership_rows": len(membership_sources),
        "publication_ready": catalog.get("publicationReady", False),
        "ui_verification": "See catalog-ui-audit.json; generated separately by browser audit.",
        "all_customer_facing_field_checks_pass": all(row["status"] == "MATCH" for row in field_rows if row["field"] not in {"SEO metadata", "stock_availability", "variant_weights", "ratings_reviews"}),
    }
    write_json(args.output / "catalog-field-audit-summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
