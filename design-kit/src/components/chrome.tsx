import type { ReactNode } from "react";
import type { IconName } from "../icons";
import { cx, Icon } from "./foundation";
import { GlassButton } from "./controls";

export interface ScreenProps {
  device?: "iphone" | "ipad";
  /** Soft gradient behind the top of the screen: copper on Home, green on a household. */
  glow?: "none" | "copper" | "green";
  /** Fixed bottom bar: TabBar, a search field, or a Toast + TabBar stack. */
  bottom?: ReactNode;
  /** Status bar text color, e.g. "#fff" over a dimmed sheet backdrop. */
  statusColor?: string;
  /** Drop the device bezel (for flat artboards). */
  bare?: boolean;
  children?: ReactNode;
}
/**
 * Device artboard: iPhone (402x874 pt) or iPad landscape (1210x834 pt) with status bar, Dynamic
 * Island, home indicator and optional hero glow. Content starts below the status bar.
 */
export function Screen({ device = "iphone", glow = "none", bottom, statusColor, bare, children }: ScreenProps) {
  return (
    <div className={cx("pk-screen", `pk-screen--${device}`, bare && "pk-screen--bare")}>
      {glow !== "none" && <div className="pk-screen__glow" style={{ background: `var(--pk-glow-${glow})` }} />}
      {device === "iphone" && <div className="pk-screen__island" />}
      <div className="pk-screen__status" style={{ color: statusColor }}>
        <span>{device === "ipad" ? "9:41  Mon Nov 9" : "9:41"}</span>
        <span style={{ display: "flex", gap: 6 }}><Icon name="wifi" size={18} weight={40} /><Icon name="battery-full" size={18} weight={40} /></span>
      </div>
      <div className="pk-screen__body">{children}</div>
      {bottom && <div className="pk-screen__bottom">{bottom}</div>}
      <div className="pk-screen__home" />
    </div>
  );
}

export interface TabItem { key: string; label: string; icon: IconName }
export const PENNY_TABS: TabItem[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "activity", label: "Activity", icon: "list" },
  { key: "shared", label: "Shared", icon: "people" },
  { key: "trips", label: "Trips", icon: "airplane" },
];
export interface TabBarProps {
  /** Key of the selected tab. */
  active: string;
  /** Defaults to Penny's four tabs: Home, Activity, Shared, Trips. */
  items?: TabItem[];
  /** Shows the separate tinted + button (add entry). Default true. */
  showAdd?: boolean;
  onSelect?: (key: string) => void;
  onAdd?: () => void;
}
/** iOS 26 floating glass tab bar with Penny's separate add button. Pass to Screen's `bottom`. */
export function TabBar({ active, items = PENNY_TABS, showAdd = true, onSelect, onAdd }: TabBarProps) {
  return (
    <div className="pk-tabbar">
      <div className="pk-tabbar__tabs pk-glass">
        {items.map((t) => (
          <button key={t.key} type="button" onClick={() => onSelect?.(t.key)} className={cx("pk-tab", t.key === active && "pk-tab--on")}>
            <Icon name={t.icon} size={24} />{t.label}
          </button>
        ))}
      </div>
      {showAdd && <GlassButton icon="add" tinted large ariaLabel="Add entry" onClick={onAdd} />}
    </div>
  );
}

export interface SidebarItem { key: string; label: string; icon: IconName; badge?: string }
export interface SidebarSection { heading?: string; items: SidebarItem[] }
export interface SidebarProps {
  active: string;
  sections: SidebarSection[];
  /** Footer: account name and sync status. */
  user?: { initials: string; name: string; status: string };
  onSelect?: (key: string) => void;
}
/** iPad floating glass sidebar (NavigationSplitView). Households and trips are listed directly. */
export function Sidebar({ active, sections, user, onSelect }: SidebarProps) {
  return (
    <nav className="pk-sidebar pk-glass">
      <div className="pk-sidebar__brand"><span className="pk-sidebar__logo"><Icon name="leaf" size={20} weight={40} /></span>penny.</div>
      {sections.map((s, i) => (
        <div key={i}>
          {s.heading && <div className="pk-sidebar__heading">{s.heading}</div>}
          {s.items.map((it) => (
            <button key={it.key} type="button" onClick={() => onSelect?.(it.key)} className={cx("pk-navitem", it.key === active && "pk-navitem--on")}>
              <Icon name={it.icon} size={21} />{it.label}{it.badge && <span className="pk-navitem__badge">{it.badge}</span>}
            </button>
          ))}
        </div>
      ))}
      {user && <div className="pk-sidebar__foot">
        <span className="pk-avatar" style={{ width: 34, height: 34, fontSize: 13, border: 0 }}>{user.initials}</span>
        <div><b>{user.name}</b><span>{user.status}</span></div>
        <span style={{ marginLeft: "auto", color: "var(--pk-label-2)" }}><Icon name="settings" /></span>
      </div>}
    </nav>
  );
}

export interface SheetProps {
  title?: string;
  subtitle?: string;
  /** Replaces the title, e.g. a SegmentedControl (Expense / Income / Invest). */
  center?: ReactNode;
  /** Shows the close (×) button. Default true. */
  closable?: boolean;
  /** Shows the tinted check (save) button. */
  confirm?: boolean;
  confirmDisabled?: boolean;
  /** Use the grouped background (gray) for form sheets with lists. */
  grouped?: boolean;
  children?: ReactNode;
  onClose?: () => void;
  onConfirm?: () => void;
}
/** Bottom sheet with grabber and a glass toolbar: × on the left, ✓ (save) on the right. */
export function Sheet({ title, subtitle, center, closable = true, confirm, confirmDisabled, grouped, children, onClose, onConfirm }: SheetProps) {
  return (
    <div className={cx("pk-sheet", grouped && "pk-sheet--grouped")}>
      <div className="pk-sheet__grabber" />
      <div className="pk-sheet__bar">
        {closable ? <GlassButton icon="close" plain ariaLabel="Close" onClick={onClose} /> : <span style={{ width: 44 }} />}
        <div className="pk-sheet__titles">{center ?? <>
          {title && <div className="pk-sheet__title">{title}</div>}
          {subtitle && <div className="pk-sheet__subtitle">{subtitle}</div>}</>}</div>
        {confirm ? <GlassButton icon="checkmark" tinted disabled={confirmDisabled} ariaLabel="Save" onClick={onConfirm} /> : <span style={{ width: 44 }} />}
      </div>
      <div className="pk-sheet__content">{children}</div>
    </div>
  );
}

export interface AmountEntryProps {
  /** Typed amount as a string, e.g. "74.40". */
  value: string;
  /** Tints the number by meaning (income green, investment indigo). */
  kind?: "expense" | "income" | "investment";
  currency?: string;
  /** Blinking-caret look while editing. Default true. */
  editing?: boolean;
}
/** The large amount at the top of the add-entry sheet. */
export function AmountEntry({ value, kind = "expense", currency = "CAD", editing = true }: AmountEntryProps) {
  return (
    <div className="pk-amount">
      <div className={cx("pk-amount__value pk-num", kind !== "expense" && `pk-money--${kind}`)}>
        <span className="pk-amount__cur">$</span>{value}{editing && <span className="pk-amount__caret" />}
      </div>
      <span className="pk-amount__code">{currency}</span>
    </div>
  );
}

export interface KeypadProps {
  onKey?: (key: string) => void;
}
/** Decimal keypad that stays visible under the add-entry sheet on iPhone. */
export function Keypad({ onKey }: KeypadProps) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
  return (
    <div className="pk-keypad">
      {keys.map((k) => (
        <button key={k} type="button" className={cx("pk-key", (k === "." || k === "⌫") && "pk-key--ghost")} onClick={() => onKey?.(k)}>
          {k === "⌫" ? <Icon name="chevron-back" /> : k}
        </button>
      ))}
    </div>
  );
}

export interface BannerProps {
  /** offline: glass, amber icon; error: red tint; info: amber tint (expected money, notes). */
  tone: "offline" | "error" | "info";
  title: string;
  message?: string;
  /** Trailing action, e.g. a small Button ("Retry", "Try again"). */
  action?: ReactNode;
}
/** Inline status banner. Every failure names what happened and the next step, and keeps the user's draft. */
export function Banner({ tone, title, message, action }: BannerProps) {
  const icon: IconName = tone === "offline" ? "cloud-offline" : tone === "error" ? "alert-circle" : "time";
  return (
    <div className={cx("pk-banner", `pk-banner--${tone}`, tone === "offline" && "pk-glass")}>
      <Icon name={icon} size={20} />
      <div className="pk-banner__body"><div className="pk-banner__title">{title}</div>{message && <div className="pk-banner__msg">{message}</div>}</div>
      {action}
    </div>
  );
}

export interface ToastProps {
  title: string;
  subtitle?: string;
  /** Leading element, usually a CategoryIcon. */
  leading?: ReactNode;
  /** Text action, e.g. "Undo". */
  action?: string;
  onAction?: () => void;
}
/** Glass confirmation toast above the tab bar ("Expense added · Undo"). Replaces success screens. */
export function Toast({ title, subtitle, leading, action, onAction }: ToastProps) {
  return (
    <div className="pk-toast pk-glass">
      {leading}
      <div className="pk-toast__body"><div className="pk-toast__title">{title}</div>{subtitle && <div className="pk-toast__sub">{subtitle}</div>}</div>
      {action && <button type="button" className="pk-btn pk-btn--secondary pk-btn--sm" style={{ color: "var(--pk-tint-text)" }} onClick={onAction}>{action}</button>}
    </div>
  );
}
