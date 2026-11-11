import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useMatches, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { useAccountEmail } from "../../auth/account";
import { AddEntryDialog } from "../../features/entries/AddEntryDialog";
import { Avatar, Button, Kbd } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { ModalDialog } from "../../design/ModalDialog";
import { Banner, ServerUnreachableBanner } from "../../design/states";
import { SyncStatusBanner } from "../../offline/SyncStatusBanner";
import { leaveDemo, useIsDemo } from "../../demo/demo";
import { serverInfoQuery } from "../../api/info";
import { ServerStatus } from "../ServerStatus";
import { goShortcut, NAV_SECTIONS, TAB_ITEMS, type NavItem } from "./navigation";
import { PageTitleContext } from "./pageTitle";
import { useShortcuts } from "./shortcuts";

/** Title of the deepest matched route (`staticData.title`), for the top bar and the document title. */
function usePageMeta() {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const data = matches[index]?.staticData;
    if (data?.title) return { title: data.title, search: data.search !== false };
  }
  return { title: "Penny", search: true };
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SEARCH_SHORTCUT = isMac ? "⌘K" : "Ctrl K";

/**
 * The signed-in web shell (MAZ-85, web cards and MAZ-132 navigation). Three layouts from one DOM:
 *
 * - wide (≥ 1100px): sidebar with labels and shortcuts, top bar with title, search and Add entry;
 * - medium (768–1099px): the same sidebar as an icon rail;
 * - narrow (< 768px): a compact top bar and a bottom tab bar (Home, Activity, Shared, Trips,
 *   More). More opens the full navigation in a modal drawer.
 *
 * The breakpoints live in `shell.css`. Keyboard: Skip to content, ⌘K or / for search, N for
 * Add entry, G then H/A/I/S/T/R to go to a page.
 */
export function AppShell() {
  const navigate = useNavigate();
  const meta = usePageMeta();
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const title = titleOverride ?? meta.title;
  const search = meta.search;
  const searchRef = useRef<HTMLInputElement>(null);
  const [addingNow, setAdding] = useState(false);
  // The drawer belongs to the page it was opened on, so any navigation (a link in it, Back) closes it.
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const serverDown = useQuery(serverInfoQuery).isError;
  const demo = useIsDemo();
  // A deep link to /entries/new opens Add entry over Home.
  const adding = addingNow || pathname === "/entries/new";
  const drawer = drawerAt === pathname;

  useEffect(() => {
    document.title = title === "Penny" ? "Penny" : `${title} · Penny`;
  }, [title]);

  function focusSearch() {
    if (searchRef.current) {
      searchRef.current.focus();
      searchRef.current.select();
    } else {
      void navigate({ to: "/transactions" }).then(() => document.getElementById("activity-search")?.focus());
    }
  }

  useShortcuts({
    onSearch: focusSearch,
    onAdd: () => {
      setAdding(true);
    },
    onGo: (to) => void navigate({ to }),
  });

  function closeAdd() {
    setAdding(false);
    if (pathname === "/entries/new") void navigate({ to: "/", replace: true });
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar variant="rail" />
      <div className="app__column">
        <header className="topbar">
          <Link to="/" className="topbar__brand" aria-label="Penny home">
            <span className="logo">
              <Icon name="leaf" size={16} weight={40} />
            </span>
          </Link>
          <h1 className="topbar__title">{title}</h1>
          <div className="topbar__spacer" />
          {search ? <TopSearch inputRef={searchRef} /> : null}
          <Button
            variant="primary"
            icon="add"
            shortcut="N"
            className="topbar__add"
            aria-keyshortcuts="N"
            onClick={() => {
              setAdding(true);
            }}
          >
            <span className="topbar__add-label">Add entry</span>
          </Button>
        </header>
        {demo ? <DemoBanner /> : null}
        <SyncStatusBanner />
        <ServerUnreachableBanner unreachable={serverDown} />
        <main id="main" className="app__main" tabIndex={-1}>
          <PageTitleContext value={setTitleOverride}>
            <Outlet />
          </PageTitleContext>
        </main>
      </div>
      <TabBar
        onMore={() => {
          setDrawerAt(pathname);
        }}
      />
      {drawer ? (
        <NavDrawer
          onClose={() => {
            setDrawerAt(null);
          }}
        />
      ) : null}
      {adding ? <AddEntryDialog onClose={closeAdd} /> : null}
    </div>
  );
}

function TopSearch({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const navigate = useNavigate();
  const id = useId();

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    const q = typeof value === "string" && value.trim() ? value.trim() : undefined;
    event.currentTarget.reset();
    void navigate({ to: "/transactions", search: q ? { q } : {} });
  }

  return (
    <form role="search" className="topsearch" onSubmit={onSubmit}>
      <label htmlFor={id} className="visually-hidden">
        Search entries
      </label>
      <Icon name="search" size={15} />
      <input ref={inputRef} id={id} name="q" type="search" placeholder="Search entries" autoComplete="off" aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"} />
      <Kbd>{SEARCH_SHORTCUT}</Kbd>
    </form>
  );
}

function NavLink({ item, showShortcut }: { item: NavItem; showShortcut: boolean }) {
  const shortcut = goShortcut(item);
  return (
    <Link
      to={item.to}
      className="navlink"
      activeOptions={{ exact: item.to === "/", includeSearch: false }}
      aria-keyshortcuts={shortcut ? `g ${item.key ?? ""}` : undefined}
    >
      <Icon name={item.icon} size={18} />
      <span className="navlink__label">{item.label}</span>
      {showShortcut && shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </Link>
  );
}

/** Brand, the three navigation sections and the account footer (kit `WebSidebar`). */
function Sidebar({ variant }: { variant: "rail" | "drawer" }) {
  const email = useAccountEmail();
  return (
    <aside className={`sidebar sidebar--${variant}`} aria-label="Penny">
      <Link to="/" className="brand" aria-label="Penny home">
        <span className="logo">
          <Icon name="leaf" size={18} weight={40} />
        </span>
        <span className="brand__name">penny.</span>
      </Link>
      <nav aria-label="Main" className="sidebar__nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.heading ?? "main"} className="sidebar__section">
            {section.heading ? <h2 className="sidebar__heading">{section.heading}</h2> : null}
            <ul className="sidebar__list">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink item={item} showShortcut={variant === "rail"} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="sidebar__foot">
        <Avatar name={email} size={32} />
        <div className="sidebar__account">
          <span className="sidebar__email" title={email}>
            {email}
          </span>
          <ServerStatus />
        </div>
        <Link to="/settings" className="iconlink" aria-label="Settings" activeOptions={{ includeSearch: false }}>
          <Icon name="settings" size={18} />
        </Link>
      </div>
    </aside>
  );
}

/** Phone tab bar: the four iPhone tabs plus More (MAZ-132 navigation adapted for the browser). */
function TabBar({ onMore }: { onMore: () => void }) {
  return (
    <nav className="tabbar glass" aria-label="Tabs">
      <ul>
        {TAB_ITEMS.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="tab" activeOptions={{ exact: item.to === "/", includeSearch: false }}>
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
        <li>
          <button type="button" className="tab" aria-haspopup="dialog" onClick={onMore}>
            <Icon name="ellipsis-horizontal" size={22} />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

function NavDrawer({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  return (
    <ModalDialog labelledBy={titleId} onClose={onClose} panelClassName="drawer">
      <div className="drawer__head">
        <h2 id={titleId} className="visually-hidden">
          Menu
        </h2>
        <Button variant="quiet" iconOnly icon="close" aria-label="Close menu" onClick={onClose} />
      </div>
      {/* Any link closes the drawer, including the one for the page already open. */}
      <div
        className="drawer__body"
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) onClose();
        }}
      >
        <Sidebar variant="drawer" />
      </div>
    </ModalDialog>
  );
}

/** Always visible while the demo runs, with the way out. */
function DemoBanner() {
  const queryClient = useQueryClient();
  return (
    <Banner
      tone="info"
      title="You're exploring a demo"
      action={
        <Button
          variant="secondary"
          onClick={() => {
            void leaveDemo(queryClient);
          }}
        >
          Leave demo
        </Button>
      }
    >
      Sample data in this tab only. Changes are temporary and disappear when you leave or reload.
    </Banner>
  );
}
