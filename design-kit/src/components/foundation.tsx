import type { CSSProperties, ReactNode } from "react";
import { ICON_SVG, type IconName } from "../icons";

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");
export { cx };

export interface PennyRootProps {
  /** Light follows the default palette; dark uses a true-black background. */
  theme?: "light" | "dark";
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}
/**
 * Root wrapper for every Penny design. Applies the Penny font, background, text color and the
 * light/dark token set. Wrap the whole design (or each device Screen) in it.
 */
export function PennyRoot({ theme = "light", children, style, className }: PennyRootProps) {
  return <div className={cx("pk-root", theme === "dark" && "pk-dark", className)} style={style}>{children}</div>;
}

export interface IconProps {
  /** Ionicons outline glyph name (stand-in for the matching SF Symbol). */
  name: IconName;
  /** Size in px. Defaults to 22. */
  size?: number;
  /** CSS color; defaults to currentColor. */
  color?: string;
  /** Stroke weight in the 512 viewBox; 36 is regular, 44 semibold. */
  weight?: number;
  style?: CSSProperties;
}
/** Line icon from Penny's icon set. Inherits the text color unless `color` is given. */
export function Icon({ name, size = 22, color, weight = 36, style }: IconProps) {
  return (
    <span className="pk-icon" aria-hidden="true"
      style={{ width: size, height: size, color, ["--sw" as string]: `${weight}px`, ...style }}
      dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 512 512">${ICON_SVG[name] ?? ""}</svg>` }} />
  );
}

export type CategoryKey = "home" | "groceries" | "transport" | "food" | "shopping" | "entertainment" | "health" | "other"
  | "salary" | "freelance" | "gifts" | "investment" | "income";
export const CATEGORIES: Record<CategoryKey, { label: string; icon: IconName; color: string }> = {
  home: { label: "Home", icon: "home", color: "var(--pk-c-home)" },
  groceries: { label: "Groceries", icon: "basket", color: "var(--pk-c-groceries)" },
  transport: { label: "Transport", icon: "bus", color: "var(--pk-c-transport)" },
  food: { label: "Food & drinks", icon: "cafe", color: "var(--pk-c-food)" },
  shopping: { label: "Shopping", icon: "bag-handle", color: "var(--pk-c-shopping)" },
  entertainment: { label: "Entertainment", icon: "musical-notes", color: "var(--pk-c-entertainment)" },
  health: { label: "Health", icon: "heart", color: "var(--pk-c-health)" },
  other: { label: "Other", icon: "ellipsis-horizontal", color: "var(--pk-c-other)" },
  salary: { label: "Salary", icon: "briefcase", color: "var(--pk-income)" },
  freelance: { label: "Freelance", icon: "laptop", color: "var(--pk-income)" },
  gifts: { label: "Gifts", icon: "gift", color: "var(--pk-income)" },
  income: { label: "Income", icon: "arrow-down", color: "var(--pk-income)" },
  investment: { label: "Investment", icon: "trending-up", color: "var(--pk-invest)" },
};

export interface CategoryIconProps {
  /** A built-in category; sets icon and color. */
  category?: CategoryKey;
  /** Override icon (custom categories). */
  icon?: IconName;
  /** Override color - use a --pk-c-* category token, never a meaning color. */
  color?: string;
  size?: "sm" | "md" | "lg";
}
/** Rounded colored tile with a white glyph, used for categories in rows, chips and pickers. */
export function CategoryIcon({ category = "other", icon, color, size = "md" }: CategoryIconProps) {
  const c = CATEGORIES[category];
  const px = { sm: 32, md: 36, lg: 52 }[size];
  return (
    <span className="pk-cat" style={{ width: px, height: px, borderRadius: px * 0.31, background: color ?? c.color }}>
      <Icon name={icon ?? c.icon} size={px * 0.53} weight={40} />
    </span>
  );
}

export type MoneyKind = "expense" | "income" | "investment" | "neutral" | "pending" | "muted";
export interface MoneyProps {
  /** Amount in dollars (CAD). Always pass a positive number; `kind` sets sign and color. */
  value: number;
  /** expense: neutral color with minus; income: green with plus; investment: indigo, unsigned. */
  kind?: MoneyKind;
  /** Hide the +/− sign. */
  unsigned?: boolean;
  /** Round to whole dollars. */
  whole?: boolean;
  style?: CSSProperties;
}
export const formatMoney = (n: number, whole = false) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
/**
 * A formatted CAD amount with Penny's color rules: expenses use the normal label color (never red),
 * income is green with "+", investments are indigo, pending is amber.
 */
export function Money({ value, kind = "neutral", unsigned, whole, style }: MoneyProps) {
  const sign = unsigned ? "" : kind === "expense" ? "−" : kind === "income" ? "+" : "";
  return <span className={cx("pk-num", kind !== "expense" && kind !== "neutral" && `pk-money--${kind}`)} style={style}>{sign}{formatMoney(Math.abs(value), whole)}</span>;
}

export interface HeroAmountProps {
  /** Small caps label above, e.g. "Left to spend". */
  label: string;
  value: number;
  /** Supporting line under the number, e.g. projected money. */
  sub?: ReactNode;
  /** Shows an amber dot before `sub` (expected / projected money). */
  subPending?: boolean;
  /** Color the number by meaning (e.g. income for "you're owed"). */
  tone?: "neutral" | "income";
  size?: "phone" | "tablet" | "compact";
  align?: "start" | "center";
}
/** The one big number that leads a screen. Cents render smaller and muted. */
export function HeroAmount({ label, value, sub, subPending, tone = "neutral", size = "phone", align = "start" }: HeroAmountProps) {
  const [d, c] = formatMoney(value).split(".");
  return (
    <div className={cx("pk-hero", size !== "phone" && `pk-hero--${size}`)} style={{ textAlign: align === "center" ? "center" : undefined }}>
      <div className="pk-eyebrow">{label}</div>
      <div className={cx("pk-hero__value pk-num", tone === "income" && "pk-money--income")}>{d}<small>.{c}</small></div>
      {sub && <div className="pk-hero__sub" style={{ justifyContent: align === "center" ? "center" : undefined }}>
        {subPending && <span className="pk-dot" style={{ background: "var(--pk-pending)" }} />}<span>{sub}</span></div>}
    </div>
  );
}
