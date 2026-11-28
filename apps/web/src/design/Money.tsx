import { currencyInfo } from "@domain/currency.ts";
import { cx } from "./controls";
import { useCountUp } from "./motion";

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
  return formatter(currency, options.signed).format(cents / scaleOf(currency)).replace("-", MINUS);
}

/**
 * "Cents" are the currency's minor units (MAZ-151 phase 2: a yen trip has none, a dinar has three),
 * so an amount divides by 10^units; a currency not in the shared list keeps two.
 */
const unitsOf = (currency: string | undefined) => (currency ? (currencyInfo(currency)?.minorUnits ?? 2) : 2);
const scaleOf = (currency: string | undefined) => 10 ** unitsOf(currency);

/** Whole units only ("$1,883"), for compact legends such as Home's Follow your money (`iphone-home`). */
export function formatWhole(cents: number, currency?: string): string {
  return formatter(currency, false, 0).format(cents / scaleOf(currency)).replace("-", MINUS);
}

function formatter(currency: string | undefined, signed: boolean | undefined, digits?: number): Intl.NumberFormat {
  const format: Intl.NumberFormatOptions = currency
    ? { style: "currency", currency }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const fraction = digits ?? (currency ? unitsOf(currency) : undefined);
  if (fraction !== undefined) Object.assign(format, { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
  if (signed) format.signDisplay = "exceptZero";
  return new Intl.NumberFormat("en-CA", format);
}

/**
 * A hero amount (Left to spend, a household's balance): the cards draw the cents smaller and
 * dimmed after the whole units ("$1,116" + ".65"). `showCents: false` shows whole units only.
 * The text reads the same as `formatCents`, so a screen reader hears one number.
 */
export function HeroMoney({
  cents,
  currency,
  showCents = true,
  className,
  countFrom,
}: {
  cents: number;
  currency?: string | undefined;
  showCents?: boolean;
  className?: string;
  /** Where the first count starts (the recap counts up from 0 when it first appears, MAZ-292). */
  countFrom?: number;
}) {
  // Saving and month changes: the number counts to its new value (docs/design/motion.md). While it
  // counts, assistive technology reads only the final value.
  const { value, counting } = useCountUp(cents, countFrom);
  if (counting) {
    return (
      <span className={cx("pk-num", "money", "hero-money", className)}>
        <span aria-hidden="true">
          <HeroDigits cents={value} currency={currency} showCents={showCents} />
        </span>
        <span className="visually-hidden">{formatter(currency, false, showCents ? undefined : 0).format(cents / scaleOf(currency)).replace("-", MINUS)}</span>
      </span>
    );
  }
  return (
    <span className={cx("pk-num", "money", "hero-money", className)}>
      <HeroDigits cents={cents} currency={currency} showCents={showCents} />
    </span>
  );
}

function HeroDigits({ cents, currency, showCents }: { cents: number; currency: string | undefined; showCents: boolean }) {
  const parts = formatter(currency, false, showCents ? undefined : 0).formatToParts(cents / scaleOf(currency));
  const split = parts.findIndex((part) => part.type === "decimal");
  const text = (list: Intl.NumberFormatPart[]) => list.map((part) => (part.type === "minusSign" ? MINUS : part.value)).join("");
  const whole = text(split < 0 ? parts : parts.slice(0, split));
  const fraction = split < 0 ? "" : text(parts.slice(split));
  return (
    <>
      {whole}
      {fraction ? <span className="hero-money__cents">{fraction}</span> : null}
    </>
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
  /** A total that counts to its new value when it changes (docs/design/motion.md), e.g. a day's total. */
  count?: boolean;
  /** With `count`: the value the first count starts from (the recap counts up from 0, MAZ-292). */
  countFrom?: number;
}

/**
 * An aligned money value (tabular figures). Tone adds a color and, for screen readers, the word
 * it stands for, so meaning never rests on color alone.
 */
export function Money({ count, countFrom, ...props }: MoneyProps) {
  return count ? <CountingMoney {...props} {...(countFrom === undefined ? {} : { countFrom })} /> : <StaticMoney {...props} />;
}

function CountingMoney({ countFrom, ...props }: Omit<MoneyProps, "count">) {
  const { value, counting } = useCountUp(props.cents, countFrom);
  if (!counting) return <StaticMoney {...props} />;
  return (
    <span className="money--counting">
      <span aria-hidden="true">
        <StaticMoney {...props} cents={value} />
      </span>
      <span className="visually-hidden">
        <StaticMoney {...props} />
      </span>
    </span>
  );
}

function StaticMoney({ cents, currency, tone = "expense", signed, className }: Omit<MoneyProps, "count">) {
  const label = TONE_LABEL[tone];
  return (
    <span className={cx("pk-num", "money", tone !== "expense" && `pk-money--${tone}`, className)}>
      {formatCents(cents, currency, signed ? { signed } : {})}
      {label ? <span className="visually-hidden"> {label}</span> : null}
    </span>
  );
}
