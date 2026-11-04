function decode(value) {
  try { return decodeURIComponent(value || ""); } catch { return ""; }
}

export function parseRoute(hash = "") {
  const rawRoute = hash.replace(/^#/, "");
  const [route, queryString = ""] = rawRoute.split("?");
  const params = new URLSearchParams(queryString);
  const viewOptions = { sort: params.get("sort") || "featured", facet: params.get("facet") || "" };
  if (!route || route === "home") return { page: "home" };
  const [page, ...parts] = route.split("/");
  const value = decode(parts.join("/"));
  if (page === "collections") return { page, group: params.get("group") || "Category", category: params.get("category") || "", ...viewOptions };
  if (page === "product") return { page, handle: value };
  if (page === "collection") return { page, handle: value, ...viewOptions };
  if (page === "discovery") return { page, id: value, ...viewOptions };
  if (page === "group") return { page, id: value, ...viewOptions };
  if (page === "nav") return { page, label: value, ...viewOptions };
  if (page === "zodiac") return { page, sign: value, ...viewOptions };
  if (page === "crystals") return { page, handle: value };
  if (page === "search") return { page, query: value, ...viewOptions };
  if (["wishlist", "cart", "account", "orders", "faq", "about", "contact", "policies", "copilot"].includes(page)) return { page };
  return { page: "home" };
}
