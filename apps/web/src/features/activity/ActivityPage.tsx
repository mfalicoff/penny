import type { Kind, Transaction } from "@domain/ledger.ts";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ACCOUNT_MESSAGES, download, entriesPath } from "../../api/account";
import { ApiError } from "../../api/client";
import { useCallback, useId, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { useTopbarSlot } from "../../app/shell/pageTitle";
import { SEARCH_SHORTCUT } from "../../app/shell/AppShell";
import { TABLET, TOUCH_TABLET, useMediaQuery, WIDE } from "../../app/useMediaQuery";
import { useToday } from "../../app/useToday";
import { Button, ChoiceGroup, cx, Kbd } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { tileStyle } from "../../design/categoryTint";
import { Dialog } from "../../design/ModalDialog";
import { formatCents } from "../../design/Money";
import { useOnline, useToast } from "../../design/states";
import { useIsDemo } from "../../demo/demo";
import { EntryDetailDialog, EntryDetailPanel, type EntryAction } from "../entries/EntryDetail";
import { categoryIcon, frequentCategories, inlineCategories, mostUsedCategories } from "../entries/model";
import { CategoryPickerDialog } from "../entries/pickers";
import { useLedgerWriter } from "../entries/writer";
import { dayLabel } from "../households/model";
import { ActivityResults } from "./ActivityResults";
import { periodTotals, rowFilters, useActivityLedger, useSharedRows, type SharedState } from "./data";
import { activeDay, KIND_FILTERS, periodLabel, periodOf, periodRange, projectionPeriod, shiftPeriod, shortPeriodLabel, withPeriod, without, type ActivitySearch, type Period } from "./filters";

type Navigate = (update: (previous: ActivitySearch) => ActivitySearch) => void;

interface Open {
  entry: Transaction;
  opener: HTMLElement;
  action: EntryAction;
  /** Changes on every open, so opening the same entry again (another row action) starts afresh. */
  nonce: number;
}

/**
 * Activity (`/transactions`, MAZ-88; cards `iphone-activity`, `iphone-search-empty`,
 * `ipad-activity` and `web-activity`, MAZ-225). Every filter is a search parameter, so Back and
 * Forward step through them and a filtered view can be bookmarked.
 *
 * - Phones: the type chips and the period chip, then the day-grouped list, and the search field
 *   at the bottom above the tab bar. The period chip opens Filters (period, category, day).
 * - Touch tablets from 1100px (`ipad-activity`): search, the chips and the list, with the selected
 *   entry in a pane beside it. The pane always shows one: the first listed entry until another
 *   is chosen, and again when the selected one is deleted or filtered out.
 * - Desktops (`web-activity`): the period beside the title and search in the top bar; the chips,
 *   Filters and the period's summary over a table, and the open entry in a panel beside it.
 *
 * While searching on a phone or touch tablet, the chips are the active filters, each removable
 * (`iphone-search-empty`). A desktop keeps its chips, and hides the period's summary while the
 * results load (`web-activity-searching`, activity.css).
 */
export function ActivityPage({ search, from }: { search: ActivitySearch; from: "/transactions" }) {
  const navigateTo = useNavigate({ from });
  const navigate: Navigate = (update) => {
    void navigateTo({ search: (previous: ActivitySearch) => update(previous) });
  };
  const online = useOnline();
  const period = periodOf(search);
  const { ledger } = useActivityLedger();
  const writer = useLedgerWriter();
  const shared = useSharedRows(period, online);
  const filters = rowFilters(search);
  const [open, setOpen] = useState<Open | null>(null);
  const [filtering, setFiltering] = useState(false);
  // A desktop's panel steps aside while its Edit form is open (`web-edit-entry`).
  const [editing, setEditing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tablet = useMediaQuery(TABLET);
  const wide = useMediaQuery(WIDE);
  const touch = useMediaQuery(TOUCH_TABLET);
  const nonce = useRef(0);
  const desktop = tablet && !touch;
  // From 1100px the open entry sits beside the list; below it, it is a dialog (MAZ-227).
  const beside = wide;
  // `ipad-activity`: on a touch tablet the pane always shows an entry, so the first listed one is
  // selected when Activity opens and whenever the selected one leaves the list.
  const pane = beside && touch;
  const besideShown = beside && !(editing && !touch);
  const autoSelect = useCallback((pick: { entry: Transaction; row: HTMLElement } | null) => {
    if (!pick) {
      setOpen(null);
      return;
    }
    nonce.current += 1;
    setOpen({ entry: pick.entry, opener: pick.row, action: "detail", nonce: nonce.current });
  }, []);

  function close() {
    if (!open) return;
    const { opener } = open;
    setOpen(null);
    setEditing(false);
    // Back to where the person was: the row, or the search field if the row is gone (deleted).
    setTimeout(() => {
      // The list may have re-rendered (a save switches it to this device's copy), so find the row again by its key.
      const key = opener.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey ?? opener.closest("tr")?.querySelector<HTMLElement>("[data-row-key]")?.dataset.rowKey;
      const row = [...document.querySelectorAll<HTMLElement>("[data-row-key]")].find((element) => element.dataset.rowKey === key);
      if (row) row.focus();
      else searchRef.current?.focus();
    }, 0);
  }

  const searchField = <SearchField key={search.q ?? ""} inputRef={searchRef} search={search} navigate={navigate} variant={desktop ? "top" : tablet ? "inline" : "bottom"} />;
  const narrowed = Boolean(search.kind || search.category || activeDay(search) || period.type !== "all");
  // Desktops keep the type chips and Filters while searching (`web-activity-searching`): the period is beside the title.
  const chips = search.q && narrowed && !desktop ? (
    <ActiveFilters search={search} navigate={navigate} ledger={ledger} />
  ) : (
    <div className="activity-chips">
      <KindChips search={search} navigate={navigate} compact={touch} />
      {tablet ? (
        <FiltersChip search={search} iconOnly={touch} onClick={() => { setFiltering(true); }} />
      ) : (
        <button type="button" className="filter-chip" aria-haspopup="dialog" aria-label={`Period: ${periodLabel(period)}. Change filters`} onClick={() => { setFiltering(true); }}>
          <Icon name="calendar" size={18} />
          <PeriodChipLabel period={period} />
        </button>
      )}
    </div>
  );
  const selectedKey = open ? `personal:${open.entry.id}` : undefined;
  const results = (
    <ActivityResults
      key={JSON.stringify(search)}
      search={search}
      filters={filters}
      ledger={ledger ?? writer.ledger}
      shared={shared}
      layout={desktop ? "table" : "list"}
      selectedKey={besideShown ? selectedKey : undefined}
      autoSelect={pane ? autoSelect : undefined}
      onClear={(...keys) => {
        navigate((previous) => without(previous, ...keys));
      }}
      onOpen={(entry, opener, action) => {
        nonce.current += 1;
        setOpen({ entry, opener, action, nonce: nonce.current });
      }}
    />
  );

  return (
    <div className={cx("page activity", !tablet && "activity--phone", besideShown && open && "activity--beside")}>
      {desktop ? <PeriodStepper search={search} navigate={navigate} slot /> : null}
      {/* While searching, the phone's top row is empty (`iphone-search-empty`): the active filters are the chips. */}
      {tablet || search.q ? null : <PhoneFiltersButton search={search} onClick={() => { setFiltering(true); }} />}
      <div className="activity__main">
        {tablet && !desktop ? searchField : null}
        <div className="activity-toolbar">
          {chips}
          {desktop && ledger ? <Summary period={period} ledger={ledger} shared={shared} /> : null}
          {desktop ? <ExportButton period={period} /> : null}
        </div>
        {shared.status === "unavailable" ? (
          <p className="note" role="status">
            {shared.message}{" "}
            <Button variant="quiet" onClick={shared.retry}>
              Try again
            </Button>
          </p>
        ) : null}
        {results}
        {desktop ? searchField : null}
      </div>
      {!tablet ? searchField : null}

      {open && beside ? <EntryDetailPanel key={`${open.entry.id}:${String(open.nonce)}`} entry={open.entry} initialAction={open.action} touch={touch} onClose={close} onEditing={setEditing} /> : null}
      {open && !beside ? <EntryDetailDialog key={`${open.entry.id}:${String(open.nonce)}`} entry={open.entry} initialAction={open.action} onClose={close} /> : null}
      {filtering ? (
        <FiltersDialog
          search={search}
          navigate={navigate}
          onClose={() => {
            setFiltering(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** The phone's round filter button above the title, at the end of the top row (`iphone-activity`). */
function PhoneFiltersButton({ search, onClick }: { search: ActivitySearch; onClick: () => void }) {
  const slot = useTopbarSlot();
  const active = [search.category, activeDay(search)].filter(Boolean).length;
  const button = (
    <div className="topbar__actions activity-topbar-actions">
      <button type="button" className={cx("glass glass-button", active > 0 && "glass-button--on")} aria-haspopup="dialog" aria-label={active ? `Filters, ${String(active)} on` : "Filters"} onClick={onClick}>
        <Icon name="options" size={20} />
      </button>
    </div>
  );
  return slot ? createPortal(button, slot) : null;
}

/** The phone chip's period: the month alone this year ("November"), else the month and year, the year, or All time. */
function PeriodChipLabel({ period }: { period: Period }) {
  const today = useToday();
  return <span>{shortPeriodLabel(period, today)}</span>;
}

/**
 * Search. `bottom`: the phone's field at the bottom of the screen, above the tab bar
 * (`iphone-activity`), with × to stop searching. `inline`: over the list (`ipad-activity`). `top`:
 * in the top bar beside Add entry with its shortcut (`web-activity`). ⌘K and / focus it.
 */
function SearchField({ inputRef, search, navigate, variant }: { inputRef: RefObject<HTMLInputElement | null>; search: ActivitySearch; navigate: Navigate; variant: "bottom" | "inline" | "top" }) {
  const slot = useTopbarSlot();
  const [value, setValue] = useState(search.q ?? "");

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const query = value.trim() || undefined;
    navigate((previous) => ({ ...previous, q: query }));
  }

  function clear() {
    setValue("");
    navigate((previous) => without(previous, "q"));
    inputRef.current?.focus();
  }

  const placeholder = variant === "bottom" ? "Search activity" : variant === "top" ? "Search entries" : "Search";
  const form = (
    <form role="search" className={cx("activity-search", `activity-search--${variant}`)} onSubmit={onSubmit}>
      {variant === "bottom" && search.q ? (
        <button type="button" className="glass glass-button activity-search__stop" aria-label="Stop searching" onClick={clear}>
          <Icon name="close" size={20} />
        </button>
      ) : null}
      <div className={cx("activity-search__field", variant === "bottom" && "glass")}>
        <Icon name="search" size={variant === "bottom" ? 20 : 16} />
        <label htmlFor="activity-search" className="visually-hidden">
          Search transactions
        </label>
        <input
          id="activity-search"
          ref={inputRef}
          name="q"
          type="search"
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => {
            setValue(event.currentTarget.value);
          }}
        />
        {value ? (
          <button type="button" className="activity-search__clear" aria-label="Clear search" onClick={clear}>
            <Icon name="close" size={14} weight={48} />
          </button>
        ) : variant === "top" ? (
          <Kbd>{SEARCH_SHORTCUT}</Kbd>
        ) : null}
      </div>
      <button type="submit" className="visually-hidden">
        Search
      </button>
    </form>
  );
  return variant === "top" && slot ? createPortal(form, slot) : form;
}

/**
 * The type as one row of chips (`iphone-activity`, `web-activity`): All, Expenses, Income,
 * Investments. `compact` (`ipad-activity`, beside the pane) leaves Investments to Filters, unless it's the chosen type.
 */
function KindChips({ search, navigate, compact = false }: { search: ActivitySearch; navigate: Navigate; compact?: boolean }) {
  const options = compact ? KIND_FILTERS.filter((option) => option.value !== "investment" || search.kind === "investment") : KIND_FILTERS;
  return (
    <fieldset className="chip-group">
      <legend className="visually-hidden">Type</legend>
      {options.map((option) => {
        const on = (search.kind ?? "all") === option.value;
        return (
          <label key={option.value} className={cx("filter-chip", on && "filter-chip--on")}>
            <input
              type="radio"
              name="activity-kind"
              checked={on}
              onChange={() => {
                navigate((previous) => ({ ...previous, kind: option.value === "all" ? undefined : option.value }));
              }}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function FiltersChip({ search, iconOnly, onClick }: { search: ActivitySearch; iconOnly: boolean; onClick: () => void }) {
  const active = [search.category, activeDay(search)].filter(Boolean).length;
  const label = active ? `Filters, ${String(active)} on` : "Filters";
  return (
    <button type="button" className={cx("filter-chip", active > 0 && "filter-chip--on")} aria-haspopup="dialog" aria-label={iconOnly ? label : undefined} onClick={onClick}>
      <Icon name="options" size={18} />
      {iconOnly ? null : <span>{active ? `Filters · ${String(active)}` : "Filters"}</span>}
    </button>
  );
}

/** While searching: each active filter as a dark chip with ×, which removes it (`iphone-search-empty`). */
function ActiveFilters({ search, navigate, ledger }: { search: ActivitySearch; navigate: Navigate; ledger: ReturnType<typeof useActivityLedger>["ledger"] }) {
  const today = useToday();
  const period = periodOf(search);
  const day = activeDay(search);
  const kind = KIND_FILTERS.find((option) => option.value === search.kind);
  const category = search.category ? (ledger?.categories.find((item) => item.id === search.category)?.name ?? "Another category") : undefined;
  const chips: { key: string; label: string; icon?: "calendar"; remove: (keyof ActivitySearch)[] }[] = [];
  if (kind && search.kind) chips.push({ key: "kind", label: kind.label, remove: ["kind"] });
  if (category) chips.push({ key: "category", label: category, remove: ["category"] });
  if (day) chips.push({ key: "day", label: dayLabel(day), icon: "calendar", remove: ["day"] });
  else if (period.type !== "all") chips.push({ key: "period", label: shortPeriodLabel(period, today), icon: "calendar", remove: ["month", "year", "day"] });
  return (
    <ul className="activity-chips" aria-label="Active filters">
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            className="filter-chip filter-chip--on filter-chip--removable"
            aria-label={`Remove filter: ${chip.label}`}
            onClick={() => {
              navigate((previous) => without(previous, ...chip.remove));
            }}
          >
            {chip.icon ? <Icon name={chip.icon} size={18} /> : null}
            <span>{chip.label}</span>
            <Icon name="close" size={14} weight={48} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The period stepper. On a desktop it sits beside the title (`web-activity`: "‹ November 2026 ›");
 * in Filters it follows the All time / Month / Year choice.
 */
function PeriodStepper({ search, navigate, slot: inSlot = false }: { search: ActivitySearch; navigate: Navigate; slot?: boolean }) {
  const slot = useTopbarSlot();
  const period = periodOf(search);
  const unit = period.type === "year" ? "year" : "month";
  const stepper = (
    <div className={cx("month-nav", "period-stepper", period.type === "all" && "period-stepper--all")}>
      <Button iconOnly icon="chevron-back" variant="quiet" className="month-nav__step" aria-label={`Previous ${unit}`} disabled={period.type === "all"} onClick={() => { navigate((previous) => shiftPeriod(previous, -1)); }} />
      <span className="month-nav__label" aria-live="polite">
        {periodLabel(period)}
      </span>
      <Button iconOnly icon="chevron-forward" variant="quiet" className="month-nav__step" aria-label={`Next ${unit}`} disabled={period.type === "all"} onClick={() => { navigate((previous) => shiftPeriod(previous, 1)); }} />
    </div>
  );
  if (!inSlot) return stepper;
  // In the top bar it takes Home's desktop month control look (`month-bar`, home.css).
  const bar = <div className="month-bar">{stepper}</div>;
  return slot ? createPortal(bar, slot) : bar;
}

/** The desktop summary (`web-activity`): "24 entries · spent $1,883.35 · in $3,200.00" for the period, whatever the search or filters. */
function Summary({ period, ledger, shared }: { period: Period; ledger: NonNullable<ReturnType<typeof useActivityLedger>["ledger"]>; shared: SharedState }) {
  const today = useToday();
  const result = periodTotals(ledger, period, shared.status === "ready" ? shared.rows : [], today);
  const currency = ledger.currency;
  const notes = [
    shared.status === "ready" && result.sharedCount > 0 ? `Spent includes your share of ${String(result.sharedCount)} shared expense${result.sharedCount === 1 ? "" : "s"}${shared.cached ? ", as Penny last loaded them" : ""}.` : null,
    result.expectedIncome > 0 ? `In leaves out ${formatCents(result.expectedIncome, currency)} of income dated after today, listed as Expected until its date.` : null,
  ].filter(Boolean);
  return (
    <p className="activity-summary" title={notes.join(" ") || undefined}>
      <span className="visually-hidden">{periodLabel(period)}: </span>
      {result.entries} {result.entries === 1 ? "entry" : "entries"} · spent <strong className="pk-num">{formatCents(result.expense, currency)}</strong> · in <strong className="pk-num">{formatCents(result.income, currency)}</strong>
      {notes.length ? <span className="visually-hidden"> {notes.join(" ")}</span> : null}
    </p>
  );
}

/**
 * The desktop export (MAZ-152, card `web-activity`): the period's entries as a CSV, the same file as
 * Settings › Export data. It follows the period, not the search or filters. The demo has nothing to
 * export, so it has no button.
 */
function ExportButton({ period }: { period: Period }) {
  const demo = useIsDemo();
  const toast = useToast();
  const csv = useMutation({
    mutationKey: ["export", "entries", "activity"],
    mutationFn: () => download(entriesPath(projectionPeriod(period)), "penny-entries.csv"),
    onError: (error) => {
      toast.show({ title: "The file didn't download", detail: error instanceof ApiError && error.status !== 0 ? error.message : ACCOUNT_MESSAGES.offline });
    },
  });
  if (demo) return null;
  return (
    <Button
      iconOnly
      icon="document-text"
      className="activity-export"
      busy={csv.isPending}
      aria-label={`Export ${periodLabel(period)} as a CSV file`}
      title="Export as CSV"
      onClick={() => {
        csv.mutate();
      }}
    />
  );
}

/** Filters (the card's Filters button and the phone's period chip): type, period, category and day. */
function FiltersDialog({ search, navigate, onClose }: { search: ActivitySearch; navigate: Navigate; onClose: () => void }) {
  const doneRef = useRef<HTMLButtonElement>(null);
  const period = periodOf(search);
  return (
    <Dialog
      title="Filters"
      onClose={onClose}
      initialFocus={doneRef}
      actions={
        <>
          {search.kind || search.category || search.day ? (
            <Button
              variant="quiet"
              onClick={() => {
                navigate((previous) => without(previous, "kind", "category", "day"));
              }}
            >
              Clear filters
            </Button>
          ) : null}
          <Button ref={doneRef} variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="form activity-filters-form">
        <ChoiceGroup<"all" | Kind>
          legend="Type"
          name="filters-kind"
          value={search.kind ?? "all"}
          onChange={(value) => {
            navigate((previous) => ({ ...previous, kind: value === "all" ? undefined : value }));
          }}
          options={KIND_FILTERS}
        />
        <FilterSection title="Period">
          <ChoiceGroup<Period["type"]>
            legend="Period"
            hideLegend
            name="activity-period"
            value={period.type}
            onChange={(type) => {
              navigate((previous) => withPeriod(previous, type));
            }}
            options={[
              { value: "all", label: "All time" },
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
            ]}
          />
          {period.type !== "all" ? <PeriodStepper search={search} navigate={navigate} /> : null}
        </FilterSection>
        <CategoryAndDay search={search} navigate={navigate} />
      </div>
    </Dialog>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="filter-section" aria-labelledby={id}>
      <h3 id={id} className="choices__legend">
        {title}
      </h3>
      {children}
    </section>
  );
}

function CategoryAndDay({ search, navigate }: { search: ActivitySearch; navigate: Navigate }) {
  const { ledger } = useActivityLedger();
  const [picking, setPicking] = useState(false);
  const dayId = useId();
  const period = periodOf(search);
  const range = periodRange(period);
  const day = activeDay(search);
  const categories = ledger ? frequentCategories(ledger, search.kind) : [];
  const inline = inlineCategories(categories, search.category);
  const selectedMissing = search.category && !categories.some((category) => category.id === search.category);
  return (
    <>
      {categories.length || search.category ? (
        <fieldset className="choices category-chips">
          <legend className="choices__legend">Category</legend>
          <div className="chip-row">
            <label className={cx("chip", !search.category && "chip--on")}>
              <input type="radio" name="activity-category" checked={!search.category} onChange={() => { navigate((previous) => ({ ...previous, category: undefined })); }} />
              <span>All</span>
            </label>
            {inline.map((category) => (
              <label key={category.id} className={cx("chip", category.id === search.category && "chip--on")}>
                <input type="radio" name="activity-category" checked={category.id === search.category} onChange={() => { navigate((previous) => ({ ...previous, category: category.id })); }} />
                <span className="category-dot" style={tileStyle(category)}>
                  <Icon name={categoryIcon(category.icon)} size={16} />
                </span>
                <span>{category.name}</span>
              </label>
            ))}
            {selectedMissing ? (
              <label className="chip chip--on">
                <input type="radio" name="activity-category" checked readOnly />
                <span>Another category</span>
              </label>
            ) : null}
            <Button variant="quiet" icon="list" onClick={() => { setPicking(true); }}>
              All categories
            </Button>
          </div>
        </fieldset>
      ) : null}
      <div className="form-field activity-day">
        <label htmlFor={dayId}>Day</label>
        <div className="field-with-action">
          <input
            id={dayId}
            type="date"
            value={day ?? ""}
            min={range.from ?? "2000-01-01"}
            max={range.to ?? "2100-12-31"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              navigate((previous) => ({ ...previous, day: value || undefined }));
            }}
          />
          {day ? (
            <Button variant="quiet" icon="close" onClick={() => { navigate((previous) => ({ ...previous, day: undefined })); }}>
              Any day
            </Button>
          ) : null}
        </div>
      </div>
      {picking ? (
        <CategoryPickerDialog
          title="Filter by category"
          categories={categories}
          mostUsed={ledger ? mostUsedCategories(ledger, search.kind) : []}
          selected={search.category}
          allLabel="All categories"
          onSelect={(id) => {
            navigate((previous) => ({ ...previous, category: id }));
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      ) : null}
    </>
  );
}
