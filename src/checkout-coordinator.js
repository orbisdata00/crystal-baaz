/** Provider policy for the static storefront. Payment providers need their own completed adapter. */
export function canStartCheckout({ provider, conflict = false, cart, syncing = false, error = "" } = {}) {
  const total = cart?.cost?.totalAmount;
  const lines = cart?.lines?.nodes;
  return !conflict && ["shopify", "razorpay"].includes(provider) && !syncing && !error &&
    Boolean(cart?.id) && Array.isArray(lines) && lines.length > 0 &&
    Number.isFinite(Number(total?.amount)) && Number(total.amount) >= 0 && /^[A-Z]{3}$/.test(total?.currencyCode || "");
}

export function checkoutUnavailableMessage(provider, conflict = false) {
  if (conflict) return "Checkout configuration conflict. Contact the store administrator.";
  if (provider === "razorpay") return "Razorpay Magic Checkout is not configured for this store.";
  return "Checkout is disabled until merchant setup is approved.";
}
