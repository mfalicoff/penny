import type { Ledger, Transaction } from "@domain/ledger.ts";
import type { OverviewEntry } from "@domain/selectors/overview.ts";
import { isExpectedIncome } from "@domain/summary.ts";
import { Link } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTopbarSlot } from "../../app/shell/pageTitle";
import { useToday } from "../../app/useToday";
import { Badge, Button, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { categoryTint, tileStyle } from "../../design/categoryTint";
import { Money } from "../../design/Money";
import { categoryIcon } from "../entries/model";
import { rowAmount } from "../recurring/model";
import { currentMonth, dayLabel, monthLabel, shiftMonth } from "../households/model";
import { groupSmall, isSharedEntry, percentOf } from "./model";

/**
 * A card with its own heading level: `h2` at the top of a page, `h3` inside a section.
 *
 * `list` panels (MAZ-222) hold a list: on phones and narrow windows the cards put the heading
 * above a solid list card ("Recent", "Categories"); from 1100px, as on the iPad and desktop
 * cards, the heading sits inside the panel.
 */
export function Panel({ title, level = 2, action, className, list, children }: { title: ReactNode; level?: 2 | 3; action?: ReactNode; className?: string; list?: boolean; children: ReactNode }) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={cx("card", list && "panel--list", className)} aria-labelledby={id}>
      <div className="card__head">
        <Heading id={id} className="panel__title">
          {title}
        </Heading>
        {action}
      </div>
      {list ? <div className="panel__body">{children}</div> : children}
    </section>
  );
}

/**
 * The month control, in the top bar beside the title (MAZ-221). Its look follows the cards:
 *
 * - phones (`iphone-home`, `iphone-insights`): a glass month pill that opens the system month list;
 * - touch tablets (`ipad-home`): Previous and Next glass buttons around that pill;
 * - desktop (`web-home`, `web-insights`): a bordered segmented control with the chevrons inside.
 *   The cards have no This month link (MAZ-224): the month list and the chevrons reach it.
 *
 * `actions` go at the end of the phone row (Home's calendar and settings buttons).
 */
export function MonthBar({ month, onChange, actions }: { month: string; onChange: (month: string | undefined) => void; actions?: ReactNode }) {
  const slot = useTopbarSlot();
  const bar = (
    <>
      <MonthBarControls month={month} onChange={onChange} />
      {actions ? <div className="topbar__actions">{actions}</div> : null}
    </>
  );
  return slot ? createPortal(bar, slot) : <div className="month-bar__inline">{bar}</div>;
}

/** Months the pill offers: two years back to a year ahead, plus the one shown if it's outside. */
function pickableMonths(month: string, now: string): string[] {
  const months: string[] = [];
  for (let delta = 12; delta >= -24; delta -= 1) months.push(shiftMonth(now, delta));
  if (!months.includes(month)) months.push(month);
  return months.sort().reverse();
}

export function MonthBarControls({ month, onChange }: { month: string; onChange: (month: string | undefined) => void }) {
  const now = currentMonth();
  const id = useId();
  const label = monthLabel(month);
  // The pill names the month alone in the current year, as on the iPhone cards ("November").
  const short = month.slice(0, 4) === now.slice(0, 4) ? label.split(" ")[0] : label;
  return (
    <div className="month-bar">
      <div className="month-nav">
        <Button
          iconOnly
          icon="chevron-back"
          variant="quiet"
          className="month-nav__step"
          aria-label="Previous month"
          disabled={month <= "2000-01"}
          onClick={() => {
            onChange(shiftMonth(month, -1));
          }}
        />
        <span className="month-nav__label" aria-live="polite">
          {label}
        </span>
        <label className="month-pill glass" htmlFor={id}>
          <span className="month-pill__text month-pill__text--short" aria-hidden="true">
            {short}
          </span>
          <span className="month-pill__text month-pill__text--long" aria-hidden="true">
            {label}
          </span>
          <Icon name="chevron-down" size={16} />
          <select
            id={id}
            className="month-pill__select"
            aria-label="Month"
            value={month}
            onChange={(event) => {
              const next = event.currentTarget.value;
              onChange(next === now ? undefined : next);
            }}
          >
            {pickableMonths(month, now).map((value) => (
              <option key={value} value={value}>
                {monthLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <Button
          iconOnly
          icon="chevron-forward"
          variant="quiet"
          className="month-nav__step"
          aria-label="Next month"
          disabled={month >= "2100-12"}
          onClick={() => {
            onChange(shiftMonth(month, 1));
          }}
        />
      </div>
    </div>
  );
}

const TONE = { expense: "expense", income: "income", investment: "investment" } as const;

/**
 * Entries of the month: personal ones open their detail, shared ones open the expense in its
 * household, and scheduled occurrences are labelled "Scheduled" (amber) and open nothing, so a
 * preview never looks like a recorded entry. Income dated after today is labelled "Expected"
 * (amber, MAZ-136) and still opens: it is a ledger entry that counts toward Projected only.
 */
export function EntryRows({ entries, ledger, currency, onOpen }: { entries: readonly OverviewEntry[]; ledger: Ledger; currency: string | undefined; onOpen: (entry: Transaction, opener: HTMLElement) => void }) {
  const categories = new Map(ledger.categories.map((category) => [category.id, category]));
  const accounts = new Map(ledger.accounts.map((account) => [account.id, account.name]));
  const today = useToday();
  return (
    <ul className="results home-rows">
      {entries.map((entry) => {
        const category = categories.get(entry.categoryId);
        const shared = isSharedEntry(entry) ? entry : null;
        const account = !shared && entry.accountId ? accounts.get(entry.accountId) : undefined;
        // MAZ-136: income dated after today is expected (amber, "Expected"), but still opens as an entry.
        const expected = isExpectedIncome(entry, today);
        const meta = [
          entry.scheduled ? null : shared ? (shared.householdName ? `Shared · ${shared.householdName}` : "Shared") : null,
          category?.name,
          account,
        ].filter(Boolean);
        const body = (
          <>
            <span className={expected ? "category-dot category-dot--expected" : "category-dot"} style={tileStyle({ ...category, entryKind: entry.kind })}>
              <Icon name={categoryIcon(category?.icon)} size={18} />
            </span>
            <span className="results__title">{entry.title}</span>
            <span className="results__meta">
              {entry.scheduled || expected ? (
                <Badge tone="pending" icon="time">
                  {expected ? "Expected" : "Scheduled"}
                </Badge>
              ) : null}{" "}
              {meta.length ? `${meta.join(" · ")} · ` : ""}
              <time dateTime={entry.date}>{dayLabel(entry.date)}</time>
            </span>
            <span className="results__amount">
              {/* MAZ-202: recorded rows read as the cards do (expenses −, income +); expected and scheduled stay unsigned. */}
              {entry.scheduled || expected ? (
                <Money cents={entry.share} currency={currency} tone="pending" />
              ) : (
                <Money {...rowAmount(entry.kind, entry.share)} currency={currency} tone={TONE[entry.kind]} />
              )}
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
 * Desktop Home's By category (`web-home`), whose rows only show the month (MAZ-224).
 */
export function CategoryBreakdown({ spending, currency }: { spending: Parameters<typeof groupSmall>[0]; currency: string | undefined }) {
  const { rows, total } = groupSmall(spending);
  return (
    <Panel title="By category" className="breakdown" action={<span className="muted">Your share</span>}>
      {rows.length ? (
        <>
          <ol className="breakdown__list">
            {rows.map((row) => {
              const percent = percentOf(row.amount, total);
              const content = (
                <>
                  <span className="category-dot" style={tileStyle(row)}>
                    <Icon name={categoryIcon(row.icon)} size={18} />
                  </span>
                  <span className="breakdown__name">{row.name}</span>
                  <span className="breakdown__amount">
                    {/* MAZ-222: web-home shows the amount alone; the share stays for screen readers. */}
                    <Money cents={row.amount} currency={currency} />
                    <span className="visually-hidden">, {percent}% of spending</span>
                  </span>
                  <span className="breakdown__track" aria-hidden="true">
                    <span className="breakdown__fill" style={{ width: `${String((row.amount / Math.max(1, total)) * 100)}%`, background: categoryTint(row) }} />
                  </span>
                </>
              );
              return (
                <li key={row.id} className="breakdown__row">
                  {content}
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
