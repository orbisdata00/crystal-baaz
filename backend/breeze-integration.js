/**
 * Server-only Breeze integration boundary. Supply adapters from merchant-approved
 * Shopify/Breeze contracts; this module deliberately defines no vendor requests,
 * signatures, webhook formats, or order mutations.
 */
export function createBreezeBackend({ shopify, breeze, webhookVerifier, idempotency, orders }) {
  const required = (adapter, method) => {
    if (typeof adapter?.[method] !== "function") throw new Error(`Breeze integration adapter is not configured: ${method}`);
    return adapter[method].bind(adapter);
  };

  return {
    async prepareCheckout({ shopifyCartId }) {
      if (typeof shopifyCartId !== "string" || !shopifyCartId.startsWith("gid://shopify/Cart/")) throw new Error("A valid Shopify cart ID is required.");
      const fetchCart = required(shopify, "fetchCart");
      const cart = await fetchCart(shopifyCartId);
      if (!cart || cart.id !== shopifyCartId || !Array.isArray(cart.lines) || !cart.lines.length) throw new Error("The Shopify cart could not be confirmed.");
      const lines = cart.lines.map(line => {
        if (!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(line.variantId || "") || !Number.isInteger(line.quantity) || line.quantity < 1) throw new Error("The Shopify cart contains an invalid line.");
        return { variantId: line.variantId, quantity: line.quantity };
      });
      if (!Number.isFinite(Number(cart.total?.amount)) || Number(cart.total.amount) < 0 || !cart.total.currencyCode) throw new Error("The Shopify cart total is not confirmed.");
      // The Breeze adapter receives only the server-fetched cart. It must apply the
      // official merchant contract, including signatures and minor-unit conversion.
      return required(breeze, "createCheckoutSession")({ cart: { id: cart.id, lines, total: cart.total } });
    },

    async confirmCheckout({ checkoutReference }) {
      if (!checkoutReference) throw new Error("A checkout reference is required.");
      const result = await required(breeze, "verifyCheckoutStatus")({ checkoutReference });
      if (!result || result.verified !== true) return { status: "pending" };
      // Order synchronization is a separate explicitly approved adapter boundary.
      const reconcile = required(orders, "reconcileVerifiedPayment");
      return reconcile({ verifiedPayment: result });
    },

    async receiveWebhook({ headers, rawBody }) {
      const event = await required(webhookVerifier, "verifyAndDecode")({ headers, rawBody });
      if (!event?.id) throw new Error("Verified webhook is missing its event ID.");
      const claim = required(idempotency, "claimEvent");
      const claimed = await claim({ eventId: event.id });
      if (!claimed) return { accepted: true, duplicate: true };
      // No default event schema or order mutation: the merchant supplies a handler.
      await required(orders, "handleVerifiedWebhook")({ event });
      return { accepted: true, duplicate: false };
    },
  };
}
