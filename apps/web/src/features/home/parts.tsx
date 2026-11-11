import type { Ledger, Transaction } from "@domain/ledger.ts";
import type { OverviewEntry } from "@domain/selectors/overview.ts";
import { Link } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";
import { Badge, Button, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Money } from "../../design/Money";
import { categoryIcon } from "../entries/model";
import { currentMonth, dayLabel, monthLabel, shiftMonth } from "../households/model";
import { groupSmall, isSharedEntry, percentOf } from "./model";

/** A card with its own heading level: `h2` at the top of a page, `h3` inside a section. */
export function Panel({ title, level = 2, action, className, children }: { title: string; level?: 2 | 3; action?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={cx("card", className)} aria-labelledby={id}>
      <div className="card__head">
        <Heading id={id} className="panel__title">
          {title}
        </Heading>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Previous, the month, Next, and This month when another month is shown. */
export function MonthBar({ month, onChange }: { month: string; onChange: (month: string | undefined) => void }) {
  const now = currentMonth();
  return (
    <div className="month-bar">
      <div className="month-nav">
        <Button
          iconOnly
          icon="chevron-back"
          variant="quiet"
          aria-label="Previous month"
          disabled={month <= "2000-01"}
          onClick={() => {
            onChange(shiftMonth(month, -1));
          }}
        />
        <span className="month-nav__label" aria-live="polite">
          {monthLabel(month)}
        </span>
        <Button
          iconOnly
          icon="chevron-forward"
          variant="quiet"
          aria-label="Next month"
          disabled={month >= "2100-12"}
          onClick={() => {
            onChange(shiftMonth(month, 1));
          }}
        />
      </div>
      {month !== now ? (
        <Button
          variant="quiet"
          icon="calendar"
          onClick={() => {
            onChange(undefined);
          }}
        >
          This month
        </Button>
      ) : null}
    </div>
  );
}

const TONE = { expense: "expense", income: "income", investment: "investment" } as const;

/**
 * Entries of the month: personal ones open their detail, shared ones open the expense in its
 * household, and scheduled occurrences are labelled "Scheduled" (amber) and open nothing, so a
 * preview never looks like a recorded entry.
 */
export function EntryRows({ entries, ledger, currency, onOpen }: { entries: readonly OverviewEntry[]; ledger: Ledger; currency: string | undefined; onOpen: (entry: Transaction, opener: HTMLElement) => void }) {
  const categories = new Map(ledger.categories.map((category) => [category.id, category]));
  const accounts = new Map(ledger.accounts.map((account) => [account.id, account.name]));
  return (
    <ul className="results home-rows">
      {entries.map((entry) => {
        const category = categories.get(entry.categoryId);
        const shared = isSharedEntry(entry) ? entry : null;
        const account = !shared && entry.accountId ? accounts.get(entry.accountId) : undefined;
        const meta = [
          entry.scheduled ? null : shared ? (shared.householdName ? `Shared · ${shared.householdName}` : "Shared") : null,
          category?.name,
          account,
        ].filter(Boolean);
        const body = (
          <>
            <span className="category-dot" style={{ color: category?.color }}>
              <Icon name={categoryIcon(category?.icon)} size={18} />
            </span>
            <span className="results__title">{entry.title}</span>
            <span className="results__meta">
              {entry.scheduled ? (
                <Badge tone="pending" icon="time">
                  Scheduled
                </Badge>
              ) : null}{" "}
              {meta.length ? `${meta.join(" · ")} · ` : ""}
              <time dateTime={entry.date}>{dayLabel(entry.date)}</time>
            </span>
            <span className="results__amount">
              <Money cents={entry.share} currency={currency} tone={entry.scheduled ? "pending" : TONE[entry.kind]} signed={entry.kind === "income" && !entry.scheduled} />
              {shared || entry.share !== entry.total ? <span className="results__sub">your share</span> : null}
            </span>
          </>
        );
        if (entry.scheduled) {
          return (
            <li key={entry.id} className="results__row activity-row">
              <div className="activity-row__main activity-row__main--static">{body}</div>
            </li>
          );
        }
        if (shared) {
          return (
            <li key={entry.id} className="results__row activity-row">
              <Link to="/households/$id/expenses/$expenseId" params={{ id: shared.householdId, expenseId: shared.householdExpenseId }} className="activity-row__main">
                {body}
              </Link>
            </li>
          );
        }
        return (
          <li key={entry.id} className="results__row activity-row">
            <button
              type="button"
              className="activity-row__main"
              data-row-key={entry.id}
              onClick={(event) => {
                onOpen(entry, event.currentTarget);
              }}
            >
              {body}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Recorded spending by category (your share, shared categories included): the five largest and
 * the rest grouped into "N more", each with its amount and percent in text; the bar is decoration.
 * Choosing a category filters the list below.
 */
export function CategoryBreakdown({
  spending,
  currency,
  selected,
  onSelect,
}: {
  spending: Parameters<typeof groupSmall>[0];
  currency: string | undefined;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const { rows, total } = groupSmall(spending);
  return (
    <Panel title="By category" level={3} className="breakdown" action={<span className="muted">Your share</span>}>
      {rows.length ? (
        <>
          <ol className="breakdown__list">
            {rows.map((row) => {
              const percent = percentOf(row.amount, total);
              const content = (
                <>
                  <span className="category-dot" style={row.color ? { color: row.color } : undefined}>
                    <Icon name={categoryIcon(row.icon)} size={18} />
                  </span>
                  <span className="breakdown__name">{row.name}</span>
                  <span className="breakdown__amount">
                    <Money cents={row.amount} currency={currency} /> <span className="muted">· {percent}%</span>
                  </span>
                  <span className="breakdown__track" aria-hidden="true">
                    <span className="breakdown__fill" style={{ width: `${String((row.amount / Math.max(1, total)) * 100)}%`, background: row.color || "var(--pk-c-other)" }} />
                  </span>
                </>
              );
              return (
                <li key={row.id}>
                  {row.id === "more" ? (
                    <div className="breakdown__row">{content}</div>
                  ) : (
                    <button
                      type="button"
                      className={cx("breakdown__row", selected === row.id && "breakdown__row--on")}
                      aria-pressed={selected === row.id}
                      onClick={() => {
                        onSelect(selected === row.id ? undefined : row.id);
                      }}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="note">Based on your share, including split and shared expenses.{rows.some((row) => row.id === "more") ? " Smaller categories are grouped." : ""}</p>
        </>
      ) : (
        <p className="muted">No spending recorded this month.</p>
      )}
    </Panel>
  );
}
