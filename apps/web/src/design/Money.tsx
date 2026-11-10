import { cx } from "./controls";

export type MoneyTone = "expense" | "income" | "investment" | "pending" | "muted";

/**
 * Formats integer cents. With a currency it uses that currency's symbol; without one (the ledger
 * currency couldn't be read) it is a plain two-decimal number, never an assumed currency.
 */
export function formatCents(cents: number, currency?: string, options: { signed?: boolean } = {}): string {
  const format: Intl.NumberFormatOptions = currency
    ? { style: "currency", currency }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (options.signed) format.signDisplay = "exceptZero";
  return new Intl.NumberFormat("en-CA", format).format(cents / 100);
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
