import React, { useEffect, useState } from "react";
import htm from "htm";
import { formatCurrencyAmount } from "./money.js";

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

export function CustomerAccountPage({ state, account, onNavigate }) {
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [editingAddress, setEditingAddress] = useState(null);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressFeedback, setAddressFeedback] = useState("");

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

  return html`<main className="customer-account-page">
    <header className="customer-account-heading"><button type="button" className="customer-account-back" aria-label="Back to shopping" onClick=${() => onNavigate?.("#home")}>←</button><span>CRYSTAL BAAZ</span><h1>Your account</h1><p>Sign in securely with Shopify to view your profile, saved addresses and orders.</p></header>
    ${state.status === "unconfigured" && html`<section className="customer-account-notice" role="status"><h2>Customer sign-in setup is pending</h2><p>${state.error || "Shopify Customer Accounts are not configured for this storefront yet."}</p><p>Sign-in will be available after the Shopify Client ID and registered HTTPS callback URLs are added.</p><button className="customer-account-secondary" type="button" onClick=${() => window.location.hash = "#home"}>Continue shopping</button></section>`}
    ${["signed-out", "error"].includes(state.status) && html`<section className="customer-account-signin"><h2>Sign in to Crystal Baaz</h2><p>Shopify will securely verify your account using its hosted sign-in.</p>${state.error && html`<p className="customer-account-error" role="alert">${state.error}</p>`}<button className="customer-account-primary" type="button" onClick=${() => void account.login()}>Sign in with Shopify</button></section>`}
    ${state.status === "authenticating" && html`<p className="customer-account-loading" role="status">Signing in securely…</p>`}
    ${state.status === "authenticated" && !customer && html`<section className="customer-account-loading" role="status"><p>${dashboardLoading ? "Loading your account…" : dashboardError ? "Your account couldn’t be loaded. Please try again." : "Loading your account…"}</p>${dashboardError && html`<button className="customer-account-secondary" type="button" onClick=${loadDashboard}>Retry</button>`}</section>`}
    ${customer && html`<div className="customer-account-dashboard">
      <section className="customer-account-section"><header><div><span>PROFILE</span><h2>${customer.displayName || "Shopify customer"}</h2></div><button type="button" className="customer-account-secondary" onClick=${() => void account.logout()}>Sign out</button></header><dl><div><dt>Name</dt><dd>${[customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.displayName}</dd></div><div><dt>Email</dt><dd>${customer.emailAddress?.emailAddress || "Not available from Shopify"}</dd></div><div><dt>Phone</dt><dd>${customer.phoneNumber?.phoneNumber || "Not available from Shopify"}</dd></div></dl></section>
      <section className="customer-account-section customer-address-section"><header><div><span>ADDRESSES</span><h2>Your saved addresses</h2></div><button type="button" className="customer-account-secondary" onClick=${() => { setAddressFeedback(""); setEditingAddress({ mode: "create", address: null }); }}>Add address</button></header>
        ${addressFeedback && html`<p className="customer-address-feedback" role="status">${addressFeedback}</p>`}
        ${editingAddress && html`<${AddressForm} key=${editingAddress.mode + (editingAddress.address?.id || "new")} initial=${editingAddress.address} isNew=${editingAddress.mode === "create"} busy=${addressBusy} onCancel=${() => setEditingAddress(null)} onSave=${saveAddress}/>`}
        ${addresses.length ? html`<div className="customer-address-list">${addresses.map(address => {
          const isDefault = address.id === customer.defaultAddress?.id;
          return html`<article key=${address.id}><div><strong>${isDefault ? "Default address" : "Saved address"}</strong><p>${(address.formatted || []).join(", ") || [address.address1, address.address2, address.city, address.province, address.zip, address.country].filter(Boolean).join(", ")}</p></div><div className="customer-address-actions"><button type="button" className="customer-account-secondary" onClick=${() => { setAddressFeedback(""); setEditingAddress({ mode: "edit", address: { ...address, isDefault } }); }}>Edit</button>${!isDefault && html`<button type="button" className="customer-account-secondary" disabled=${addressBusy} onClick=${() => void setDefaultAddress(address)}>Make default</button>`}<button type="button" className="customer-account-secondary customer-address-delete" disabled=${addressBusy} onClick=${() => void removeAddress(address)}>Delete</button></div></article>`;
        })}</div>` : !editingAddress && html`<p className="customer-account-empty">Shopify has no saved addresses for this account yet.</p>`}
      </section>
      <section className="customer-account-section"><header><div><span>ORDERS</span><h2>Your recent orders</h2></div></header>${orders.length ? html`<div className="customer-order-list">${orders.map(order => html`<${OrderCard} key=${order.id} order=${order}/>` )}</div>` : html`<p className="customer-account-empty">Shopify has no orders for this account yet.</p>`}</section>
    </div>`}
  </main>`;
}
