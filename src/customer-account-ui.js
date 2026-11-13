import React, { useEffect, useState } from "react";
import htm from "htm";
import { formatCurrencyAmount } from "./money.js";
import { shopifyConfig } from "./config.js";
import { Icon } from "./Icon.js";

const html = htm.bind(React.createElement);

function connectionNodes(connection) {
  return connection?.nodes || connection?.edges?.map(edge => edge.node) || [];
}

function formatAmount(amount, currency = "INR") {
  if (!amount || !Number.isFinite(Number(amount.amount))) return "Amount unavailable";
  try {
    return formatCurrencyAmount(amount.amount, currency, currency?.toUpperCase() === "INR" ? 0 : 2);
  } catch { return `${amount.amount} ${currency}`; }
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

function OrderCard({ order }) {
  const items = connectionNodes(order.lineItems);
  const fulfillment = String(order.fulfillmentStatus || "").replaceAll("_", " ").toLowerCase();
  const payment = String(order.financialStatus || "").replaceAll("_", " ").toLowerCase();
  return html`<details className="customer-order-card">
    <summary><span><strong>${order.name}</strong><small>${formatDate(order.createdAt)}</small></span><span><strong>${formatAmount(order.totalPrice?.amount ? order.totalPrice : null, order.totalPrice?.currencyCode)}</strong><small>${fulfillment || payment || "Status unavailable"}</small></span></summary>
    <div className="customer-order-details">
      <p>Payment: ${payment || "Status unavailable"} · Fulfilment: ${fulfillment || "Status unavailable"}</p>
      <ul>${items.map((item, index) => html`<li key=${`${order.id}:${index}`}><span>${item.title || "Shopify item"}</span><span>Qty ${item.quantity || 0}</span></li>`)}</ul>
    </div>
  </details>`;
}

const ADDRESS_INPUTS = [
  ["firstName", "First name", "given-name", true],
  ["lastName", "Last name", "family-name", true],
  ["company", "Company", "organization", false],
  ["address1", "Address line 1", "address-line1", true],
  ["address2", "Address line 2", "address-line2", false],
  ["city", "City", "address-level2", true],
  ["zoneCode", "State / region code", "address-level1", false],
  ["zip", "Postal code", "postal-code", true],
  ["countryCode", "Country code (2 letters)", "country", true],
  ["phoneNumber", "Phone number", "tel", false],
];

function AddressForm({ initial, isNew, busy, onCancel, onSave }) {
  const [values, setValues] = useState(() => ({
    firstName: initial?.firstName || "",
    lastName: initial?.lastName || "",
    company: initial?.company || "",
    address1: initial?.address1 || "",
    address2: initial?.address2 || "",
    city: initial?.city || "",
    zoneCode: initial?.zoneCode || "",
    zip: initial?.zip || "",
    countryCode: initial?.countryCode || initial?.territoryCode || "",
    phoneNumber: initial?.phoneNumber || "",
  }));
  const [makeDefault, setMakeDefault] = useState(!isNew && Boolean(initial?.isDefault));
  return html`<form className="customer-address-form" onSubmit=${event => { event.preventDefault(); void onSave(values, makeDefault); }}>
    <h3>${isNew ? "Add an address" : "Edit address"}</h3>
    <div className="customer-address-fields">${ADDRESS_INPUTS.map(([key, label, autocomplete, required]) => html`<label key=${key}>${label}<input name=${key} autoComplete=${autocomplete} value=${values[key]} required=${required} maxLength=${key === "countryCode" ? 2 : undefined} onInput=${event => setValues(current => ({ ...current, [key]: key === "countryCode" ? event.currentTarget.value.toUpperCase() : event.currentTarget.value }))}/></label>`)}</div>
    <label className="customer-address-default"><input type="checkbox" checked=${makeDefault} onChange=${event => setMakeDefault(event.currentTarget.checked)}/> Make this my default address</label>
    <div className="customer-address-actions"><button className="customer-account-primary" type="submit" disabled=${busy}>${busy ? "Saving…" : "Save address"}</button><button className="customer-account-secondary" type="button" onClick=${onCancel} disabled=${busy}>Cancel</button></div>
  </form>`;
}

export function CustomerAccountPage({ state, account, onNavigate, onClose }) {
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [editingAddress, setEditingAddress] = useState(null);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressFeedback, setAddressFeedback] = useState("");
  const [activePanel, setActivePanel] = useState(() => ["error", "unconfigured"].includes(state.status) ? "sign-in" : "menu");
  const [headerOffset, setHeaderOffset] = useState(0);
  const [drawerRight, setDrawerRight] = useState(0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = event => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  useEffect(() => {
    const updateDrawerPosition = () => {
      const header = document.querySelector(".shopping-header-main") || document.querySelector(".shopping-header");
      setHeaderOffset(header?.getBoundingClientRect().bottom || 0);
      if (window.matchMedia("(max-width: 780px)").matches) {
        setDrawerRight(0);
        return;
      }
      const cart = document.querySelector(".shopping-tools>.shopping-cart-button") || document.querySelector(".shopping-pdp-cart");
      const cartLeft = cart?.getBoundingClientRect().left;
      setDrawerRight(Number.isFinite(cartLeft) ? Math.max(10, window.innerWidth - cartLeft + 10) : 12);
    };
    updateDrawerPosition();
    window.addEventListener("resize", updateDrawerPosition);
    window.addEventListener("scroll", updateDrawerPosition, { passive: true });
    return () => {
      window.removeEventListener("resize", updateDrawerPosition);
      window.removeEventListener("scroll", updateDrawerPosition);
    };
  }, []);

  const loadDashboard = async () => {
    setDashboardLoading(true);
    setDashboardError("");
    try { await account.loadDashboard(); }
    catch (error) { setDashboardError(error.message || "Shopify account information could not be loaded."); }
    finally { setDashboardLoading(false); }
  };

  useEffect(() => {
    if (state.status === "authenticated" && !state.customer && !dashboardLoading) void loadDashboard();
  }, [state.status, state.customer]);

  const customer = state.customer;
  const addresses = [customer?.defaultAddress, ...connectionNodes(customer?.addresses)].filter((address, index, all) => address && all.findIndex(item => item.id === address.id) === index);
  const orders = connectionNodes(customer?.orders);

  const saveAddress = async (values, makeDefault) => {
    setAddressBusy(true);
    setAddressFeedback("");
    try {
      if (editingAddress?.mode === "edit") await account.updateAddress(editingAddress.address.id, values, { defaultAddress: makeDefault });
      else await account.createAddress(values, { defaultAddress: makeDefault });
      setEditingAddress(null);
      setAddressFeedback("Your address was saved to Shopify.");
      try { await account.loadDashboard(); } catch (error) { setDashboardError(error.message || "Address saved, but account details could not be refreshed."); }
    } catch (error) {
      setAddressFeedback(error.message || "Shopify could not save this address. Check account permissions and try again.");
    } finally { setAddressBusy(false); }
  };

  const setDefaultAddress = async address => {
    setAddressBusy(true);
    setAddressFeedback("");
    try {
      await account.updateAddress(address.id, null, { defaultAddress: true });
      setAddressFeedback("Your default address was updated in Shopify.");
      try { await account.loadDashboard(); } catch (error) { setAddressFeedback(`Default address updated, but account details could not be refreshed: ${error.message || "Please reload."}`); }
    } catch (error) {
      setAddressFeedback(error.message || "Shopify could not update the default address.");
    } finally { setAddressBusy(false); }
  };

  const removeAddress = async address => {
    if (!window.confirm("Delete this saved address from your Shopify account?")) return;
    setAddressBusy(true);
    setAddressFeedback("");
    try {
      await account.deleteAddress(address.id);
      setAddressFeedback("Your address was deleted from Shopify.");
      try { await account.loadDashboard(); } catch (error) { setAddressFeedback(`Address deleted, but account details could not be refreshed: ${error.message || "Please reload."}`); }
    } catch (error) {
      setAddressFeedback(error.message || "Shopify could not delete this address.");
    } finally { setAddressBusy(false); }
  };

  const close = () => onClose?.();
  const goTo = destination => onClose ? onClose(destination) : onNavigate?.(destination);
  const signedIn = state.status === "authenticated" && Boolean(customer);
  const needsRegisteredDomain = state.status === "unconfigured" && /registered HTTPS domain/i.test(state.error || "");
  const liveAccountUrl = (() => {
    try { return new URL("#account", shopifyConfig.publicSiteUrl).href; }
    catch { return ""; }
  })();
  const startLogin = () => {
    if (account.isConfigured) void account.login({ returnPath: `${window.location.pathname}#account` });
    else setActivePanel("sign-in");
  };
  const openAccountPanel = panel => signedIn ? setActivePanel(panel) : startLogin();
  const accountMenu = [
    ["My Orders", () => openAccountPanel("orders")],
    ["Saved Addresses", () => openAccountPanel("addresses")],
    ["Wishlist", () => goTo("#wishlist")],
    ["FAQs", () => goTo("#faq")],
    ["Account Privacy", () => goTo("#policies")],
  ];
  const panelTitle = ({ profile: "My Account", addresses: "Saved Addresses", orders: "My Orders", "sign-in": "Sign in" })[activePanel] || "My Account";

  return html`<main className="customer-account-overlay" aria-label="Customer account" style=${{ top: `${headerOffset}px` }}>
    <button className="customer-account-scrim" type="button" aria-label="Close account menu" onClick=${close}></button>
    <aside className="customer-account-drawer" role="dialog" aria-modal="true" aria-label="My account menu" style=${{ right: `${drawerRight}px` }}>
      <header className="customer-drawer-header">
        ${activePanel !== "menu" && html`<button className="customer-drawer-close is-back" type="button" aria-label="Back to account menu" onClick=${() => setActivePanel("menu")}><${Icon} name="arrowLeft" size=${21}/></button>`}
        <div className="customer-drawer-identity"><h1>${activePanel === "menu" ? "My Account" : panelTitle}</h1><p>${activePanel === "sign-in" ? "Sign in to manage your Crystal Baaz account" : signedIn ? (customer.phoneNumber?.phoneNumber || customer.emailAddress?.emailAddress || "Crystal Baaz customer") : "Sign in to manage your Crystal Baaz account"}</p></div>
      </header>
      ${activePanel === "menu" && html`<nav className="customer-drawer-menu" aria-label="Account links">
        ${accountMenu.map(([label, action]) => html`<button type="button" key=${label} className="customer-drawer-menu-item" onClick=${action}>${label}</button>`)}
        ${signedIn ? html`<button type="button" className="customer-drawer-menu-item customer-drawer-logout" onClick=${() => void account.logout()}>Log Out</button>` : html`<button type="button" className="customer-drawer-menu-item customer-drawer-login" onClick=${startLogin}>Login</button>`}
      </nav>`}
      ${activePanel === "menu" && html`<section className="customer-drawer-promo"><img src="./assets/pwa-icon-192.png" alt=""/><div><strong>Explore Crystal Baaz</strong><p>Crystals, jewellery and spiritual essentials, wherever you are.</p></div></section>`}
      ${activePanel === "sign-in" && html`<section className="customer-drawer-content customer-account-signin">
        <p className="customer-account-signin-explainer">Shopify will securely verify your account using its hosted sign-in.</p>
        ${needsRegisteredDomain ? html`<div className="customer-account-domain-note" role="status"><p>Open Crystal Baaz on its registered HTTPS domain to use customer sign-in.</p>${liveAccountUrl && html`<a className="customer-account-primary customer-account-open-live" href=${liveAccountUrl}>Open Crystal Baaz</a>`}</div>` : state.status === "unconfigured" ? html`<p className="customer-account-error" role="status">${state.error || "Customer sign-in setup is pending. Please try again later."}</p>` : null}
        ${["signed-out", "error"].includes(state.status) && state.error && html`<p className="customer-account-error" role="alert">${state.error}</p>`}
        ${state.status === "authenticating" ? html`<p className="customer-account-signin-progress" role="status">Signing in securely…</p>` : !["unconfigured", "authenticated"].includes(state.status) && html`<button className="customer-account-primary" type="button" onClick=${startLogin}>Login</button>`}
      </section>`}
      ${state.status === "authenticated" && !customer && html`<section className="customer-drawer-content customer-account-loading" role="status"><p>${dashboardLoading ? "Loading your account…" : dashboardError ? "Your account couldn’t be loaded. Please try again." : "Loading your account…"}</p>${dashboardError && html`<button className="customer-account-secondary" type="button" onClick=${loadDashboard}>Retry</button>`}</section>`}
      ${customer && activePanel === "addresses" && html`<section className="customer-drawer-content customer-account-section customer-address-section"><header><div><span>ADDRESSES</span><h2>Your saved addresses</h2></div><button type="button" className="customer-account-secondary" onClick=${() => { setAddressFeedback(""); setEditingAddress({ mode: "create", address: null }); }}>Add address</button></header>
        ${addressFeedback && html`<p className="customer-address-feedback" role="status">${addressFeedback}</p>`}
        ${editingAddress && html`<${AddressForm} key=${editingAddress.mode + (editingAddress.address?.id || "new")} initial=${editingAddress.address} isNew=${editingAddress.mode === "create"} busy=${addressBusy} onCancel=${() => setEditingAddress(null)} onSave=${saveAddress}/>`}
        ${addresses.length ? html`<div className="customer-address-list">${addresses.map(address => {
          const isDefault = address.id === customer.defaultAddress?.id;
          return html`<article key=${address.id}><div><strong>${isDefault ? "Default address" : "Saved address"}</strong><p>${(address.formatted || []).join(", ") || [address.address1, address.address2, address.city, address.province, address.zip, address.country].filter(Boolean).join(", ")}</p></div><div className="customer-address-actions"><button type="button" className="customer-account-secondary" onClick=${() => { setAddressFeedback(""); setEditingAddress({ mode: "edit", address: { ...address, isDefault } }); }}>Edit</button>${!isDefault && html`<button type="button" className="customer-account-secondary" disabled=${addressBusy} onClick=${() => void setDefaultAddress(address)}>Make default</button>`}<button type="button" className="customer-account-secondary customer-address-delete" disabled=${addressBusy} onClick=${() => void removeAddress(address)}>Delete</button></div></article>`;
        })}</div>` : !editingAddress && html`<p className="customer-account-empty">Shopify has no saved addresses for this account yet.</p>`}
      </section>
      `}
      ${customer && activePanel === "orders" && html`<section className="customer-drawer-content customer-account-section"><header><div><span>ORDERS</span><h2>Your recent orders</h2></div></header>${orders.length ? html`<div className="customer-order-list">${orders.map(order => html`<${OrderCard} key=${order.id} order=${order}/>` )}</div>` : html`<p className="customer-account-empty">Shopify has no orders for this account yet.</p>`}</section>`}
    </aside>
  </main>`;
}
