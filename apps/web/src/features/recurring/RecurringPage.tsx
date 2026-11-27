import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { dismissSuggestion, undoDismissSuggestion } from "@domain/commands.ts";
import { kindLabels, type Kind, type Ledger, type Recurring } from "@domain/ledger.ts";
import { recurringSuggestions, type RecurringSuggestion } from "@domain/suggestions.ts";
import { ledgerQuery } from "../../api/ledger";
import { useAccountEmail } from "../../auth/account";
import { useToday } from "../../app/useToday";
import { Badge, Button, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { categoryTint } from "../../design/categoryTint";
import { TABLET, useMediaQuery } from "../../app/useMediaQuery";
import { formatCents, Money } from "../../design/Money";
import { leavingProps, useFadingHighlight, useListMotion } from "../../design/motion";
import { ManageAdd } from "../organize/ManageAdd";
import { GroupLink } from "../households/links";
import { Banner, ErrorState, LoadingState, useToast, useToastEntry } from "../../design/states";
import { LedgerSaveError } from "../../offline/engine";
import { useLedgerEngine, useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { parseLedger } from "../../offline/wire";
import {
  accountOf,
  categoryOf,
  dayLabel,
  FREQUENCY_LABELS,
  KIND_HEADINGS,
  KIND_ORDER,
  renewsSoonIn,
  rowAmount,
  scheduleTile,
  seenLabel,
  shortDay,
  sortSchedules,
  suggestionCadence,
  TONE,
  type ScheduleView,
} from "./model";
import { RemoveScheduleDialog, ScheduleDetailDialog } from "./ScheduleDetail";
import { ScheduleFormDialog } from "./ScheduleForm";
import { useSharedSchedules, type SharedSchedule } from "./shared";

/** One row of a kind's list: a personal rule, or a shared rule the account is part of (always an expense). */
type Item = { key: string; active: boolean; nextDate: string; title: string } & ({ personal: Recurring } | { shared: SharedSchedule });

/** Where focus goes once the list has caught up: a suggestion's first button, a schedule's row, or New schedule. */
type FocusTarget = { suggestion: string } | { rule: string } | { newSchedule: true };

/**
 * Personal recurring schedules (MAZ-90; cards `iphone-recurring`, `iphone-schedule-detail`;
 * specimens `recurring`, `recurring-paused`, `schedule`, `edit-schedule`, `remove-schedule`).
 * Rules live in the personal ledger, so the list reads and writes the durable offline copy
 * (MAZ-87): every change is saved on this device first and syncs from there. In the demo, which
 * stores nothing, the server's sample ledger is shown read-only. Shared schedules the account is
 * part of are listed with the expenses, marked Shared, with the account's share (MAZ-177); they
 * open their household, where they're edited.
 *
 * Suggested (MAZ-290; cards `web-recurring-suggested`, `web-schedule-suggested`,
 * `web-suggestion-dismissed-toast`, `web-recurring-empty`): personal entries that repeat (the shared
 * `recurringSuggestions`, on the personal ledger and today's local date) are offered above the
 * schedules. Make it a schedule opens the schedule form filled in; Dismiss acts at once, with Undo
 * on the toast, and the dismissal syncs through the ledger.
 */
export function RecurringPage() {
  const email = useAccountEmail();
  const engine = useLedgerEngine();
  const sync = useLedgerSync();
  const toast = useToast();
  const phone = !useMediaQuery(TABLET);
  const today = useToday();
  const server = useQuery({ ...ledgerQuery(email), enabled: !engine });
  const demoLedger = useMemo(() => {
    if (engine || !server.data) return null;
    try {
      return parseLedger(server.data.ledger);
    } catch {
      return null;
    }
  }, [engine, server.data]);
  const ledger: Ledger | null = engine ? (sync?.ledger ?? null) : demoLedger;
  const { schedules: shared, loading: sharedLoading } = useSharedSchedules(email);
  const waiting = useMemo(() => new Set(sync?.pending.ruleIds ?? []), [sync?.pending.ruleIds]);
  const [view, setView] = useState<ScheduleView | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const emptyButton = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  /** A removed rule whose row (the dialog's opener) is going away. */
  const removed = useRef<string | null>(null);
  /** Where focus goes once the row it names is on the page. */
  const focusNext = useRef<FocusTarget | null>(null);

  const suggestions = useMemo(() => (ledger ? recurringSuggestions(ledger, today) : []), [ledger, today]);
  // docs/design/motion.md, MAZ-290: a dismissed or accepted suggestion leaves as a deleted row; one that comes back (Undo) rises in.
  const { rows: suggestionRows, animateInserts: animateSuggestions } = useListMotion(suggestions, suggestionKey, "suggestions");
  // The schedule a suggestion just became: highlighted while its toast shows, then the tint fades (Saving › New row).
  const saved = useToastEntry();
  const unsaving = useFadingHighlight(saved);

  // After a removal the row that opened the dialog is gone: continue from New schedule. Runs after
  // every commit, because the row may leave the list in the same commit as the dialog or a later one.
  useEffect(() => {
    const id = removed.current;
    if (!id || view || ledger?.recurring.some((rule) => rule.id === id)) return;
    removed.current = null;
    newButton.current?.focus();
  });

  // After Dismiss, Undo or accepting a suggestion, focus moves to the row named once it's on the page
  // (after the dialog has returned focus to its opener, which may be leaving).
  useEffect(() => {
    const target = focusNext.current;
    if (!target || view) return;
    if ("newSchedule" in target) {
      focusNext.current = null;
      (newButton.current ?? emptyButton.current)?.focus();
      return;
    }
    const selector = "suggestion" in target ? `[data-suggestion="${CSS.escape(target.suggestion)}"]:not([data-leaving]) .suggestion__make` : `[data-schedule="${CSS.escape(target.rule)}"]`;
    const element = pageRef.current?.querySelector<HTMLElement>(selector);
    if (!element) return;
    focusNext.current = null;
    element.focus();
  });

  if (!ledger) {
    if (engine ? !sync || sync.phase === "loading" || sync.phase === "syncing" : server.isPending) return <LoadingState label="Loading your schedules…" />;
    return (
      <ErrorState
        title="Penny couldn't load your schedules"
        onRetry={() => {
          if (engine) void engine.syncNow();
          else void server.refetch();
        }}
        retrying={engine ? sync?.phase === "syncing" : server.isFetching}
      >
        {sync?.issue?.message ?? "Nothing was changed. Check your connection and try again."}
      </ErrorState>
    );
  }

  const readOnly = !engine;
  const close = () => {
    setView(null);
  };
  const openNew = () => {
    setView({ kind: "new" });
  };
  const create = readOnly ? null : <ManageAdd ref={newButton} label="New schedule" onClick={openNew} />;

  async function dismiss(suggestion: RecurringSuggestion) {
    if (!engine) return;
    // Focus continues on the next suggestion (or the one before); with none left, on New schedule.
    const index = suggestions.findIndex((item) => item.id === suggestion.id);
    const neighbour = suggestions[index + 1] ?? suggestions[index - 1];
    focusNext.current = neighbour ? { suggestion: neighbour.id } : { newSchedule: true };
    try {
      const receipt = await engine.save(dismissSuggestion(suggestion));
      const offline = receipt.savedOffline ? "Saved on this device. It syncs when you're back online." : null;
      // Phones follow `iphone-suggestion-dismissed-toast` (the suggestion's tile, and what it was under
      // "Suggestion dismissed"); wider screens `web-suggestion-dismissed-toast`.
      const category = ledger ? categoryOf(ledger, suggestion.categoryId) : undefined;
      const about = `${suggestion.title} · about ${formatCents(suggestion.share, ledger?.currency)} ${EVERY[suggestion.frequency]}`;
      toast.show({
        ...(phone
          ? {
              title: "Suggestion dismissed",
              detail: offline ?? about,
              tile: { icon: scheduleTile(suggestion.kind, category).icon, color: categoryTint({ ...category, entryKind: suggestion.kind }) },
            }
          : { title: `${suggestion.title} suggestion dismissed`, icon: "neutral" as const, ...(offline ? { detail: offline } : {}) }),
        onUndo: () => {
          focusNext.current = { suggestion: suggestion.id };
          void engine.save(undoDismissSuggestion(suggestion)).catch((failure: unknown) => {
            focusNext.current = null;
            toast.show({ tone: "error", title: "Penny couldn't bring the suggestion back", detail: saveMessage(failure) });
          });
        },
      });
    } catch (failure) {
      focusNext.current = null;
      toast.show({ tone: "error", title: "Penny couldn't dismiss this suggestion", detail: saveMessage(failure) });
    }
  }

  const items: (Item & { kind: Kind })[] = [
    ...ledger.recurring.map((rule) => ({ key: rule.id, kind: rule.kind, active: rule.active, nextDate: rule.nextDate, title: rule.title, personal: rule })),
    ...shared.map((schedule) => ({
      key: `shared:${schedule.rule.id}`,
      kind: "expense" as const,
      active: schedule.rule.active,
      nextDate: schedule.rule.nextDate,
      title: schedule.rule.title,
      shared: schedule,
    })),
  ];
  const groups = KIND_ORDER.map((kind) => ({ kind, items: sortSchedules(items.filter((item) => item.kind === kind)) })).filter((group) => group.items.length);
  const empty = groups.length === 0 && suggestionRows.length === 0;

  return (
    <div ref={pageRef} className={cx("page recurring", empty && "recurring--empty")}>
      {create}
      <p className="page__subtitle recurring__lead">Penny records these on their date.</p>
      {readOnly ? (
        <Banner tone="info" title="Sample schedules">
          The demo shows schedules but doesn't save changes. Sign in to manage your own.
        </Banner>
      ) : null}

      {suggestionRows.length ? (
        <section className="recurring-group suggestions" aria-labelledby="recurring-suggested">
          <h2 id="recurring-suggested" className="group-label">
            <span>
              Suggested<span className="visually-hidden">, </span>
            </span>
            <span className="group-label__count">{suggestions.length}</span>
          </h2>
          <ul className="group-list group-list--inset suggestion-list" aria-label="Suggested schedules" data-animate-inserts={animateSuggestions ? "" : undefined}>
            {suggestionRows.map(({ item: suggestion, key, leaving, entering }) => (
              <li key={leaving ? `${key}:leaving` : key} className="suggestion" data-suggestion={suggestion.id} data-entering={entering ? "" : undefined} {...(leaving ? leavingProps : {})}>
                <SuggestionRow
                  suggestion={suggestion}
                  ledger={ledger}
                  today={today}
                  readOnly={readOnly}
                  onAccept={() => {
                    setView({ kind: "suggestion", suggestion });
                  }}
                  onDismiss={() => {
                    void dismiss(suggestion);
                  }}
                />
              </li>
            ))}
          </ul>
          <p className="group-note">Penny found these repeating in your activity. A schedule counts them in Projected; your past entries stay as they are.</p>
        </section>
      ) : null}

      {empty ? (
        <div className="recurring-empty">
          <span className="recurring-empty__icon" aria-hidden="true">
            <Icon name="repeat" size={32} weight={36} />
          </span>
          <h2 className="recurring-empty__title">No schedules yet</h2>
          <p className="recurring-empty__body">Add your pay, rent and subscriptions once. Penny records them on their date and counts them in Projected.</p>
          {readOnly ? null : (
            <Button ref={emptyButton} variant="primary" icon="add" className="recurring-empty__add" onClick={openNew}>
              New schedule
            </Button>
          )}
          <p className="recurring-empty__hint">
            <Icon name="time" size={18} />
            <span>When an expense or income repeats in your activity, with the same name and a steady amount, Penny suggests it here.</span>
          </p>
        </div>
      ) : null}

      {groups.map((group) => (
        <ScheduleGroup
          key={group.kind}
          kind={group.kind}
          items={group.items}
          loading={sharedLoading}
          ledger={ledger}
          waiting={waiting}
          saved={saved}
          unsaving={unsaving}
          onOpen={(id) => {
            setView({ kind: "detail", id });
          }}
        />
      ))}
      {groups.length ? (
        <p className="group-note">
          Open a schedule to edit, pause or remove it. Edits change future dates only; removing a schedule keeps the entries it already recorded.
          {shared.length ? " Shared schedules open their household and count only your share." : ""}
        </p>
      ) : null}

      {view?.kind === "new" ? <ScheduleFormDialog ledger={ledger} onClose={close} /> : null}
      {view?.kind === "suggestion" ? (
        <ScheduleFormDialog
          ledger={ledger}
          suggestion={view.suggestion}
          // Cancelling keeps the suggestion, and focus returns to its button.
          onClose={close}
          onSaved={(ruleId) => {
            // The suggestion leaves (its schedule covers it now): continue on the new schedule's row.
            focusNext.current = { rule: ruleId };
            setView(null);
          }}
        />
      ) : null}
      {view?.kind === "edit" ? (
        <ScheduleFormDialog
          ledger={ledger}
          original={view.rule}
          // Cancel and Save both return to the detail, which shows the result.
          onClose={() => {
            setView({ kind: "detail", id: view.rule.id });
          }}
        />
      ) : null}
      {view?.kind === "detail" ? (
        <ScheduleDetailDialog ledger={ledger} id={view.id} waiting={waiting.has(view.id)} readOnly={readOnly} onClose={close} onNavigate={setView} />
      ) : null}
      {view?.kind === "remove" ? (
        <RemoveScheduleDialog
          rule={view.rule}
          onCancel={() => {
            setView({ kind: "detail", id: view.rule.id });
          }}
          onRemoved={() => {
            removed.current = view.rule.id;
            setView(null);
          }}
        />
      ) : null}
    </div>
  );
}

const suggestionKey = (suggestion: RecurringSuggestion) => suggestion.id;
/** "Netflix · about $16.99 every month" on the phone toast (`iphone-suggestion-dismissed-toast`). */
const EVERY: Record<RecurringSuggestion["frequency"], string> = { weekly: "every week", monthly: "every month", yearly: "every year" };
const itemKey = (item: Item) => item.key;

function saveMessage(failure: unknown): string {
  return failure instanceof LedgerSaveError || failure instanceof Error ? failure.message : "Nothing was changed. Try again.";
}

/** A kind's schedules. A new one rises in (with the saved highlight when a suggestion became it); a removed one fades out. */
function ScheduleGroup({
  kind,
  items,
  loading,
  ledger,
  waiting,
  saved,
  unsaving,
  onOpen,
}: {
  kind: Kind;
  items: Item[];
  /** The shared schedules are still loading: rows arriving with them are part of opening the page. */
  loading: boolean;
  ledger: Ledger;
  waiting: Set<string>;
  saved: string | null;
  unsaving: string | null;
  onOpen: (id: string) => void;
}) {
  // A new context resets the motion, so shared rows that arrive with the households don't play the insert.
  const { rows, animateInserts } = useListMotion(items, itemKey, `${kind}:${loading ? "loading" : "ready"}`);
  return (
    <section className="recurring-group" aria-labelledby={`recurring-${kind}`}>
      <h2 id={`recurring-${kind}`} className="group-label">
        {KIND_HEADINGS[kind]}
      </h2>
      <ul className="group-list group-list--inset recurring-list" aria-label={`${kindLabels[kind]} schedules`} data-animate-inserts={animateInserts ? "" : undefined}>
        {rows.map(({ item, key, leaving, entering }) => (
          <li key={leaving ? `${key}:leaving` : key} data-entering={entering ? "" : undefined} {...(leaving ? leavingProps : {})}>
            {"personal" in item ? (
              <ScheduleRow
                rule={item.personal}
                ledger={ledger}
                waiting={waiting.has(item.personal.id)}
                highlight={saved === item.personal.id ? "saved" : unsaving === item.personal.id ? "fading" : null}
                onOpen={() => {
                  onOpen(item.personal.id);
                }}
              />
            ) : (
              <SharedScheduleRow schedule={item.shared} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A suggestion (card `web-recurring-suggested`): the tile, the name with its Expense, Income or
 * Investment tag, the cadence, how often it was seen, the newest amount ("was $15.49" after a price
 * step), then Make it a schedule and Dismiss. On phones the actions go under the row
 * (`iphone-recurring-suggested`).
 */
function SuggestionRow({
  suggestion,
  ledger,
  today,
  readOnly,
  onAccept,
  onDismiss,
}: {
  suggestion: RecurringSuggestion;
  ledger: Ledger;
  today: string;
  readOnly: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const titleId = useId();
  const tile = scheduleTile(suggestion.kind, categoryOf(ledger, suggestion.categoryId));
  return (
    <div className="suggestion__row">
      <span className="category-dot schedule-row__tile suggestion__tile" style={tile.style} aria-hidden="true">
        <Icon name={tile.icon} size={19} weight={40} />
      </span>
      <span className="schedule-row__title suggestion__title">
        <span id={titleId}>{suggestion.title}</span>
        <Badge>{kindLabels[suggestion.kind]}</Badge>
      </span>
      <span className="schedule-row__meta suggestion__cadence">{suggestionCadence(suggestion)}</span>
      <span className="schedule-row__meta suggestion__seen">{seenLabel(suggestion, today)}</span>
      <span className="schedule-row__end suggestion__amount">
        <Money {...rowAmount(suggestion.kind, suggestion.share)} currency={ledger.currency} tone={TONE[suggestion.kind]} />
        {suggestion.previousShare !== undefined ? <span className="schedule-row__share">was {formatCents(suggestion.previousShare, ledger.currency)}</span> : null}
      </span>
      {readOnly ? null : (
        <span className="suggestion__actions">
          <Button variant="primary" className="suggestion__make" aria-describedby={titleId} aria-haspopup="dialog" onClick={onAccept}>
            Make it a schedule
          </Button>
          <Button variant="secondary" aria-describedby={titleId} onClick={onDismiss}>
            Dismiss
          </Button>
        </span>
      )}
    </div>
  );
}

/**
 * "Monthly · next Nov 18", or "Paused · monthly" as a tag while paused (the card's Gym row). A yearly
 * schedule that renews soon says "Yearly · renews Thu, Nov 12" (`web-recurring-renews-soon`, MAZ-290).
 */
function Timing({ rule, renewsSoon = false }: { rule: { active: boolean; frequency: keyof typeof FREQUENCY_LABELS; nextDate: string }; renewsSoon?: boolean }) {
  if (!rule.active) {
    return (
      <span className="schedule-row__line">
        <Badge icon="pause">Paused · {FREQUENCY_LABELS[rule.frequency].toLowerCase()}</Badge>
      </span>
    );
  }
  return (
    <span>
      {FREQUENCY_LABELS[rule.frequency]} · {renewsSoon ? "renews" : "next"} <time dateTime={rule.nextDate}>{renewsSoon ? dayLabel(rule.nextDate) : shortDay(rule.nextDate)}</time>
    </span>
  );
}

/**
 * Whether a row's Renews soon tag shows (MAZ-290, docs/design/motion.md): present when the page opens
 * with no animation; "entering" when the schedule enters its window while the page is open (the tag
 * fades in), "leaving" for the `quick` fade out when the date passes, then hidden.
 */
function useRenewsSoonTag(soon: boolean): "shown" | "entering" | "leaving" | "hidden" {
  const [state, setState] = useState<"shown" | "entering" | "leaving" | "hidden">(soon ? "shown" : "hidden");
  const [previous, setPrevious] = useState(soon);
  if (soon !== previous) {
    // A change while the page is open: adjust during render (React's "storing information from previous renders").
    setPrevious(soon);
    setState(soon ? "entering" : "leaving");
  }
  useEffect(() => {
    if (state !== "leaving") return undefined;
    const timer = window.setTimeout(() => {
      setState("hidden");
    }, 150);
    return () => {
      window.clearTimeout(timer);
    };
  }, [state]);
  return state;
}

function ScheduleRow({ rule, ledger, waiting, highlight = null, onOpen }: { rule: Recurring; ledger: Ledger; waiting: boolean; highlight?: "saved" | "fading" | null; onOpen: () => void }) {
  const today = useToday();
  const soon = useRenewsSoonTag(renewsSoonIn(rule, today) !== null);
  const account = accountOf(ledger, rule.accountId);
  const tile = scheduleTile(rule.kind, categoryOf(ledger, rule.categoryId));
  return (
    <button
      type="button"
      className={cx("schedule-row", !rule.active && "schedule-row--paused", highlight === "saved" && "schedule-row--saved", highlight === "fading" && "schedule-row--unsaving")}
      data-schedule={rule.id}
      onClick={onOpen}
      aria-haspopup="dialog"
    >
      <span className="category-dot schedule-row__tile" style={tile.style} aria-hidden="true">
        <Icon name={tile.icon} size={19} weight={40} />
      </span>
      <span className="schedule-row__text">
        <span className="schedule-row__title">
          {rule.title}
          {/* Amber, beside the name, for a yearly schedule renewing within 7 days (MAZ-290). It fades in and out; the row keeps its height. */}
          {soon !== "hidden" ? (
            <span className={cx("renews-soon", soon === "entering" && "renews-soon--entering", soon === "leaving" && "renews-soon--leaving")} data-renews-soon={rule.id}>
              <Badge tone="renewal" icon="time">
                Renews soon
              </Badge>
            </span>
          ) : null}
        </span>
        {/* The account follows the timing, or takes its own line when both don't fit (no stranded "·"). */}
        <span className="schedule-row__meta inline-list">
          <span className="inline-list__items">
            <Timing rule={rule} renewsSoon={soon === "shown" || soon === "entering"} />
            {account ? (
              <span className="schedule-row__inline-account">
                <span className="visually-hidden"> · </span>
                {account.name}
              </span>
            ) : null}
          </span>
        </span>
      </span>
      {/* From 768px the account is its own column before the amount (card `web-recurring`). */}
      <span className="schedule-row__account" aria-hidden="true">
        {account?.name}
      </span>
      <span className="schedule-row__end">
        <Money {...rowAmount(rule.kind, rule.share)} currency={ledger.currency} tone={TONE[rule.kind]} />
        {waiting ? <Badge tone="pending">Waiting to sync</Badge> : null}
      </span>
      <Icon name="chevron-forward" size={14} weight={56} />
    </button>
  );
}

function SharedScheduleRow({ schedule }: { schedule: SharedSchedule }) {
  const { rule, household, shareCents } = schedule;
  const tile = scheduleTile("expense", rule.category);
  return (
    <GroupLink
      route={household.trip ? "trips" : "households"}
      householdId={household.id}
      search={{ rule: schedule.rule.id }}
      className={cx("schedule-row", !rule.active && "schedule-row--paused")}
    >
      <span className="category-dot schedule-row__tile" style={tile.style} aria-hidden="true">
        <Icon name={tile.icon} size={19} weight={40} />
      </span>
      <span className="schedule-row__text">
        <span className="schedule-row__title">
          {rule.title} <Badge icon="people">Shared</Badge>
        </span>
        <span className="schedule-row__meta">
          <Timing rule={rule} />
        </span>
        <span className="schedule-row__meta schedule-row__inline-account">{household.name}</span>
      </span>
      <span className="schedule-row__account" aria-hidden="true">
        {household.name}
      </span>
      <span className="schedule-row__end">
        <Money {...rowAmount("expense", shareCents)} currency={household.currency} />
        <span className="schedule-row__share">your share</span>
      </span>
      <Icon name="chevron-forward" size={14} weight={56} />
    </GroupLink>
  );
}
