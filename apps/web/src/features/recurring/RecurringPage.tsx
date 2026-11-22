import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { kindLabels, type Kind, type Ledger, type Recurring } from "@domain/ledger.ts";
import { ledgerQuery } from "../../api/ledger";
import { useAccountEmail } from "../../auth/account";
import { Badge, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { ManageAdd } from "../organize/ManageAdd";
import { GroupLink } from "../households/links";
import { Banner, EmptyState, ErrorState, LoadingState } from "../../design/states";
import { useLedgerEngine, useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { parseLedger } from "../../offline/wire";
import { accountOf, categoryOf, FREQUENCY_LABELS, KIND_HEADINGS, KIND_ORDER, rowAmount, scheduleTile, shortDay, sortSchedules, TONE, type ScheduleView } from "./model";
import { RemoveScheduleDialog, ScheduleDetailDialog } from "./ScheduleDetail";
import { ScheduleFormDialog } from "./ScheduleForm";
import { useSharedSchedules, type SharedSchedule } from "./shared";

/** One row of a kind's list: a personal rule, or a shared rule the account is part of (always an expense). */
type Item = { key: string; active: boolean; nextDate: string; title: string } & ({ personal: Recurring } | { shared: SharedSchedule });

/**
 * Personal recurring schedules (MAZ-90; cards `iphone-recurring`, `iphone-schedule-detail`;
 * specimens `recurring`, `recurring-paused`, `schedule`, `edit-schedule`, `remove-schedule`).
 * Rules live in the personal ledger, so the list reads and writes the durable offline copy
 * (MAZ-87): every change is saved on this device first and syncs from there. In the demo, which
 * stores nothing, the server's sample ledger is shown read-only. Shared schedules the account is
 * part of are listed with the expenses, marked Shared, with the account's share (MAZ-177); they
 * open their household, where they're edited.
 */
export function RecurringPage() {
  const email = useAccountEmail();
  const engine = useLedgerEngine();
  const sync = useLedgerSync();
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
  const shared = useSharedSchedules(email);
  const waiting = useMemo(() => new Set(sync?.pending.ruleIds ?? []), [sync?.pending.ruleIds]);
  const [view, setView] = useState<ScheduleView | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  /** A removed rule whose row (the dialog's opener) is going away. */
  const removed = useRef<string | null>(null);

  // After a removal the row that opened the dialog is gone: continue from New schedule. Runs after
  // every commit, because the row may leave the list in the same commit as the dialog or a later one.
  useEffect(() => {
    const id = removed.current;
    if (!id || view || ledger?.recurring.some((rule) => rule.id === id)) return;
    removed.current = null;
    newButton.current?.focus();
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
  const create = readOnly ? null : (
    <ManageAdd
      ref={newButton}
      label="New schedule"
      onClick={() => {
        setView({ kind: "new" });
      }}
    />
  );

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

  return (
    <div className="page recurring">
      {create}
      <p className="page__subtitle">Penny records these on their date.</p>
      {readOnly ? (
        <Banner tone="info" title="Sample schedules">
          The demo shows schedules but doesn't save changes. Sign in to manage your own.
        </Banner>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState icon="repeat" title="Rent, payday, the usuals.">
          <p>Add a weekly, monthly or yearly schedule and Penny records each entry on its date.</p>
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.kind} className="recurring-group" aria-labelledby={`recurring-${group.kind}`}>
            <h2 id={`recurring-${group.kind}`} className="group-label">
              {KIND_HEADINGS[group.kind]}
            </h2>
            <ul className="group-list group-list--inset" aria-label={`${kindLabels[group.kind]} schedules`}>
              {group.items.map((item) => (
                <li key={item.key}>
                  {"personal" in item ? (
                    <ScheduleRow
                      rule={item.personal}
                      ledger={ledger}
                      waiting={waiting.has(item.personal.id)}
                      onOpen={() => {
                        setView({ kind: "detail", id: item.personal.id });
                      }}
                    />
                  ) : (
                    <SharedScheduleRow schedule={item.shared} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="group-note">
        Open a schedule to edit, pause or remove it. Edits change future dates only; removing a schedule keeps the entries it already recorded.
        {shared.length ? " Shared schedules open their household and count only your share." : ""}
      </p>

      {view?.kind === "new" ? <ScheduleFormDialog ledger={ledger} onClose={close} /> : null}
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

/** "Monthly · next Nov 18", or "Paused · monthly" as a tag while paused (the card's Gym row). */
function Timing({ rule }: { rule: { active: boolean; frequency: keyof typeof FREQUENCY_LABELS; nextDate: string } }) {
  if (!rule.active) {
    return (
      <span className="schedule-row__line">
        <Badge icon="pause">Paused · {FREQUENCY_LABELS[rule.frequency].toLowerCase()}</Badge>
      </span>
    );
  }
  return (
    <span>
      {FREQUENCY_LABELS[rule.frequency]} · next <time dateTime={rule.nextDate}>{shortDay(rule.nextDate)}</time>
    </span>
  );
}

function ScheduleRow({ rule, ledger, waiting, onOpen }: { rule: Recurring; ledger: Ledger; waiting: boolean; onOpen: () => void }) {
  const account = accountOf(ledger, rule.accountId);
  const tile = scheduleTile(rule.kind, categoryOf(ledger, rule.categoryId));
  return (
    <button type="button" className={cx("schedule-row", !rule.active && "schedule-row--paused")} onClick={onOpen} aria-haspopup="dialog">
      <span className="category-dot schedule-row__tile" style={tile.style} aria-hidden="true">
        <Icon name={tile.icon} size={19} weight={40} />
      </span>
      <span className="schedule-row__text">
        <span className="schedule-row__title">{rule.title}</span>
        {/* The account follows the timing, or takes its own line when both don't fit (no stranded "·"). */}
        <span className="schedule-row__meta inline-list">
          <span className="inline-list__items">
            <Timing rule={rule} />
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
