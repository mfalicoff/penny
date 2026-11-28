// Synthetic reference exchange rates for `penny-env up --rates` (MAZ-151). The API's rate
// cache (`penny.exchange_rates`: per-euro quotes by publication date, as the ECB publishes
// them) is filled with deterministic made-up quotes for the business days of the last 60
// days, so currency features work with no request to the ECB. Same date, same rows.
// Nothing here is a real rate.

// Per-euro levels the quotes move around, in the ECB's precision. Synthetic.
export const baseRates = Object.freeze({
  AUD: "1.6630",
  BRL: "6.1210",
  CAD: "1.4655",
  CHF: "0.9415",
  CNY: "7.8120",
  CZK: "25.120",
  DKK: "7.4610",
  GBP: "0.8412",
  HKD: "8.4310",
  INR: "91.250",
  JPY: "162.10",
  KRW: "1478.65",
  MXN: "19.8740",
  NOK: "11.6420",
  NZD: "1.8530",
  PLN: "4.2850",
  SEK: "11.2190",
  SGD: "1.4520",
  USD: "1.0825",
  ZAR: "19.4310",
});

export const rateCurrencies = Object.freeze(Object.keys(baseRates));

const dayMs = 86_400_000;

/** `YYYY-MM-DD` (UTC) of a Date. */
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** The Monday–Friday dates (UTC, ascending) among the `days` days ending on `today`. */
export function businessDays(today = new Date(), days = 60) {
  const last = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dates = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(last - offset * dayMs);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.push(isoDate(day));
  }
  return dates;
}

/** A decimal string in canonical form (no trailing fraction zeros), as the cache stores it. */
function canonical(mantissa, scale) {
  const digits = mantissa.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * `perEuro` moved by `basisPoints` (±), rounded half up at the quote's own precision.
 * Exact: integer arithmetic only.
 */
export function moved(perEuro, basisPoints) {
  const [whole, fraction = ""] = perEuro.split(".");
  const mantissa = BigInt(whole + fraction);
  const numerator = mantissa * BigInt(10_000 + basisPoints);
  const rounded = (numerator * 2n + 10_000n) / 20_000n;
  return canonical(rounded, fraction.length);
}

/**
 * Every synthetic quote: `{date, currency, perEuro}` for each business day of the last `days`
 * days (UTC, ending `today`) and each currency in `baseRates`. A quote drifts within ±1.5%
 * of its level by a fixed pattern of the date and currency, so consecutive days differ.
 */
export function syntheticRates({ today = new Date(), days = 60 } = {}) {
  const rows = [];
  for (const date of businessDays(today, days)) {
    const day = Math.round(Date.parse(`${date}T00:00:00Z`) / dayMs);
    rateCurrencies.forEach((currency, index) => {
      const step = (day * 7 + index * 11) % 31; // 0–30
      rows.push({ date, currency, perEuro: moved(baseRates[currency], (step - 15) * 10) });
    });
  }
  return rows;
}

/**
 * One idempotent statement inserting `rows` into the API's cache: rows already there (the
 * same publication and currency) are kept. Values are generated here, never user input.
 */
export function ratesSql(rows) {
  for (const row of rows)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^[A-Z]{3}$/.test(row.currency) || !/^\d+(\.\d+)?$/.test(row.perEuro))
      throw new Error("Synthetic rates are dates, currency codes and decimals.");
  const values = rows.map((row) => `('${row.date}','${row.currency}','${row.perEuro}')`).join(",\n");
  return `INSERT INTO penny.exchange_rates (rate_date, currency, per_euro) VALUES\n${values}\nON CONFLICT (rate_date, currency) DO NOTHING;\n`;
}
