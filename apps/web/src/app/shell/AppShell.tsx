import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useMatches, useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useId, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { AddEntryDialog } from "../../features/entries/AddEntryDialog";
import { Button, cx, Kbd } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Banner, ServerUnreachableBanner } from "../../design/states";
import { SyncStatusBanner } from "../../offline/SyncStatusBanner";
import { leaveDemo, useIsDemo } from "../../demo/demo";
import { serverInfoQuery } from "../../api/info";
import { TABLET, useMediaQuery } from "../useMediaQuery";
import { TAB_ITEMS, tabFor } from "./navigation";
import { PageTitleContext, PageTitleStyleContext, TopbarSlotContext, type PageTitleStyle } from "./pageTitle";
import { useShortcuts } from "./shortcuts";
import { Sidebar } from "./Sidebar";

/** Title of the deepest matched route (`staticData`), for the top bar and the document title. */
function usePageMeta() {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const data = matches[index]?.staticData;
    if (data?.title)
      return {
        title: data.title,
        search: data.search !== false,
        back: data.back,
        backLabel: data.backLabel ?? "Back to Home",
        backWide: data.backWide === true,
      };
  }
  return { title: "Penny", search: true, back: undefined, backLabel: "Back to Home", backWide: false };
}

const HomePage = lazy(() => import("../../features/home/HomePage").then((module) => ({ default: module.HomePage })));

/**
 * Home under the phone's Settings sheet (card `iphone-settings`): this month's Home, dimmed,
 * hidden from assistive technology and out of the tab order. It sits outside the shell's page
 * contexts, so its month control stays in the page instead of the sheet's top bar.
 */
function HomeBehind() {
  return (
    <div className="app__behind" aria-hidden="true" inert>
      <div className="app__main">
        <Suspense fallback={null}>
          <HomePage search={{}} />
        </Suspense>
      </div>
    </div>
  );
}

/** Activity with its search field focused. */
function openActivitySearch(navigate: ReturnType<typeof useNavigate>) {
  void navigate({ to: "/transactions" }).then(() => document.getElementById("activity-search")?.focus());
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SEARCH_SHORTCUT = isMac ? "⌘K" : "Ctrl K";

/**
 * The signed-in web shell (MAZ-85, web cards, MAZ-132 navigation and MAZ-221). Three layouts from
 * one DOM:
 *
 * - wide (≥ 1100px): sidebar with labels, households and trips, top bar with title, page tools
 *   (the month control), search and Add entry. On touch tablets (cards `ipad-*`) search is a round
 *   glass button and Add entry a copper capsule, with no keyboard hints;
 * - medium (768–1099px): the same sidebar as an icon rail;
 * - narrow (< 768px): the card's glass row (page tools, and Back on pushed pages) over a large
 *   title, and a floating bar with the four tabs (Home, Activity, Shared, Trips) beside the
 *   copper add button. Manage and Settings open from Home's settings button; Settings is a
 *   sheet over a dimmed Home.
 *
 * The breakpoints live in `shell.css`. Keyboard: Skip to content, ⌘K or / for search, N for
 * Add entry, G then H/A/I/S/T/R to go to a page.
 */
export function AppShell() {
  const navigate = useNavigate();
  const meta = usePageMeta();
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [titleStyle, setTitleStyle] = useState<PageTitleStyle>("large");
  // Where a page may place tools beside the title (the month control on Home and Insights).
  const [toolSlot, setToolSlot] = useState<HTMLDivElement | null>(null);
  const title = titleOverride ?? meta.title;
  const search = meta.search;
  const searchRef = useRef<HTMLInputElement>(null);
  const [addingNow, setAdding] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const serverDown = useQuery(serverInfoQuery).isError;
  const demo = useIsDemo();
  // Phones draw Settings as a sheet over Home (card `iphone-settings`).
  const phone = !useMediaQuery(TABLET);
  const sheet = phone && /^\/settings(\/|$)/.test(pathname);
  // A deep link to /entries/new opens Add entry over Home.
  const adding = addingNow || pathname === "/entries/new";

  useEffect(() => {
    document.title = title === "Penny" ? "Penny" : `${title} · Penny`;
  }, [title]);

  function focusSearch() {
    // The field is hidden on phones and touch tablets, which search on Activity instead.
    const field = searchRef.current;
    if (field && (!("checkVisibility" in field) || field.checkVisibility())) {
      field.focus();
      field.select();
    } else {
      openActivitySearch(navigate);
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
      <Sidebar />
      {sheet ? <HomeBehind /> : null}
      <div className={cx("app__column", sheet && "app__column--sheet")}>
        {sheet ? <span className="app__grabber" aria-hidden="true" /> : null}
        <header className={cx("topbar", pathname === "/" && "topbar--home", meta.back && "topbar--back", meta.back && meta.backWide && "topbar--back-wide", titleStyle !== "large" && `topbar--title-${titleStyle}`)}>
          {meta.back ? (
            <Link to={meta.back} className="glass glass-button topbar__back" aria-label={meta.backLabel}>
              <Icon name="chevron-back" size={20} />
            </Link>
          ) : null}
          <h1 className="topbar__title">{title}</h1>
          <div className="topbar__tools" ref={setToolSlot} />
          <div className="topbar__spacer" />
          {search ? <TopSearch inputRef={searchRef} /> : null}
          {search ? <SearchButton /> : null}
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
            <PageTitleStyleContext value={setTitleStyle}>
              <TopbarSlotContext value={toolSlot}>
                <Outlet />
              </TopbarSlotContext>
            </PageTitleStyleContext>
          </PageTitleContext>
        </main>
      </div>
      <TabBar pathname={pathname} />
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

/**
 * Touch tablets (card `ipad-home`): a round glass search button beside Add entry, in place of the
 * desktop field. It opens Activity with its search focused.
 */
function SearchButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="glass glass-button topbar__search"
      aria-label="Search entries"
      onClick={() => {
        openActivitySearch(navigate);
      }}
    >
      <Icon name="search" size={20} />
    </button>
  );
}

/**
 * Phone tab bar: the four iPhone tabs (cards `iphone-*`). A page pushed from a tab keeps that tab
 * selected (Insights keeps Home), marked `aria-current="true"` since it isn't the page itself.
 */
function TabBar({ pathname }: { pathname: string }) {
  const tab = tabFor(pathname);
  return (
    <nav className="tabbar glass" aria-label="Tabs">
      <ul>
        {TAB_ITEMS.map((item) => {
          const exact = item.to === "/";
          const within = tab === item.to && exact && pathname !== "/";
          return (
            <li key={item.to}>
              <Link to={item.to} className="tab" activeOptions={{ exact, includeSearch: false }} aria-current={within ? "true" : undefined}>
                <Icon name={item.icon} size={22} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Always visible while the demo runs, with the way out. */
function DemoBanner() {
  const queryClient = useQueryClient();
  return (
    <Banner
      tone="info"
      tile
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
