import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { kindLabels, type Ledger, type Recurring } from "@domain/ledger.ts";
import { ledgerQuery } from "../../api/ledger";
import { useAccountEmail } from "../../auth/account";
import { Badge, Button, Card } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { Banner, EmptyState, ErrorState, LoadingState } from "../../design/states";
import { useLedgerEngine, useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { parseLedger } from "../../offline/wire";
import { accountOf, FREQUENCY_LABELS, KIND_HEADINGS, KIND_ORDER, shortDay, sortSchedules, TONE, type ScheduleView } from "./model";
import { RemoveScheduleDialog, ScheduleDetailDialog } from "./ScheduleDetail";
import { ScheduleFormDialog } from "./ScheduleForm";

/**
 * Personal recurring schedules (MAZ-90; cards `iphone-recurring`, `iphone-schedule-detail`;
 * specimens `recurring`, `recurring-paused`, `schedule`, `edit-schedule`, `remove-schedule`).
 * Rules live in the personal ledger, so the list reads and writes the durable offline copy
 * (MAZ-87): every change is saved on this device first and syncs from there. In the demo, which
 * stores nothing, the server's sample ledger is shown read-only.
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
    <Button
      ref={newButton}
      variant="primary"
      icon="add"
      onClick={() => {
        setView({ kind: "new" });
      }}
    >
      New schedule
    </Button>
  );

  const groups = KIND_ORDER.map((kind) => ({ kind, rules: sortSchedules(ledger.recurring.filter((rule) => rule.kind === kind)) })).filter((group) => group.rules.length);
  const paused = ledger.recurring.filter((rule) => !rule.active).length;

  return (
    <div className="page recurring">
      <div className="recurring__head">
        <p className="muted">
          Penny records these on their date, on this device first, and syncs them.
          {ledger.recurring.length ? ` ${String(ledger.recurring.length - paused)} active${paused ? `, ${String(paused)} paused` : ""}.` : ""}
        </p>
        {create}
      </div>
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
          <Card key={group.kind} title={KIND_HEADINGS[group.kind]}>
            <ul className="row-list" aria-label={`${kindLabels[group.kind]} schedules`}>
              {group.rules.map((rule) => (
                <li key={rule.id}>
                  <ScheduleRow
                    rule={rule}
                    ledger={ledger}
                    waiting={waiting.has(rule.id)}
                    onOpen={() => {
                      setView({ kind: "detail", id: rule.id });
                    }}
                  />
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      <p className="note">Open a schedule to edit, pause or remove it. Edits change future dates only; removing a schedule keeps the entries it already recorded.</p>

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

function ScheduleRow({ rule, ledger, waiting, onOpen }: { rule: Recurring; ledger: Ledger; waiting: boolean; onOpen: () => void }) {
  const account = accountOf(ledger, rule.accountId);
  const meta = rule.active ? (
    <>
      {FREQUENCY_LABELS[rule.frequency]} · next <time dateTime={rule.nextDate}>{shortDay(rule.nextDate)}</time>
    </>
  ) : (
    <>Paused · {FREQUENCY_LABELS[rule.frequency].toLowerCase()}</>
  );
  return (
    <button type="button" className="row schedule-row" onClick={onOpen} aria-haspopup="dialog">
      <span className="schedule-row__icon" aria-hidden="true">
        <Icon name={rule.active ? "repeat" : "pause"} size={18} weight={40} />
      </span>
      <span className="schedule-row__text">
        <span className="row__title">{rule.title}</span>
        <span className="row__meta">
          {meta}
          {account ? ` · ${account.name}` : ""}
        </span>
      </span>
      <span className="row__end">
        <Money cents={rule.share} currency={ledger.currency} tone={TONE[rule.kind]} />
        {!rule.active ? <Badge>Paused</Badge> : null}
        {waiting ? <Badge tone="pending">Waiting to sync</Badge> : null}
      </span>
    </button>
  );
}
