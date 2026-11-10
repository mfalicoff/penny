import type { ReactNode } from "react";
import type { IconName } from "../icons";
import { cx, Icon } from "./foundation";

export interface GlassButtonProps {
  icon?: IconName;
  label?: string;
  /** Copper-tinted glass for the screen's primary action (save, add). */
  tinted?: boolean;
  /** Flat fill instead of glass, for controls sitting on a sheet. */
  plain?: boolean;
  /** Red label/icon for destructive toolbar actions (e.g. delete). */
  destructive?: boolean;
  /** 62px - the floating add button next to the tab bar. */
  large?: boolean;
  /** Put the icon after the label (menu capsules like "November ⌄"). */
  iconEnd?: boolean;
  disabled?: boolean;
  /** Accessible name; required when there's no label. */
  ariaLabel?: string;
  onClick?: () => void;
}
/**
 * Liquid Glass control for the layer above content: toolbar buttons, the month picker capsule,
 * sheet close/save buttons, the floating add button. Icon-only renders a 44px circle.
 */
export function GlassButton({ icon, label, tinted, plain, destructive, large, iconEnd, disabled, ariaLabel, onClick }: GlassButtonProps) {
  return (
    <button type="button" aria-label={ariaLabel ?? label} disabled={disabled} onClick={onClick}
      className={cx("pk-gbtn", !plain && "pk-glass", plain && "pk-gbtn--plain", !label && "pk-gbtn--round",
        tinted && "pk-gbtn--tinted", destructive && "pk-gbtn--danger", large && "pk-gbtn--lg")}>
      {icon && !iconEnd && <Icon name={icon} size={large ? 28 : label ? 18 : 21} weight={large ? 44 : 36} />}
      {label}
      {icon && iconEnd && <Icon name={icon} size={15} weight={52} />}
    </button>
  );
}

export interface ButtonProps {
  children: ReactNode;
  /** primary: copper fill (one per screen); secondary: gray fill; destructive: red text on red tint; quiet: copper text. */
  variant?: "primary" | "secondary" | "destructive" | "quiet";
  icon?: IconName;
  small?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
/** Filled capsule button for actions inside content (sheets, empty states, alerts). Full width unless `small`. */
export function Button({ children, variant = "primary", icon, small, disabled, onClick }: ButtonProps) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cx("pk-btn", `pk-btn--${variant}`, small && "pk-btn--sm")}>
      {icon && <Icon name={icon} size={small ? 16 : 19} />}{children}
    </button>
  );
}

export interface ToolbarProps {
  /** Usually a back GlassButton or the month picker capsule. */
  leading?: ReactNode;
  /** One to three GlassButtons. */
  trailing?: ReactNode;
  /** Inline title (pushed screens without a large title, sheets). */
  title?: string;
}
/** Top toolbar row of glass controls. Place it first inside a Screen. */
export function Toolbar({ leading, trailing, title }: ToolbarProps) {
  return (
    <div className="pk-toolbar">
      <div className="pk-toolbar__group">{leading}</div>
      {title && <div className="pk-toolbar__title">{title}</div>}
      <div className="pk-toolbar__group">{trailing}</div>
    </div>
  );
}

export interface LargeTitleProps {
  title: string;
  subtitle?: string;
}
/** iOS large title for root screens (Activity, Trips, Insights). */
export function LargeTitle({ title, subtitle }: LargeTitleProps) {
  return <div className="pk-largetitle"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>;
}

export interface SectionHeaderProps {
  title: string;
  /** Copper text action on the right, e.g. "See all". */
  action?: string;
  onAction?: () => void;
  /** Right-aligned meta text, e.g. a day total. Ignored when `action` is set. */
  meta?: ReactNode;
  /** small: uppercase list header (day groups, form sections); default: 22pt section title. */
  small?: boolean;
}
/** Heading above a list or card. */
export function SectionHeader({ title, action, onAction, meta, small }: SectionHeaderProps) {
  return (
    <div className={cx("pk-section", small && "pk-section--small")}>
      <h3>{title}</h3>
      {action ? <button type="button" className="pk-section__action" onClick={onAction}>{action}</button>
        : meta != null && <span className="pk-section__meta pk-num">{meta}</span>}
    </div>
  );
}

export interface PillProps {
  label: string;
  icon?: IconName;
  selected?: boolean;
  /** Selected background for category chips (a --pk-c-* token). Default selected style is inverted label color. */
  color?: string;
  /** Shows an × for removable filter chips. */
  removable?: boolean;
  onClick?: () => void;
}
/** Chip for filters and quick category choices. */
export function Pill({ label, icon, selected, color, removable, onClick }: PillProps) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={cx("pk-pill", selected && !color && "pk-pill--selected")}
      style={selected && color ? { background: color, color: "#fff" } : undefined}>
      {icon && <Icon name={icon} size={16} weight={44} />}{label}
      {removable && <Icon name="close" size={14} weight={48} />}
    </button>
  );
}

export interface PillGroupProps {
  children: ReactNode;
  /** Single scrolling line (filters) instead of wrapping. */
  nowrap?: boolean;
}
/** Row of Pills with standard spacing. */
export function PillGroup({ children, nowrap }: PillGroupProps) {
  return <div className="pk-pills" style={nowrap ? { flexWrap: "nowrap", overflow: "hidden" } : undefined}>{children}</div>;
}

export interface SegmentedControlProps {
  options: string[];
  value: string;
  onChange?: (value: string) => void;
}
/** Native-style segmented control: Expense/Income/Invest, Expenses/Balances/People, split modes. */
export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  return (
    <div className="pk-seg" role="tablist">
      {options.map((o) => (
        <button key={o} type="button" role="tab" aria-selected={o === value} onClick={() => onChange?.(o)}
          className={cx("pk-seg__opt", o === value && "pk-seg__opt--on")}>{o}</button>
      ))}
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  ariaLabel?: string;
}
/** Toggle. On-state is copper, not iOS green - green means income in Penny. */
export function Switch({ checked, onChange, ariaLabel }: SwitchProps) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel}
    className={cx("pk-switch", checked && "pk-switch--on")} onClick={() => onChange?.(!checked)} />;
}

export interface TextFieldProps {
  label?: string;
  value?: string;
  placeholder?: string;
  type?: "text" | "email" | "password" | "url";
  /** Error message shown under the field; outlines the field red. */
  error?: string;
  hint?: string;
  onChange?: (value: string) => void;
}
/** Filled text field with an optional floating label. */
export function TextField({ label, value, placeholder, type = "text", error, hint, onChange }: TextFieldProps) {
  return (
    <div>
      <label className={cx("pk-field", error && "pk-field--error")}>
        {label && <span className="pk-field__label">{label}</span>}
        <input type={type} value={value} placeholder={placeholder} readOnly={!onChange}
          onChange={(e) => onChange?.(e.target.value)} />
      </label>
      {(error || hint) && <span className="pk-field__hint">{error ?? hint}</span>}
    </div>
  );
}

export interface BadgeProps {
  children: ReactNode;
  /** income: settled/paid; pending: expected, waiting to sync, settles soon; danger: overdue/failed; investment; neutral: paused, personal. */
  tone?: "neutral" | "income" | "investment" | "pending" | "danger";
  icon?: IconName;
}
/** Small status tag. Always carries text - color never stands alone. */
export function Badge({ children, tone = "neutral", icon }: BadgeProps) {
  return <span className={cx("pk-badge", `pk-badge--${tone}`)}>{icon && <Icon name={icon} size={12} weight={56} />}{children}</span>;
}

export interface AvatarProps {
  /** One or two letters. */
  initials: string;
  size?: number;
}
/** Gray monogram for a person (iOS Contacts style). People never get money colors. */
export function Avatar({ initials, size = 30 }: AvatarProps) {
  return <span className="pk-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>{initials}</span>;
}

export interface AvatarStackProps {
  people: string[];
  size?: number;
}
/** Overlapping monograms for a household or trip's members. */
export function AvatarStack({ people, size = 30 }: AvatarStackProps) {
  return <span className="pk-avatars">{people.map((p) => <Avatar key={p} initials={p} size={size} />)}</span>;
}
