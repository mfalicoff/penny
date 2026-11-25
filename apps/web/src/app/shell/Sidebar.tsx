import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { serverInfoQuery } from "../../api/info";
import { householdDetailQuery, householdsQuery, monthRecapQuery } from "../../api/households";
import type { Household } from "../../api/schemas";
import { useAccountEmail, useAccountMe } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { Avatar, cx, Kbd } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";
import { formatCents } from "../../design/Money";
import { useOnline } from "../../design/states";
import { currentMonth, findMe, localDate } from "../../features/households/model";
import { useLedgerWorkspace } from "../../features/organize/workspace";
import { countLabel, OFFLINE_HINT } from "../../features/receiptInbox/model";
import { useInboxStatus } from "../../features/receiptInbox/useInbox";
import { isSharedTrip, tripPhase } from "../../features/trips/model";
import { useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { goShortcut, MAIN_ITEMS, MANAGE_ITEMS, RECURRING, SHARED, TRIPS, type NavItem } from "./navigation";

/** Trips listed by name in the sidebar: the ones happening now or coming next. */
const SIDEBAR_TRIPS = 3;

/**
 * Brand, navigation and the account footer (kit `WebSidebar`; cards `web-*` and `ipad-*`).
 * Together lists each household with this month's balance and each current or coming trip with
 * its start date, then All trips. As an icon rail (768–1099px) it keeps one Shared and one Trips
 * icon instead, since a column of identical icons can't tell households apart.
 */
export function Sidebar() {
  const email = useAccountEmail();
  const me = useAccountMe();
  const demo = useIsDemo();
  return (
    <aside className="sidebar sidebar--rail" aria-label="Penny">
      <Link to="/" className="brand" aria-label="Penny home">
        <span className="logo">
          <Icon name="leaf" size={18} weight={40} />
        </span>
        <span className="brand__name">penny.</span>
      </Link>
      <nav aria-label="Main" className="sidebar__nav">
        <div className="sidebar__section">
          <ul className="sidebar__list">
            {MAIN_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink item={item} />
              </li>
            ))}
            <InboxNavItem />
          </ul>
        </div>
        <Together />
        <div className="sidebar__section">
          <h2 className="sidebar__heading">Manage</h2>
          <ul className="sidebar__list">
            {MANAGE_ITEMS.map((item) => (
              <li key={item.to}>{item === RECURRING ? <RecurringNavLink /> : <NavLink item={item} />}</li>
            ))}
          </ul>
        </div>
      </nav>
      {demo ? (
        // The demo has no account: "Demo" with "Sample data" (card `web-demo`).
        <div className="sidebar__foot sidebar__foot--demo">
          <span className="sidebar__demo-mark" aria-hidden="true">
            <Icon name="play" size={16} weight={44} />
          </span>
          <div className="sidebar__account">
            <span className="sidebar__email">Demo</span>
            <p className="sync-line">Sample data</p>
          </div>
          {/* As on the account footer: on the web this is the only way into Settings. */}
          <Link to="/settings" className="iconlink" aria-label="Settings" activeOptions={{ includeSearch: false }}>
            <Icon name="settings" size={18} />
          </Link>
        </div>
      ) : (
        <div className="sidebar__foot">
          <Avatar name={me.displayName ?? email} src={me.avatarUrl} size={32} />
          <div className="sidebar__account">
            {/* The person's name, else their email (MAZ-171). */}
            <span className="sidebar__email" title={email}>
              {me.displayName ?? email}
            </span>
            <SyncLine />
          </div>
          <Link to="/settings" className="iconlink" aria-label="Settings" activeOptions={{ includeSearch: false }}>
            <Icon name="settings" size={18} />
          </Link>
        </div>
      )}
    </aside>
  );
}

function NavLink({
  item,
  detail,
  spoken,
  label = item.label,
  exact = item.to === "/",
  showShortcut = true,
  className,
}: {
  item: NavItem;
  detail?: string | undefined;
  /** Words read after the detail, for screen readers ("active" after "3"). */
  spoken?: string | undefined;
  label?: string;
  exact?: boolean;
  /** The G-key hint; the cards show it only on Home, Activity and Insights. */
  showShortcut?: boolean;
  className?: string;
}) {
  const shortcut = goShortcut(item);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  // Exact links (All trips) still mark their section for the icon rail, which shows only them.
  const inSection = item.to !== "/" && pathname.startsWith(item.to);
  return (
    <Link
      to={item.to}
      className={cx("navlink", className)}
      data-section={inSection ? "" : undefined}
      activeOptions={{ exact, includeSearch: false }}
      aria-keyshortcuts={shortcut ? `g ${item.key ?? ""}` : undefined}
    >
      <Icon name={item.icon} size={18} />
      <span className="navlink__label">{label}</span>
      {detail ? (
        <span className="navlink__detail">
          {detail}
          {spoken ? <span className="visually-hidden"> {spoken}</span> : null}
        </span>
      ) : shortcut && showShortcut ? (
        <Kbd>{shortcut}</Kbd>
      ) : null}
    </Link>
  );
}

/** A household or trip in Together: its name and one short fact (balance, start date). */
function ItemLink({
  to,
  params,
  icon,
  name,
  detail,
  spoken,
}: {
  to: "/households/$id" | "/trips/$id";
  params: { id: string };
  icon: IconName;
  name: string;
  detail?: string | undefined;
  spoken?: string | undefined;
}) {
  return (
    <li className="sidebar__item">
      <Link to={to} params={params} className="navlink" activeOptions={{ includeSearch: false }}>
        <Icon name={icon} size={18} />
        <span className="navlink__label">{name}</span>
        {detail ? <span className="navlink__detail">{detail}</span> : null}
        {spoken ? <span className="visually-hidden">, {spoken}</span> : null}
      </Link>
    </li>
  );
}

/** Whole units, as on the cards ("$142", with a typographic minus, MAZ-222); the spoken label keeps the cents. */
const short = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })
    .format(Math.trunc(cents / 100))
    .replace("-", "\u2212");

function Together() {
  const email = useAccountEmail();
  const workspace = useLedgerWorkspace();
  // The demo answers with its sample household (MAZ-283).
  const households = useQuery(householdsQuery(email));
  const homes = useMemo(() => (households.data ?? []).filter((household) => !household.trip), [households.data]);
  const trips = useMemo(() => {
    const today = localDate();
    // Names and dates only: `tripCards` would also total every entry, on every page.
    const shared = (households.data ?? []).filter(isSharedTrip);
    const sharedIds = new Set(shared.map((household) => household.id));
    const personal = (workspace.ledger?.trips ?? []).filter((trip) => !trip.sharedHouseholdId || !sharedIds.has(trip.sharedHouseholdId));
    return [
      ...shared.map((household) => ({ id: household.id, name: household.name, startDate: household.trip.startDate, endDate: household.trip.endDate })),
      ...personal.map((trip) => ({ id: trip.id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate })),
    ]
      .filter((trip) => tripPhase(trip, today) !== "past")
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name))
      .slice(0, SIDEBAR_TRIPS);
  }, [workspace.ledger, households.data]);

  return (
    <div className="sidebar__section">
      <h2 className="sidebar__heading">Together</h2>
      <ul className="sidebar__list">
        {homes.map((household) => (
          <HouseholdItem key={household.id} household={household} />
        ))}
        <li className="sidebar__all">
          <NavLink item={SHARED} showShortcut={false} label={homes.length ? "All households" : "Shared"} exact={homes.length > 0} />
        </li>
        {trips.map((trip) => (
          <ItemLink key={trip.id} to="/trips/$id" params={{ id: trip.id }} icon="airplane" name={trip.name} detail={shortDate(trip.startDate)} />
        ))}
        <li className="sidebar__all">
          <NavLink item={TRIPS} showShortcut={false} label={trips.length ? "All trips" : "Trips"} exact={trips.length > 0} />
        </li>
      </ul>
    </div>
  );
}

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** A household with this month's balance: what you're owed, or what you owe with a minus. */
function HouseholdItem({ household }: { household: Household }) {
  const email = useAccountEmail();
  const month = currentMonth();
  // The Shared list and the household page read the same queries, so they share the cache.
  const [detail, recap] = useQueries({
    queries: [householdDetailQuery(email, household.id), monthRecapQuery(email, household.id, month)],
  });
  const me = findMe(detail.data?.members ?? [], email);
  const balance = me ? recap.data?.balances.find((row) => row.userId === me.userId)?.balanceCents : undefined;
  let shown: string | undefined;
  let spoken: string | undefined;
  if (balance !== undefined && balance !== 0) {
    shown = short(balance, household.currency);
    spoken = balance > 0 ? `you're owed ${formatCents(balance, household.currency)}` : `you owe ${formatCents(-balance, household.currency)}`;
  } else if (balance === 0) spoken = "settled";
  return <ItemLink to="/households/$id" params={{ id: household.id }} icon="people" name={household.name} detail={shown} spoken={spoken} />;
}

/** Active schedules, shown beside Recurring (cards `web-home`, `iphone-settings`). */
export function useRecurringCount(): number | undefined {
  const { ledger } = useLedgerWorkspace();
  return ledger?.recurring.filter((rule) => rule.active).length;
}

/** Recurring with the number of active schedules, as on the `web-home` card. */
function RecurringNavLink() {
  const count = useRecurringCount();
  return <NavLink item={RECURRING} detail={count ? String(count) : undefined} spoken={count ? "active" : undefined} />;
}

/** Re-renders every half minute, so "Synced 2 min ago" stays true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return now;
}

function syncedAgo(at: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${String(minutes)} min ago`;
  const date = new Date(at);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return `Synced ${sameDay ? date.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
}

/** The ledger's sync state as the sidebar footer and Settings show it. */
export interface SyncStatus {
  icon: IconName;
  text: string;
  tone: "error" | undefined;
  /** Everything this browser holds is on the server. */
  synced: boolean;
}

export function useSyncStatus(): SyncStatus {
  const state = useLedgerSync();
  const now = useNow();
  let icon: IconName = "cloud-done";
  let text: string;
  let tone: "error" | undefined;
  let synced = false;
  if (!state) {
    icon = "cloud-offline";
    text = "Not synced";
  } else if (state.phase === "syncing" || state.phase === "loading") {
    icon = "time";
    text = "Syncing…";
  } else if (state.phase === "offline") {
    icon = "cloud-offline";
    text = "Offline";
  } else if (state.phase === "pending") {
    icon = "time";
    text = countChanges(state.pending.count);
  } else if (state.phase === "upToDate") {
    text = state.lastSyncedAt ? syncedAgo(state.lastSyncedAt, now) : "Synced";
    synced = true;
  } else {
    icon = "alert-circle";
    text = "Not synced";
    tone = "error";
  }
  return { icon, text, tone, synced };
}

/**
 * The account's sync state under its email ("Synced just now", "2 changes waiting", "Offline").
 * It isn't a live region: the sync banner above the page announces changes and offers Retry. The
 * server's version is in Settings › Server & sync; an unreachable server has its own banner.
 */
export function SyncLine() {
  const status = useSyncStatus();
  const online = useOnline();
  // The browser is online but the server doesn't answer (card `web-server-unreachable`).
  const serverDown = useQuery(serverInfoQuery).isError && online;
  const { icon, text, tone } = serverDown ? { icon: "cloud-offline" as const, text: "Can't reach server", tone: "error" as const } : status;
  return (
    <p className={cx("sync-line", tone && "sync-line--error")}>
      {/* Keyed by state, so a change crossfades (docs/design/motion.md, Feedback). */}
      <Icon key={icon} name={icon} size={13} />
      <span key={text}>{text}</span>
    </p>
  );
}

const countChanges = (count: number) => `${String(count)} change${count === 1 ? "" : "s"} waiting`;

/**
 * Receipts to attach (MAZ-184), with its count. Shown only when the server accepts emailed
 * receipts and an address exists (or items are still waiting). Offline it can't open: the inbox
 * needs a connection, as uploads do.
 */
export function InboxNavItem({ className = "navlink" }: { className?: string }) {
  const status = useInboxStatus();
  const online = useOnline();
  if (!status.visible) return null;
  // The visible label stays in the name (label in name); the count is read as "3 receipts to attach".
  const spoken = status.count > 0 ? `Receipts to attach, ${countLabel(status.count, status.more)}` : "Receipts to attach";
  const badge =
    status.count > 0 ? (
      <span className="navlink__count" aria-hidden="true">
        {status.more ? `${String(status.count)}+` : status.count}
      </span>
    ) : null;
  if (!online) {
    return (
      <li>
        <span className={cx(className, `${className}--off`)} role="link" aria-disabled="true" aria-label={`${spoken}. ${OFFLINE_HINT}`} title={OFFLINE_HINT}>
          <Icon name="receipt" size={18} />
          <span className="navlink__label">Receipts to attach</span>
          {badge}
        </span>
      </li>
    );
  }
  return (
    <li>
      <Link to="/receipts" search={{ status: "to_attach" }} className={className} activeOptions={{ includeSearch: false }} aria-label={spoken}>
        <Icon name="receipt" size={18} />
        <span className="navlink__label">Receipts to attach</span>
        {badge}
      </Link>
    </li>
  );
}
