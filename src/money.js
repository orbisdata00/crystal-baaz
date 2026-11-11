export function formatCurrencyAmount(amount, currency = "INR", maximumFractionDigits = 0) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";

  const code = /^[A-Z]{3}$/i.test(String(currency)) ? String(currency).toUpperCase() : "INR";
  const digits = Number.isInteger(maximumFractionDigits)
    ? Math.max(0, Math.min(20, maximumFractionDigits))
    : 0;

  if (code === "INR") {
    const number = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: digits === 2 ? 2 : 0,
      maximumFractionDigits: digits,
    }).format(Math.abs(value));
    return `${value < 0 ? "-" : ""}₹${number}`;
  }

  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: code,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${value} ${code}`;
  }
}
