import type { ReactNode } from "react";
import type { IconName } from "../icons";
import { cx, Icon } from "./foundation";

export interface KbdProps { children: ReactNode }
/** Keyboard shortcut chip, e.g. ⌘K, N, Esc. Show shortcuts next to the actions they trigger on web. */
export function Kbd({ children }: KbdProps) {
  return <kbd className="pk-kbd">{children}</kbd>;
}

export interface WebFrameProps {
  /** Address shown in the browser bar. */
  url?: string;
  /** Left navigation, usually a WebSidebar. Omit for signed-out pages. */
  sidebar?: ReactNode;
  /** Hero glow behind the top of the main column. */
  glow?: "none" | "copper" | "green";
  /** Drop the browser window chrome and shadow. */
  bare?: boolean;
  /** Overlays above the page (dialog + scrim). */
  overlay?: ReactNode;
  children?: ReactNode;
}
/** Desktop browser artboard (1440×900): window chrome, optional sidebar, main column. Put TopBar first in children. */
export function WebFrame({ url = "penny.example.com", sidebar, glow = "none", bare, overlay, children }: WebFrameProps) {
  return (
    <div className={cx("pk-web", bare && "pk-web--bare")}>
      {!bare && <div className="pk-web__chrome"><span className="pk-web__lights"><i /><i /><i /></span>
        <span className="pk-web__url"><Icon name="lock-closed" size={12} />{url}</span><span style={{ width: 52 }} /></div>}
      <div className="pk-web__page">
        {sidebar}
        <main className="pk-web__main">
          {glow !== "none" && <div className="pk-web__glow" style={{ background: `var(--pk-glow-${glow})` }} />}
          {children}
        </main>
      </div>
      {overlay && <div style={{ position: "absolute", inset: bare ? 0 : "40px 0 0 0", background: "var(--pk-dim)", zIndex: 20, display: "grid", placeItems: "start center", paddingTop: 80 }}>{overlay}</div>}
    </div>
  );
}

export interface WebNavItem { key: string; label: string; icon: IconName; badge?: string; shortcut?: string }
export interface WebSidebarProps {
  active: string;
  sections: { heading?: string; items: WebNavItem[] }[];
  user?: { initials: string; name: string; status: string };
  onSelect?: (key: string) => void;
}
/** Desktop sidebar: brand, sections (main, Together, Manage), account footer with sync status. */
export function WebSidebar({ active, sections, user, onSelect }: WebSidebarProps) {
  return (
    <aside className="pk-wside">
      <div className="pk-sidebar__brand" style={{ padding: "4px 10px 18px", fontSize: 21 }}><span className="pk-sidebar__logo" style={{ width: 30, height: 30, borderRadius: 9 }}><Icon name="leaf" size={18} weight={40} /></span>penny.</div>
      {sections.map((s, i) => (
        <div key={i}>
          {s.heading && <div className="pk-sidebar__heading" style={{ fontSize: 11.5, padding: "16px 10px 6px" }}>{s.heading}</div>}
          {s.items.map((it) => (
            <button key={it.key} type="button" onClick={() => onSelect?.(it.key)} className={cx("pk-wnav", it.key === active && "pk-wnav--on")}>
              <Icon name={it.icon} size={18} />{it.label}
              {it.badge ? <span className="pk-wnav__end">{it.badge}</span> : it.shortcut ? <span className="pk-wnav__end"><Kbd>{it.shortcut}</Kbd></span> : null}
            </button>
          ))}
        </div>
      ))}
      {user && <div className="pk-sidebar__foot" style={{ padding: 10 }}>
        <span className="pk-avatar" style={{ width: 32, height: 32, fontSize: 12, border: 0 }}>{user.initials}</span>
        <div><b>{user.name}</b><span style={{ display: "flex", alignItems: "center", gap: 4 }}><Icon name="cloud-done" size={13} />{user.status}</span></div>
        <span style={{ marginLeft: "auto", color: "var(--pk-label-2)" }}><Icon name="settings" size={18} /></span>
      </div>}
    </aside>
  );
}

export interface TopBarProps {
  title: string;
  /** Shows a back button before the title (detail pages). */
  back?: boolean;
  /** Month switcher label, e.g. "November 2026". */
  month?: string;
  /** Show the ⌘K search field. Default true. */
  search?: boolean;
  /** Primary action label. Default "Add entry" with shortcut N. Pass null to hide. */
  primary?: string | null;
  primaryShortcut?: string;
  /** Extra buttons before the primary action (WebButton). */
  actions?: ReactNode;
}
/** Page header for web: title, month switcher, search and one copper primary action. */
export function TopBar({ title, back, month, search = true, primary = "Add entry", primaryShortcut = "N", actions }: TopBarProps) {
  return (
    <div className="pk-topbar">
      {back && <WebButton icon="chevron-back" ariaLabel="Back" />}
      <h1>{title}</h1>
      {month && <div className="pk-month"><button type="button" aria-label="Previous month"><Icon name="chevron-back" size={15} weight={48} /></button>
        <span>{month}</span><button type="button" aria-label="Next month"><Icon name="chevron-forward" size={15} weight={48} /></button></div>}
      <div className="pk-topbar__sp" />
      {search && <SearchField />}
      {actions}
      {primary && <WebButton primary icon="add" shortcut={primaryShortcut}>{primary}</WebButton>}
    </div>
  );
}

export interface WebButtonProps {
  children?: ReactNode;
  icon?: IconName;
  /** Copper fill - one per page. */
  primary?: boolean;
  shortcut?: string;
  ariaLabel?: string;
  onClick?: () => void;
}
/** Compact 36px desktop button. Icon-only renders square. */
export function WebButton({ children, icon, primary, shortcut, ariaLabel, onClick }: WebButtonProps) {
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} className={cx("pk-wbtn", primary && "pk-wbtn--primary", !children && "pk-wbtn--icon")}>
      {icon && <Icon name={icon} size={16} weight={44} />}{children}{shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}

export interface SearchFieldProps { placeholder?: string; shortcut?: string }
/** Desktop search field with its ⌘K shortcut. */
export function SearchField({ placeholder = "Search entries", shortcut = "⌘K" }: SearchFieldProps) {
  return <div className="pk-search" role="search"><Icon name="search" size={15} />{placeholder}<Kbd>{shortcut}</Kbd></div>;
}

export interface DataColumn { key: string; label: string; align?: "left" | "right"; width?: number }
export interface DataRow { id: string; cells: Record<string, ReactNode>; selected?: boolean }
export interface DataGroup { label: string; total?: ReactNode; rows: DataRow[] }
export interface DataTableProps {
  columns: DataColumn[];
  /** Grouped rows (day groups with totals). Use `rows` for an ungrouped table. */
  groups?: DataGroup[];
  rows?: DataRow[];
  /** Wrap in a panel surface. Default true. */
  panel?: boolean;
}
/** Dense desktop table: uppercase headers, day groups with totals, hover and selected rows. Right-align money columns. */
export function DataTable({ columns, groups, rows, panel = true }: DataTableProps) {
  const row = (r: DataRow) => (
    <tr key={r.id} className={r.selected ? "pk-sel" : undefined}>
      {columns.map((c) => <td key={c.key} className={c.align === "right" ? "pk-r pk-num" : undefined}>{r.cells[c.key] ?? <span className="pk-muted">—</span>}</td>)}
    </tr>
  );
  const table = (
    <table className="pk-table">
      <thead><tr>{columns.map((c) => <th key={c.key} className={c.align === "right" ? "pk-r" : undefined} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr></thead>
      <tbody>
        {groups ? groups.flatMap((g) => [
          <tr key={`g-${g.label}`} className="pk-group"><td colSpan={columns.length - 1}>{g.label}</td><td className="pk-r pk-num">{g.total}</td></tr>,
          ...g.rows.map(row),
        ]) : rows?.map(row)}
      </tbody>
    </table>
  );
  return panel ? <div className="pk-table__wrap">{table}</div> : table;
}

export interface DialogProps {
  title: string;
  /** Header control, e.g. a SegmentedControl (Expense / Income / Invest). */
  headerExtra?: ReactNode;
  /** Keyboard hint on the left of the footer. */
  hint?: ReactNode;
  /** Footer buttons (WebButton). */
  actions?: ReactNode;
  width?: number;
  children?: ReactNode;
}
/** Centered desktop dialog (replaces sheets on web). Pass as WebFrame `overlay`. Esc cancels, ⌘↵ saves. */
export function Dialog({ title, headerExtra, hint, actions, width = 760, children }: DialogProps) {
  return (
    <div className="pk-dialog" role="dialog" aria-label={title} style={{ width }}>
      <div className="pk-dialog__head"><h3>{title}</h3>{headerExtra}<WebButton icon="close" ariaLabel="Close" /></div>
      <div className="pk-dialog__body">{children}</div>
      {(hint || actions) && <div className="pk-dialog__foot"><span className="pk-dialog__hint">{hint}</span>{actions}</div>}
    </div>
  );
}
