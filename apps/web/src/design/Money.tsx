import { cx } from "./controls";

export type MoneyTone = "expense" | "income" | "investment" | "pending" | "muted";

/** The typographic minus (U+2212) the cards use before negative amounts. */
const MINUS = "\u2212";

/**
 * Formats integer cents. With a currency it uses that currency's symbol; without one (the ledger
 * currency couldn't be read) it is a plain two-decimal number, never an assumed currency.
 * Negative amounts use the typographic minus directly before the number ("−$48.90"), as on the
 * cards (MAZ-222); screen readers read it as "minus".
 */
export function formatCents(cents: number, currency?: string, options: { signed?: boolean } = {}): string {
  return formatter(currency, options.signed).format(cents / 100).replace("-", MINUS);
}

function formatter(currency: string | undefined, signed: boolean | undefined, digits?: number): Intl.NumberFormat {
  const format: Intl.NumberFormatOptions = currency
    ? { style: "currency", currency }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (digits !== undefined) Object.assign(format, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (signed) format.signDisplay = "exceptZero";
  return new Intl.NumberFormat("en-CA", format);
}

/**
 * A hero amount (Left to spend, a household's balance): the cards draw the cents smaller and
 * dimmed after the whole units ("$1,116" + ".65"). `showCents: false` shows whole units only.
 * The text reads the same as `formatCents`, so a screen reader hears one number.
 */
export function HeroMoney({ cents, currency, showCents = true, className }: { cents: number; currency?: string | undefined; showCents?: boolean; className?: string }) {
  const parts = formatter(currency, false, showCents ? undefined : 0).formatToParts(cents / 100);
  const split = parts.findIndex((part) => part.type === "decimal");
  const text = (list: Intl.NumberFormatPart[]) => list.map((part) => (part.type === "minusSign" ? MINUS : part.value)).join("");
  const whole = text(split < 0 ? parts : parts.slice(0, split));
  const fraction = split < 0 ? "" : text(parts.slice(split));
  return (
    <span className={cx("pk-num", "money", "hero-money", className)}>
      {whole}
      {fraction ? <span className="hero-money__cents">{fraction}</span> : null}
    </span>
  );
}

const TONE_LABEL: Partial<Record<MoneyTone, string>> = { income: "income", investment: "invested", pending: "expected" };

interface MoneyProps {
  cents: number;
  currency?: string | undefined;
  /** Meaning colors (kit `Money`): expenses use the label color; income green, investments indigo, pending amber. */
  tone?: MoneyTone;
  signed?: boolean;
  className?: string;
}

/**
 * An aligned money value (tabular figures). Tone adds a color and, for screen readers, the word
 * it stands for, so meaning never rests on color alone.
 */
export function Money({ cents, currency, tone = "expense", signed, className }: MoneyProps) {
  const label = TONE_LABEL[tone];
  return (
    <span className={cx("pk-num", "money", tone !== "expense" && `pk-money--${tone}`, className)}>
      {formatCents(cents, currency, signed ? { signed } : {})}
      {label ? <span className="visually-hidden"> {label}</span> : null}
    </span>
  );
}
