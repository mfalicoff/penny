import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { MANAGE_ITEMS, RECURRING } from "../../app/shell/navigation";
import { usePageTitle, usePageTitleStyle, useTopbarSlot } from "../../app/shell/pageTitle";
import { InboxNavItem, SyncLine, useRecurringCount } from "../../app/shell/Sidebar";
import { TABLET, TOUCH_TABLET, useMediaQuery } from "../../app/useMediaQuery";
import { usePreferences, type Theme } from "../../app/preferences";
import { useAccountEmail, useAccountMe } from "../../auth/account";
import { leaveDemo, useIsDemo } from "../../demo/demo";
import { Avatar, cx } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";
import { SignOutButton } from "../auth/SignOut";
import { useLedgerWorkspace } from "../organize/workspace";
import { useServerTelemetry } from "../../api/info";
import { useInboxStatus } from "../receiptInbox/useInbox";

/**
 * How Settings is laid out, from the window and the pointer:
 *
 * - `phone` (below 768px, card `iphone-settings`): the list is the `/settings` page, a sheet-like
 *   page with a centered title and a copper Done check: the profile card, then Manage,
 *   Preferences, Server and Sign out. Each section is its own page with Back to the list.
 * - `tablet` (from 768px with touch, card `ipad-settings`): the same list without Manage (the
 *   sidebar has it) beside the open section, which has its own large title.
 * - `desktop` (from 768px with a mouse, card `web-settings`): a plain section list ending in a red
 *   Sign out, beside the open section's panels. Settings opens on Appearance.
 */
export type SettingsLayoutKind = "phone" | "tablet" | "desktop";

export function useSettingsLayout(): SettingsLayoutKind {
  const tablet = useMediaQuery(TABLET);
  const touch = useMediaQuery(TOUCH_TABLET);
  if (!tablet) return "phone";
  return touch ? "tablet" : "desktop";
}

const THEME_NAMES: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

type SectionPath = "/settings/profile" | "/settings/appearance" | "/settings/currency" | "/settings/receipt-email" | "/settings/server" | "/settings/privacy" | "/settings/export";

/** Settings: the section list beside the open section (one URL per section, so Back works). */
export function SettingsLayout() {
  const layout = useSettingsLayout();
  const pathname = useRouterState({
    select: (state) => state.location.pathname.replace(/\/$/, ""),
  });
  const atIndex = pathname === "/settings";
  // Phones show the open section's own title (centered, with Back); wider, the page is Settings.
  usePageTitle(layout === "phone" ? null : "Settings");
  usePageTitleStyle(layout === "phone" ? "inline" : "large");
  return (
    <div className={cx("settings", `settings--${layout}`, atIndex ? "settings--index" : "settings--section")}>
      {layout === "phone" && atIndex ? <DoneButton /> : null}
      {layout !== "phone" || atIndex ? <SectionList layout={layout} /> : null}
      {layout === "phone" && atIndex ? null : (
        <div className="settings__pane">
          <Outlet />
        </div>
      )}
    </div>
  );
}

/** The sheet's copper check (card `iphone-settings`): closes Settings back to Home. */
function DoneButton() {
  const slot = useTopbarSlot();
  const button = (
    <Link to="/" className="glass glass-button settings__done" aria-label="Done">
      <Icon name="checkmark" size={20} weight={48} />
    </Link>
  );
  return slot ? createPortal(button, slot) : button;
}

function SectionList({ layout }: { layout: SettingsLayoutKind }) {
  const { enabled: receiptEmail } = useInboxStatus();
  const { web: reports } = useServerTelemetry();
  const { theme } = usePreferences();
  const { ledger } = useLedgerWorkspace();
  const demo = useIsDemo();
  const currency = ledger?.currency;
  const locked = ledger ? ledger.transactions.length > 0 || ledger.recurring.length > 0 : false;
  const host = window.location.host;

  if (layout === "desktop") {
    return (
      <nav aria-label="Settings sections" className="settings__nav">
        <ul className="settings__plain">
          <Row to="/settings/profile" icon="people" label="Profile" />
          <Row to="/settings/appearance" icon="sunny" label="Appearance" />
          <Row to="/settings/currency" icon="cash" label="Currency" />
          {receiptEmail ? <Row to="/settings/receipt-email" icon="receipt" label="Receipt email" /> : null}
          <Row to="/settings/server" icon="server" label="Server & sync" />
          {reports ? <Row to="/settings/privacy" icon="lock-closed" label="Privacy" /> : null}
          {demo ? null : <Row to="/settings/export" icon="document-text" label="Export data" />}
          <li>{demo ? <LeaveDemo className="settings__link settings__link--danger" /> : <SignOutButton className="settings__link settings__link--danger" />}</li>
        </ul>
      </nav>
    );
  }

  return (
    <>
      <ProfileCard layout={layout} />
      {layout === "phone" ? <ManageGroup /> : null}
      <nav aria-label="Settings sections" className="settings__nav">
        {/* The iPad card has no footnote under Preferences; the iPhone card does. */}
        <Group title="Preferences" footer={layout === "phone" && locked && currency ? "Currency is locked once your ledger has entries." : undefined}>
          <Row to="/settings/appearance" icon="sunny" label="Appearance" value={THEME_NAMES[theme]} />
          <Row to="/settings/currency" icon="cash" label="Currency" value={currency} trailing={locked ? "lock-closed" : "chevron-forward"} />
          {receiptEmail ? <Row to="/settings/receipt-email" icon="receipt" label="Receipt email" /> : null}
          {reports ? <Row to="/settings/privacy" icon="lock-closed" label="Privacy" /> : null}
        </Group>
        <Group title="Server">
          <Row to="/settings/server" icon="server" label={demo ? "Demo" : host} detail={demo ? "Sample data in this tab" : "Sign out to change servers"} trailing="lock-closed" />
        </Group>
      </nav>
      {demo ? <LeaveDemo className="settings__signout" /> : <SignOutButton className="settings__signout" icon={false} />}
    </>
  );
}

/**
 * Who is signed in, by name (else email, MAZ-171), with their picture; opens Profile. Phones add
 * whether the ledger is synced (card `iphone-settings`), tablets the email under the name
 * (card `ipad-settings`).
 */
function ProfileCard({ layout }: { layout: SettingsLayoutKind }) {
  const email = useAccountEmail();
  const me = useAccountMe();
  const demo = useIsDemo();
  const name = demo ? "Demo" : (me.displayName ?? email);
  return (
    <Link to="/settings/profile" className="settings__profile" activeOptions={{ exact: true }}>
      <span className="visually-hidden">Profile,</span> <Avatar name={name} src={demo ? undefined : me.avatarUrl} size={52} />
      <span className="settings__profile-body">
        <span className="settings__profile-name">{name}</span>
        {layout === "tablet" && !demo ? <span className="settings__profile-email">{email}</span> : <SyncLine />}
      </span>
      <Icon name="chevron-forward" size={16} />
    </Link>
  );
}

/** Recurring, Accounts, Categories and the receipt inbox, on phones only (the sidebar has them wider). */
function ManageGroup() {
  const count = useRecurringCount();
  const { ledger } = useLedgerWorkspace();
  const accounts = ledger?.accounts.length;
  return (
    <nav aria-labelledby="settings-manage" className="settings__nav settings__manage">
      <h2 id="settings-manage" className="settings__group">
        Manage
      </h2>
      <ul className="settings__list">
        {MANAGE_ITEMS.map((item) => {
          const value = item === RECURRING ? count : item.to === "/accounts" ? accounts : undefined;
          return (
            <li key={item.to}>
              <Link to={item.to} className="settings__link">
                <RowIcon name={item.icon} />
                <span className="settings__label">{item.label}</span>
                {value ? (
                  <span className="settings__value">
                    {value}
                    {item === RECURRING ? <span className="visually-hidden"> active</span> : null}
                  </span>
                ) : null}
                <Icon name="chevron-forward" size={14} />
              </Link>
            </li>
          );
        })}
        <InboxNavItem className="settings__link" />
      </ul>
    </nav>
  );
}

function Group({ title, footer, children }: { title: string; footer?: string | undefined; children: ReactNode }) {
  const id = `settings-group-${title.toLowerCase()}`;
  return (
    <div className="settings__section">
      <h2 id={id} className="settings__group">
        {title}
      </h2>
      <ul className="settings__list" aria-labelledby={id}>
        {children}
      </ul>
      {footer ? <p className="settings__footnote">{footer}</p> : null}
    </div>
  );
}

function RowIcon({ name }: { name: IconName }) {
  return (
    <span className="settings__tile" aria-hidden="true">
      <Icon name={name} size={18} />
    </span>
  );
}

interface RowProps {
  to: SectionPath;
  icon: IconName;
  label: string;
  detail?: string;
  value?: string | undefined;
  trailing?: IconName;
}

function Row({ to, icon, label, detail, value, trailing = "chevron-forward" }: RowProps) {
  return (
    <li>
      <Link to={to} className="settings__link" activeOptions={{ exact: true, includeSearch: false }}>
        <RowIcon name={icon} />
        <span className="settings__label">
          {label}
          {detail ? <span className="settings__detail">{detail}</span> : null}
        </span>
        {value ? <span className="settings__value">{value}</span> : null}
        <Icon name={trailing} size={14} />
      </Link>
    </li>
  );
}

function LeaveDemo({ className }: { className: string }) {
  const queryClient = useQueryClient();
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void leaveDemo(queryClient);
      }}
    >
      Leave demo
    </button>
  );
}
