import { currencyInfo } from "@domain/currency.ts";
import { validDate } from "@domain/ledger.ts";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { isOffline, lastKnownRates, ratesQuery } from "../../api/rates";
import { useAccountEmail } from "../../auth/account";
import { cx } from "../../design/controls";
import { Icon, RefreshIcon, SwapIcon } from "../../design/Icon";
import { useOnline } from "../../design/states";
import { displayRate, rateLine, resolveRate, shortDate, weekdayDate, weekdayName, type AutoRate, type ManualReason, type RateLookup } from "./currency";

/** The European Central Bank, as the cards name the source when an entry's own rate doesn't say. */
export const DEFAULT_SOURCE = "European Central Bank";

/**
 * The rate for an entry in `code` on `date`, in `home` (`GET /api/rates`). Offline, or when the
 * server can't be reached, the last rates this browser kept, provisionally. `enabled: false` asks
 * nothing (a home-currency entry).
 */
export function useRateLookup(home: string, code: string, date: string, enabled: boolean): RateLookup {
  const email = useAccountEmail();
  const online = useOnline();
  const query = useQuery({ ...ratesQuery(email, home, date), enabled: enabled && validDate(date) });
  if (!enabled) return { state: "loading" };
  const offline = !query.data && (!online || (query.isError && isOffline(query.error)));
  return resolveRate(code, { answer: query.data, offline, failed: query.isError, cached: offline ? lastKnownRates(home) : null });
}

/**
 * Keeps the last rate the lookup found while a new one is on its way (a new date or currency), so
 * the row shows it dimmed instead of a spinner (`docs/design/motion.md`, the rate refreshes).
 */
export function useShownRate(lookup: RateLookup): { rate: AutoRate | null; refreshing: boolean } {
  const [shown, setShown] = useState<AutoRate | null>(null);
  const found = lookup.state === "rate" ? lookup.rate : null;
  if (found && JSON.stringify(found) !== JSON.stringify(shown)) setShown(found);
  if (lookup.state === "manual" && shown) setShown(null);
  return { rate: found ?? (lookup.state === "loading" ? shown : null), refreshing: lookup.state === "loading" && shown !== null };
}

export type RateMode =
  /** A looked-up (or the entry's own) published or provisional rate. */
  | { mode: "auto"; rate: AutoRate; refreshing: boolean }
  /** The person changed the rate; `published` is what the source has for the date, when known. */
  | { mode: "edited"; published: AutoRate | null }
  /** No rate to look up: the person enters one. */
  | { mode: "manual"; reason: ManualReason }
  | { mode: "loading" };

interface RateRowProps {
  id: string;
  code: string;
  home: string;
  state: RateMode;
  /** What the person typed (edited or manual), or null. */
  input: string | null;
  onInput: (value: string | null) => void;
  /** Turns the looked-up rate into an editable one (the row's Edit). */
  onEdit: () => void;
  invalid?: Record<string, unknown>;
  error?: ReactNode;
}

/**
 * The Rate row (`web-add-entry-currency`, `web-entry-rate-provisional`, `web-entry-rate-edited`,
 * `web-entry-rate-manual`): "1 EUR = 1.4612 CAD" over "European Central Bank · Nov 3 · Edit"; with a
 * Provisional tag and the source's date when the date's rate isn't published yet; inline "1 EUR =
 * [1.4900] CAD" with an Edited tag and "European Central Bank: 1.4612 · Use it" once changed; and,
 * with no rate to look up, the field to enter one.
 */
export function RateRow({ id, code, home, state, input, onInput, onEdit, invalid, error }: RateRowProps) {
  const field = (
    <span className="entry-rate__field pk-num">
      <span>1 {code} =</span>
      <input
        id={id}
        className="entry-rate__input"
        inputMode="decimal"
        autoComplete="off"
        aria-label={`Exchange rate: ${home} for 1 ${code}`}
        value={input ?? ""}
        onChange={(event) => {
          onInput(event.currentTarget.value);
        }}
        {...invalid}
      />
      <span>{home}</span>
    </span>
  );
  if (state.mode === "edited") {
    return (
      <div className="entry-row entry-rate entry-rate--edited">
        <SwapIcon />
        <label htmlFor={id} className="entry-row__label">
          Rate
        </label>
        <span className="entry-rate__tag entry-rate__tag--edited">
          <Icon name="create" size={10} weight={60} />
          Edited
        </span>
        <span className="entry-row__value">{field}</span>
        {state.published ? (
          <span className="entry-rate__sub">
            <span className="pk-num">
              {state.published.source ?? DEFAULT_SOURCE}: {displayRate(state.published.rate)}
            </span>
            <button
              type="button"
              className="entry-rate__link"
              onClick={() => {
                onInput(null);
              }}
            >
              <RefreshIcon />
              Use it
            </button>
          </span>
        ) : null}
        {error}
      </div>
    );
  }
  if (state.mode === "manual") {
    return (
      <div className="entry-row entry-rate entry-rate--manual">
        <SwapIcon />
        <label htmlFor={id} className="entry-row__label">
          Rate
        </label>
        <span className="entry-row__value">{field}</span>
        {error}
      </div>
    );
  }
  if (state.mode === "loading") {
    return (
      <div className="entry-row entry-rate entry-rate--refreshing" aria-busy="true">
        <SwapIcon />
        <span className="entry-row__label">Rate</span>
        <span className="entry-row__value">
          <span className="entry-rate__lines">
            <b className="pk-num">1 {code} = … {home}</b>
            <small>Looking up the rate…</small>
          </span>
        </span>
      </div>
    );
  }
  const { rate, refreshing } = state;
  const provisional = rate.status === "provisional";
  return (
    <div className={cx("entry-row entry-rate", refreshing && "entry-rate--refreshing")} aria-busy={refreshing || undefined}>
      <SwapIcon />
      <span className="entry-row__label">Rate</span>
      <span className="entry-row__value">
        <span className="entry-rate__lines">
          <b className="pk-num">{rateLine(code, rate.rate, home)}</b>
          <small>
            {provisional ? (
              <>
                <span className="entry-rate__tag entry-rate__tag--provisional">
                  <Icon name="time" size={10} weight={60} />
                  Provisional
                </span>
                {weekdayDate(rate.rateDate)}
              </>
            ) : (
              `${rate.source ?? DEFAULT_SOURCE} · ${shortDate(rate.rateDate)}`
            )}
            {" · "}
            <button type="button" className="entry-rate__link" aria-label={`Edit the rate, ${rateLine(code, rate.rate, home)}`} onClick={onEdit}>
              Edit
            </button>
          </small>
        </span>
      </span>
    </div>
  );
}

/** The note under the rows for a provisional rate or a rate to enter, or null. */
export function RateNote({ state, code, date, today, lastRate, onUseLast }: { state: RateMode; code: string; date: string; today: string; lastRate: string | null; onUseLast: (rate: string) => void }) {
  if (state.mode === "auto" && state.rate.status === "provisional") {
    const { rate } = state;
    const text =
      rate.reason === "offline"
        ? `You're offline, so Penny uses the last rate it has, from ${weekdayDate(rate.rateDate)}. It's updated on the next sync, unless you change it.`
        : `${date === today ? "Today's" : `The ${shortDate(date)}`} rate isn't out yet, so Penny uses ${weekdayName(rate.rateDate)}'s. It's updated on the next sync, unless you change it.`;
    return (
      <p className="entry-rate-note" role="status">
        <Icon name="time" size={14} />
        <span>{text}</span>
      </p>
    );
  }
  if (state.mode !== "manual") return null;
  const name = currencyInfo(code)?.name ?? code;
  const lead =
    state.reason === "off"
      ? "Your server doesn't fetch exchange rates."
      : state.reason === "missing"
        ? `${DEFAULT_SOURCE} rates don't include the ${name}.`
        : "Penny couldn't get a rate from your server.";
  return (
    <p className="entry-rate-note entry-rate-note--manual" role="status">
      <Icon name="server" size={14} />
      <span>
        {lead} Enter the rate you got
        {lastRate ? (
          <>
            , or{" "}
            <button
              type="button"
              className="entry-rate__link"
              onClick={() => {
                onUseLast(displayRate(lastRate));
              }}
            >
              use your last one ({displayRate(lastRate)})
            </button>
          </>
        ) : null}
        .
      </span>
    </p>
  );
}
