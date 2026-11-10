import type { ReactNode } from "react";
import { cx, Icon, CategoryIcon, Money, type CategoryKey, type MoneyKind } from "./foundation";

export interface ListProps {
  children: ReactNode;
  /** Adds the 16px side margins of an inset-grouped list. Default true. */
  inset?: boolean;
}
/** Inset-grouped list surface. Put ListRow / TransactionRow children inside. */
export function List({ children, inset = true }: ListProps) {
  return <div className={cx("pk-list", inset && "pk-inset")}>{children}</div>;
}

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Leading element: CategoryIcon, Avatar or Icon. */
  leading?: ReactNode;
  /** Trailing value in secondary color (settings rows: "System", "CAD"). */
  value?: ReactNode;
  /** Trailing custom element (Switch, Badge, Money). */
  trailing?: ReactNode;
  chevron?: boolean;
  selected?: boolean;
  /** Settings-style row without the 60px min height. */
  compact?: boolean;
  /** Red title for rows like "Sign out" / "Remove schedule". */
  destructive?: boolean;
  onClick?: () => void;
}
/** Generic list row: settings, people, schedules, pickers. */
export function ListRow({ title, subtitle, leading, value, trailing, chevron, selected, compact, destructive, onClick }: ListRowProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick}
      className={cx("pk-row", compact && "pk-row--compact", selected && "pk-row--selected", destructive && "pk-row--destructive")}>
      {leading}
      <span className="pk-row__body">
        <span className="pk-row__title" style={compact ? { fontWeight: 400 } : undefined}>{title}</span>
        {subtitle && <span className="pk-row__subtitle">{subtitle}</span>}
      </span>
      {value != null && <span className="pk-row__value">{value}</span>}
      {trailing}
      {chevron && <span className="pk-row__chev"><Icon name="chevron-forward" size={14} weight={56} /></span>}
    </Tag>
  );
}

export interface TransactionRowProps {
  title: string;
  /** Date · account · split info, e.g. "Today · Visa · split 2 ways". */
  meta?: string;
  category?: CategoryKey;
  amount: number;
  kind?: MoneyKind;
  /** Small line under the amount, e.g. "your share" or "of $12.80". Keep it rare. */
  note?: string;
  selected?: boolean;
  onClick?: () => void;
}
/** A ledger entry row: category tile, title, meta line, signed amount. */
export function TransactionRow({ title, meta, category = "other", amount, kind = "expense", note, selected, onClick }: TransactionRowProps) {
  const cat = kind === "income" && category === "other" ? "income" : kind === "investment" && category === "other" ? "investment" : category;
  return (
    <ListRow onClick={onClick} selected={selected} leading={<CategoryIcon category={cat} />} title={title} subtitle={meta}
      trailing={<span className="pk-row__trail"><Money value={amount} kind={kind} unsigned={kind === "investment"} />
        {note && <span className="pk-row__note">{note}</span>}</span>} />
  );
}

export interface CardProps {
  children: ReactNode;
  /** Liquid Glass surface - only for cards floating over the hero glow. */
  glass?: boolean;
  /** Adds the 16px side margins. Default true. */
  inset?: boolean;
  padding?: number;
}
/** Solid content surface with the 26px card radius. */
export function Card({ children, glass, inset = true, padding }: CardProps) {
  return <div className={cx("pk-card", glass && "pk-glass", inset && "pk-inset")} style={padding != null ? { padding } : undefined}>{children}</div>;
}
