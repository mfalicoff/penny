// Entries in several currencies (MAZ-151, contract 2.4.0). The ledger keeps one home currency
// (`Ledger.currency`) for every total; an entry may also carry the amount it was paid in, that
// currency and the rate used, while `total` and `share` keep holding home amounts so the merge
// rules, reports and older apps keep working. Golden cases: contracts/fixtures/currency.json,
// generated from this file; the Swift (`PennyDomain/Ledger/Currency.swift`) and C#
// (`Penny.Backend.Domain/Ledgers/Currencies.cs`) rules must agree with it.
//
// Rules:
// - Amounts are integers in a currency's minor units (ISO 4217): JPY has none, KWD has three.
// - A rate is a canonical decimal string: how many home units one unit of the entry's currency is
//   worth ("1.4612" for 1 EUR = 1.4612 CAD). Up to 9 integer and 8 fraction digits, no trailing
//   fraction zeros, greater than zero. Strings keep every language exact; no floating point.
// - The home amount is rounded once, half up, to the home currency's minor units. A split share is
//   computed from that rounded home total with the existing rules.
// - Cross rates are computed from rates quoted against one base (the ECB quotes per euro), rounded
//   half up to 6 significant digits, at most 8 fraction digits.
// - The rate for a date is the latest published one on or before it (weekends and holidays use the
//   last business day). A date after the latest publication uses the latest rate, provisionally.

import type { Transaction } from "./ledger.ts";

export type CurrencyInfo = {
  code: string;
  name: string;
  /** Decimal places of the currency's minor unit. */
  minorUnits: 0 | 2 | 3;
  /** Where it's used, for the picker's search ("Search currencies or countries"). */
  countries: string;
};

const c = (code: string, name: string, minorUnits: 0 | 2 | 3, countries: string): CurrencyInfo => ({ code, name, minorUnits, countries });

/** Every circulating ISO 4217 currency, A–Z by code (funds, metals and test codes are left out). */
export const currencies: readonly CurrencyInfo[] = [
  c("AED", "UAE dirham", 2, "United Arab Emirates"),
  c("AFN", "Afghan afghani", 2, "Afghanistan"),
  c("ALL", "Albanian lek", 2, "Albania"),
  c("AMD", "Armenian dram", 2, "Armenia"),
  c("AOA", "Angolan kwanza", 2, "Angola"),
  c("ARS", "Argentine peso", 2, "Argentina"),
  c("AUD", "Australian dollar", 2, "Australia, Kiribati, Nauru, Tuvalu"),
  c("AWG", "Aruban florin", 2, "Aruba"),
  c("AZN", "Azerbaijani manat", 2, "Azerbaijan"),
  c("BAM", "Bosnia and Herzegovina convertible mark", 2, "Bosnia and Herzegovina"),
  c("BBD", "Barbadian dollar", 2, "Barbados"),
  c("BDT", "Bangladeshi taka", 2, "Bangladesh"),
  c("BGN", "Bulgarian lev", 2, "Bulgaria"),
  c("BHD", "Bahraini dinar", 3, "Bahrain"),
  c("BIF", "Burundian franc", 0, "Burundi"),
  c("BMD", "Bermudian dollar", 2, "Bermuda"),
  c("BND", "Brunei dollar", 2, "Brunei"),
  c("BOB", "Bolivian boliviano", 2, "Bolivia"),
  c("BRL", "Brazilian real", 2, "Brazil"),
  c("BSD", "Bahamian dollar", 2, "Bahamas"),
  c("BTN", "Bhutanese ngultrum", 2, "Bhutan"),
  c("BWP", "Botswana pula", 2, "Botswana"),
  c("BYN", "Belarusian ruble", 2, "Belarus"),
  c("BZD", "Belize dollar", 2, "Belize"),
  c("CAD", "Canadian dollar", 2, "Canada"),
  c("CDF", "Congolese franc", 2, "Democratic Republic of the Congo"),
  c("CHF", "Swiss franc", 2, "Switzerland, Liechtenstein"),
  c("CLP", "Chilean peso", 0, "Chile"),
  c("CNY", "Chinese yuan", 2, "China"),
  c("COP", "Colombian peso", 2, "Colombia"),
  c("CRC", "Costa Rican colón", 2, "Costa Rica"),
  c("CUP", "Cuban peso", 2, "Cuba"),
  c("CVE", "Cape Verdean escudo", 2, "Cabo Verde"),
  c("CZK", "Czech koruna", 2, "Czechia"),
  c("DJF", "Djiboutian franc", 0, "Djibouti"),
  c("DKK", "Danish krone", 2, "Denmark, Greenland, Faroe Islands"),
  c("DOP", "Dominican peso", 2, "Dominican Republic"),
  c("DZD", "Algerian dinar", 2, "Algeria"),
  c("EGP", "Egyptian pound", 2, "Egypt"),
  c("ERN", "Eritrean nakfa", 2, "Eritrea"),
  c("ETB", "Ethiopian birr", 2, "Ethiopia"),
  c("EUR", "Euro", 2, "Austria, Belgium, Croatia, Cyprus, Estonia, Finland, France, Germany, Greece, Ireland, Italy, Latvia, Lithuania, Luxembourg, Malta, Netherlands, Portugal, Slovakia, Slovenia, Spain, Andorra, Monaco, San Marino, Vatican City, Montenegro, Kosovo"),
  c("FJD", "Fijian dollar", 2, "Fiji"),
  c("FKP", "Falkland Islands pound", 2, "Falkland Islands"),
  c("GBP", "Pound sterling", 2, "United Kingdom, Isle of Man, Jersey, Guernsey"),
  c("GEL", "Georgian lari", 2, "Georgia"),
  c("GHS", "Ghanaian cedi", 2, "Ghana"),
  c("GIP", "Gibraltar pound", 2, "Gibraltar"),
  c("GMD", "Gambian dalasi", 2, "Gambia"),
  c("GNF", "Guinean franc", 0, "Guinea"),
  c("GTQ", "Guatemalan quetzal", 2, "Guatemala"),
  c("GYD", "Guyanese dollar", 2, "Guyana"),
  c("HKD", "Hong Kong dollar", 2, "Hong Kong"),
  c("HNL", "Honduran lempira", 2, "Honduras"),
  c("HTG", "Haitian gourde", 2, "Haiti"),
  c("HUF", "Hungarian forint", 2, "Hungary"),
  c("IDR", "Indonesian rupiah", 2, "Indonesia"),
  c("ILS", "Israeli new shekel", 2, "Israel, Palestine"),
  c("INR", "Indian rupee", 2, "India"),
  c("IQD", "Iraqi dinar", 3, "Iraq"),
  c("IRR", "Iranian rial", 2, "Iran"),
  c("ISK", "Icelandic króna", 0, "Iceland"),
  c("JMD", "Jamaican dollar", 2, "Jamaica"),
  c("JOD", "Jordanian dinar", 3, "Jordan"),
  c("JPY", "Japanese yen", 0, "Japan"),
  c("KES", "Kenyan shilling", 2, "Kenya"),
  c("KGS", "Kyrgyz som", 2, "Kyrgyzstan"),
  c("KHR", "Cambodian riel", 2, "Cambodia"),
  c("KMF", "Comorian franc", 0, "Comoros"),
  c("KPW", "North Korean won", 2, "North Korea"),
  c("KRW", "South Korean won", 0, "South Korea"),
  c("KWD", "Kuwaiti dinar", 3, "Kuwait"),
  c("KYD", "Cayman Islands dollar", 2, "Cayman Islands"),
  c("KZT", "Kazakhstani tenge", 2, "Kazakhstan"),
  c("LAK", "Lao kip", 2, "Laos"),
  c("LBP", "Lebanese pound", 2, "Lebanon"),
  c("LKR", "Sri Lankan rupee", 2, "Sri Lanka"),
  c("LRD", "Liberian dollar", 2, "Liberia"),
  c("LSL", "Lesotho loti", 2, "Lesotho"),
  c("LYD", "Libyan dinar", 3, "Libya"),
  c("MAD", "Moroccan dirham", 2, "Morocco"),
  c("MDL", "Moldovan leu", 2, "Moldova"),
  c("MGA", "Malagasy ariary", 2, "Madagascar"),
  c("MKD", "Macedonian denar", 2, "North Macedonia"),
  c("MMK", "Myanmar kyat", 2, "Myanmar"),
  c("MNT", "Mongolian tögrög", 2, "Mongolia"),
  c("MOP", "Macanese pataca", 2, "Macao"),
  c("MRU", "Mauritanian ouguiya", 2, "Mauritania"),
  c("MUR", "Mauritian rupee", 2, "Mauritius"),
  c("MVR", "Maldivian rufiyaa", 2, "Maldives"),
  c("MWK", "Malawian kwacha", 2, "Malawi"),
  c("MXN", "Mexican peso", 2, "Mexico"),
  c("MYR", "Malaysian ringgit", 2, "Malaysia"),
  c("MZN", "Mozambican metical", 2, "Mozambique"),
  c("NAD", "Namibian dollar", 2, "Namibia"),
  c("NGN", "Nigerian naira", 2, "Nigeria"),
  c("NIO", "Nicaraguan córdoba", 2, "Nicaragua"),
  c("NOK", "Norwegian krone", 2, "Norway, Svalbard"),
  c("NPR", "Nepalese rupee", 2, "Nepal"),
  c("NZD", "New Zealand dollar", 2, "New Zealand, Cook Islands, Niue"),
  c("OMR", "Omani rial", 3, "Oman"),
  c("PAB", "Panamanian balboa", 2, "Panama"),
  c("PEN", "Peruvian sol", 2, "Peru"),
  c("PGK", "Papua New Guinean kina", 2, "Papua New Guinea"),
  c("PHP", "Philippine peso", 2, "Philippines"),
  c("PKR", "Pakistani rupee", 2, "Pakistan"),
  c("PLN", "Polish złoty", 2, "Poland"),
  c("PYG", "Paraguayan guaraní", 0, "Paraguay"),
  c("QAR", "Qatari riyal", 2, "Qatar"),
  c("RON", "Romanian leu", 2, "Romania"),
  c("RSD", "Serbian dinar", 2, "Serbia"),
  c("RUB", "Russian ruble", 2, "Russia"),
  c("RWF", "Rwandan franc", 0, "Rwanda"),
  c("SAR", "Saudi riyal", 2, "Saudi Arabia"),
  c("SBD", "Solomon Islands dollar", 2, "Solomon Islands"),
  c("SCR", "Seychellois rupee", 2, "Seychelles"),
  c("SDG", "Sudanese pound", 2, "Sudan"),
  c("SEK", "Swedish krona", 2, "Sweden"),
  c("SGD", "Singapore dollar", 2, "Singapore"),
  c("SHP", "Saint Helena pound", 2, "Saint Helena"),
  c("SLE", "Sierra Leonean leone", 2, "Sierra Leone"),
  c("SOS", "Somali shilling", 2, "Somalia"),
  c("SRD", "Surinamese dollar", 2, "Suriname"),
  c("SSP", "South Sudanese pound", 2, "South Sudan"),
  c("STN", "São Tomé and Príncipe dobra", 2, "São Tomé and Príncipe"),
  c("SVC", "Salvadoran colón", 2, "El Salvador"),
  c("SYP", "Syrian pound", 2, "Syria"),
  c("SZL", "Swazi lilangeni", 2, "Eswatini"),
  c("THB", "Thai baht", 2, "Thailand"),
  c("TJS", "Tajikistani somoni", 2, "Tajikistan"),
  c("TMT", "Turkmenistani manat", 2, "Turkmenistan"),
  c("TND", "Tunisian dinar", 3, "Tunisia"),
  c("TOP", "Tongan paʻanga", 2, "Tonga"),
  c("TRY", "Turkish lira", 2, "Türkiye, Northern Cyprus"),
  c("TTD", "Trinidad and Tobago dollar", 2, "Trinidad and Tobago"),
  c("TWD", "New Taiwan dollar", 2, "Taiwan"),
  c("TZS", "Tanzanian shilling", 2, "Tanzania"),
  c("UAH", "Ukrainian hryvnia", 2, "Ukraine"),
  c("UGX", "Ugandan shilling", 0, "Uganda"),
  c("USD", "US dollar", 2, "United States, Ecuador, El Salvador, Panama, Puerto Rico, Timor-Leste, Zimbabwe"),
  c("UYU", "Uruguayan peso", 2, "Uruguay"),
  c("UZS", "Uzbekistani sum", 2, "Uzbekistan"),
  c("VES", "Venezuelan bolívar", 2, "Venezuela"),
  c("VND", "Vietnamese đồng", 0, "Vietnam"),
  c("VUV", "Vanuatu vatu", 0, "Vanuatu"),
  c("WST", "Samoan tālā", 2, "Samoa"),
  c("XAF", "Central African CFA franc", 0, "Cameroon, Central African Republic, Chad, Republic of the Congo, Equatorial Guinea, Gabon"),
  c("XCD", "East Caribbean dollar", 2, "Antigua and Barbuda, Dominica, Grenada, Saint Kitts and Nevis, Saint Lucia, Saint Vincent and the Grenadines, Anguilla, Montserrat"),
  c("XCG", "Caribbean guilder", 2, "Curaçao, Sint Maarten"),
  c("XOF", "West African CFA franc", 0, "Benin, Burkina Faso, Côte d'Ivoire, Guinea-Bissau, Mali, Niger, Senegal, Togo"),
  c("XPF", "CFP franc", 0, "French Polynesia, New Caledonia, Wallis and Futuna"),
  c("YER", "Yemeni rial", 2, "Yemen"),
  c("ZAR", "South African rand", 2, "South Africa"),
  c("ZMW", "Zambian kwacha", 2, "Zambia"),
  c("ZWG", "Zimbabwe Gold", 2, "Zimbabwe"),
];

const byCode = new Map(currencies.map((info) => [info.code, info]));

/** The home currencies a ledger may use today (contract 2.4.0 keeps them; every entry may use any of `currencies`). */
export const homeCurrencies = ["CAD", "USD", "EUR", "GBP"] as const;

export function currencyInfo(code: string): CurrencyInfo | undefined {
  return byCode.get(code);
}

export function isCurrency(code: string): boolean {
  return byCode.has(code);
}

export function minorUnits(code: string): 0 | 2 | 3 {
  const info = byCode.get(code);
  if (!info) throw new Error("Choose a currency from the list.");
  return info.minorUnits;
}

const decimalWords = ["no decimal places", "one decimal place", "two decimal places", "three decimal places"];

/** Parses a typed amount into the currency's minor units; `cents` is this with two places. */
export function parseAmount(value: string, code: string): number {
  const units = minorUnits(code);
  value = value.trim();
  const pattern = units === 0 ? /^\d{1,11}$/ : new RegExp(`^\\d{1,${11 - units}}([.,]\\d{0,${units}})?$`);
  if (!pattern.test(value))
    throw new Error(units === 0 ? "Enter a whole amount, with no decimal places." : `Enter an amount with up to ${decimalWords[units]}.`);
  const [whole, fraction = ""] = value.split(/[.,]/);
  return Number(whole) * 10 ** units + Number(fraction.padEnd(units, "0") || "0");
}

// A rate as an exact scaled integer: value = mantissa / 10^scale.
type Scaled = { mantissa: bigint; scale: number };
const ratePattern = /^(0|[1-9]\d{0,8})(\.\d{0,7}[1-9])?$/;

/** True for a stored rate: canonical, greater than zero, at most 9 integer and 8 fraction digits. */
export function validRate(rate: string): boolean {
  return ratePattern.test(rate) && /[1-9]/.test(rate);
}

function scaled(rate: string): Scaled {
  const [whole, fraction = ""] = rate.split(".");
  return { mantissa: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function canonical(mantissa: bigint, scale: number): string {
  let digits = mantissa.toString().padStart(scale + 1, "0");
  let whole = digits.slice(0, digits.length - scale);
  let fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  whole = whole.replace(/^0+(?=\d)/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Turns a typed rate ("1,49", "1.4900") into its canonical form ("1.49"), or throws. */
export function normalizeRate(value: string): string {
  value = value.trim().replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{0,8}))?$/.exec(value);
  if (!match) throw new Error("Enter a rate with up to eight decimal places.");
  const rate = canonical(BigInt(`${match[1]}${match[2] ?? ""}`), (match[2] ?? "").length);
  if (!validRate(rate)) throw new Error("Enter a rate greater than zero.");
  return rate;
}

const pow10 = (n: number) => 10n ** BigInt(n);
// Half-up division of nonnegative integers.
const divideHalfUp = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (denominator * 2n);

/**
 * The home amount of `amount` (minor units of `from`) at `rate` (home units per unit of `from`),
 * rounded once, half up, to the home currency's minor units.
 */
export function convertAmount(amount: number, from: string, rate: string, home: string): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Amounts are whole minor units.");
  if (!validRate(rate)) throw new Error("Enter a rate greater than zero.");
  const { mantissa, scale } = scaled(rate);
  const numerator = BigInt(amount) * mantissa * pow10(minorUnits(home));
  const denominator = pow10(scale + minorUnits(from));
  return Number(divideHalfUp(numerator, denominator));
}

/**
 * The rate of one unit of `from` in `to` when both are quoted against the same base (units per
 * base; the base itself is "1"), rounded half up to 6 significant digits and at most 8 fraction
 * digits. Null when the result rounds to zero.
 */
export function crossRate(fromPerBase: string, toPerBase: string): string | null {
  if (!validRate(fromPerBase) || !validRate(toPerBase)) throw new Error("Enter a rate greater than zero.");
  const from = scaled(fromPerBase);
  const to = scaled(toPerBase);
  // value = (to.m / 10^to.s) / (from.m / 10^from.s), kept exact as numerator / denominator.
  const numerator = to.mantissa * pow10(from.scale);
  const denominator = from.mantissa * pow10(to.scale);
  // The position of the first significant digit: floor(value * 10^16) has (integer digits + 16) digits.
  const integerDigits = ((numerator * pow10(16)) / denominator).toString().length - 16;
  const scale = Math.min(8, Math.max(0, 6 - integerDigits));
  const mantissa = divideHalfUp(numerator * pow10(scale), denominator);
  if (mantissa === 0n) return null;
  const rate = canonical(mantissa, scale);
  return validRate(rate) ? rate : null;
}

/**
 * Which publication applies to `date`, from the dates the source published (any order): the latest
 * one on or before it. A date after every publication takes the latest, provisionally. Null when
 * nothing was published on or before the date and nothing after it either (no rates at all), or
 * when the date is before the first publication.
 */
export function publishedRateDate(published: readonly string[], date: string): { date: string; provisional: boolean } | null {
  const sorted = [...published].sort();
  const latest = sorted.at(-1);
  if (latest === undefined) return null;
  if (date > latest) return { date: latest, provisional: true };
  let found: string | null = null;
  for (const day of sorted) if (day <= date) found = day;
  return found === null ? null : { date: found, provisional: false };
}

export type RateStatus = "published" | "provisional" | "edited";
export const rateStatuses: readonly RateStatus[] = ["published", "provisional", "edited"];

/** The fields an entry in another currency carries (all four, or none). */
export type ForeignAmount = {
  originalAmount: number;
  originalCurrency: string;
  rate: string;
  rateStatus: RateStatus;
  /** The publication the rate comes from; absent for an edited rate. */
  rateDate?: string;
};

export type SplitMode = "full" | "equal" | "amount" | "percent";

/**
 * The stored amounts of an entry typed in `currency`: the original amount, the home total (converted
 * when the currency isn't the home one) and the person's share. An "amount" split is typed in the
 * entry's currency and converted at the same rate; equal and percent splits work on the home total.
 */
export function entryAmounts(input: {
  amount: string;
  currency: string;
  home: string;
  rate?: string | undefined;
  mode: SplitMode;
  split: string;
}): { originalAmount: number; total: number; share: number } {
  const { currency, home, mode } = input;
  const foreign = currency !== home;
  if (foreign && input.rate === undefined) throw new Error("Enter the exchange rate.");
  const originalAmount = parseAmount(input.amount, currency);
  const toHome = (value: number) => (foreign ? convertAmount(value, currency, input.rate as string, home) : value);
  const total = toHome(originalAmount);
  if (total <= 0) throw new Error("Enter an amount greater than zero.");
  let share: number;
  if (mode === "full") share = total;
  else if (mode === "equal") {
    const people = Number(input.split);
    if (!Number.isInteger(people) || people < 2 || people > 100) throw new Error("Split between 2 and 100 people.");
    share = Math.round(total / people);
  } else if (mode === "percent") {
    const percent = parseAmount(input.split, "CAD");
    if (percent > 10000) throw new Error("Your percentage must be between 0 and 100.");
    share = Math.round((total * percent) / 10000);
  } else share = toHome(parseAmount(input.split, currency));
  if (share > total) throw new Error("Your share cannot exceed the receipt total.");
  return { originalAmount, total, share };
}

/**
 * The entry with a new rate (a provisional rate made final on sync, or a date or currency change):
 * the home total is converted again and the share follows it — the whole total stays whole, an
 * equal split is divided again, any other share keeps its proportion (half up). Entries without an
 * original currency, and edited rates (which nothing replaces), come back unchanged.
 */
export function reconvertEntry<T extends Pick<Transaction, "kind" | "total" | "share" | "participants"> & Partial<ForeignAmount>>(
  entry: T,
  home: string,
  next: { rate: string; rateStatus: RateStatus; rateDate?: string | undefined },
): T {
  if (entry.originalCurrency === undefined || entry.originalAmount === undefined || entry.rateStatus === "edited") return entry;
  const total = convertAmount(entry.originalAmount, entry.originalCurrency, next.rate, home);
  let share: number;
  if (entry.share === entry.total) share = total;
  else if (entry.participants !== undefined && Math.round(entry.total / entry.participants) === entry.share)
    share = Math.round(total / entry.participants);
  else share = entry.total === 0 ? 0 : Number(divideHalfUp(BigInt(entry.share) * BigInt(total), BigInt(entry.total)));
  const { rateDate: _previous, ...rest } = entry;
  return {
    ...rest,
    total,
    share: Math.min(share, total),
    rate: next.rate,
    rateStatus: next.rateStatus,
    ...(next.rateDate !== undefined && next.rateStatus !== "edited" ? { rateDate: next.rateDate } : {}),
  } as T;
}

/** Why the foreign-amount fields of a stored entry are invalid, or null when they're fine. */
export function foreignAmountProblem(
  entry: { total: number } & Partial<Record<keyof ForeignAmount, unknown>>,
  home: string,
): string | null {
  const present = (["originalAmount", "originalCurrency", "rate", "rateStatus"] as const).filter((key) => entry[key] !== undefined);
  if (present.length === 0) return entry.rateDate === undefined ? null : "Invalid original amount";
  if (present.length !== 4) return "Invalid original amount";
  const { originalAmount, originalCurrency, rate, rateStatus, rateDate } = entry;
  if (typeof originalCurrency !== "string" || !isCurrency(originalCurrency) || originalCurrency === home) return "Invalid original currency";
  if (typeof originalAmount !== "number" || !Number.isSafeInteger(originalAmount) || originalAmount <= 0 || originalAmount > 99999999999)
    return "Invalid original amount";
  if (typeof rate !== "string" || !validRate(rate)) return "Invalid exchange rate";
  if (typeof rateStatus !== "string" || !rateStatuses.includes(rateStatus as RateStatus)) return "Invalid exchange rate";
  if ((rateStatus === "edited") !== (rateDate === undefined)) return "Invalid exchange rate";
  if (convertAmount(originalAmount, originalCurrency, rate, home) !== entry.total) return "Invalid converted amount";
  return null;
}
