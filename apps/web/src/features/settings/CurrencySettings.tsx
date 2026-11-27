import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { ApiError } from "../../api/client";
import { changeCurrency, CURRENCIES, currencyLock, ledgerQuery, setLedgerSnapshot, type Currency } from "../../api/ledger";
import { invalidateSearch } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { currencyInfo } from "@domain/currency.ts";
import type { Transaction } from "@domain/ledger.ts";
import { isOffline, lastKnownRates, ratesQuery } from "../../api/rates";
import { useLedgerSync } from "../../offline/OfflineLedgerProvider";
import { useToday } from "../../app/useToday";
import { currencyUses, displayRate, usedText, weekdayDate } from "../entries/currency";
import { DEFAULT_SOURCE } from "../entries/RateRow";
import { Card, ChoiceGroup, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { ErrorState, LoadingState, SaveErrorBanner, useToast } from "../../design/states";
import { SectionTitle } from "./SectionTitle";

function describeSaveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "Your ledger changed somewhere else, so Penny reloaded it. Check the currency and choose again.";
    if (error.status === 0) return "Penny can't reach the server.";
    return error.message;
  }
  return "Something went wrong.";
}

/**
 * Settings › Currency (specimen `currency`). One currency per account keeps totals consistent, so
 * it can change only while the ledger has no entries or recurring rules — the restriction is
 * stated, not hidden. Shared households keep their own currency. Each currency is named by its
 * ISO code alone (CAD, USD), as on the card.
 */
export function CurrencySettings() {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const ledger = useQuery(ledgerQuery(email));
  const noteId = useId();
  const sync = useLedgerSync();

  const save = useMutation({
    mutationKey: ["ledger", "currency"],
    mutationFn: async ({ currency }: { currency: Currency; previous: Currency }) => {
      const snapshot = ledger.data;
      if (!snapshot) throw new Error("The ledger isn't loaded yet.");
      return changeCurrency(snapshot, currency);
    },
    onSuccess: (snapshot, { currency, previous }) => {
      setLedgerSnapshot(queryClient, email, snapshot);
      void invalidateSearch(queryClient, email);
      toast.show({
        title: `Currency set to ${currency}`,
        onUndo: () => {
          save.mutate({ currency: previous, previous: currency });
        },
      });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void ledger.refetch();
    },
  });

  if (ledger.isPending) return <LoadingState label="Loading your currency…" />;
  if (ledger.isError) {
    return (
      <ErrorState
        title="Penny couldn't load your currency"
        onRetry={() => {
          void ledger.refetch();
        }}
        retrying={ledger.isFetching}
      >
        {ledger.error instanceof ApiError && ledger.error.status === 0 ? "Penny can't reach the server." : "Nothing was changed. Try again in a moment."}
      </ErrorState>
    );
  }

  const current = ledger.data.ledger.currency;
  const lock = currencyLock(ledger.data);
  const homeName = currencyInfo(current)?.name ?? current;
  // web-currency-rates: totals add up in the home currency, and each entry may be in any currency (MAZ-151).
  const note =
    lock === "open"
      ? "Choose your home currency before adding entries. Insights, Left to spend, budgets and recaps add up in it, and it stays fixed once you record something. Each entry can be in any currency."
      : lock === "locked"
        ? `Insights, Left to spend, budgets and recaps add up in ${pluralName(homeName)}. Your home currency is locked once your ledger has entries. Each entry can be in any currency.`
        : "Penny couldn't confirm that your ledger is empty, so the currency can't change from the browser right now.";
  // This browser's ledger (pending changes included) when there is one, else the server's copy.
  const transactions = sync?.ledger?.transactions ?? (ledger.data.ledger.transactions ?? []).filter(isEntry);
  const uses = currencyUses({ transactions });

  // A conflict can't be retried as-is: the ledger was reloaded and the user chooses again.
  const retry =
    save.isError && !(save.error instanceof ApiError && save.error.status === 409)
      ? {
          onRetry: () => {
            save.mutate(save.variables);
          },
          retrying: save.isPending,
        }
      : {};

  return (
    <>
      <SectionTitle>Currency</SectionTitle>
      <Card title="Home currency" className={cx("currency-card", lock !== "open" && "currency-card--locked")}>
        {save.isError ? <SaveErrorBanner message={describeSaveError(save.error)} {...retry} /> : null}
        {lock === "locked" && !save.isPending ? (
          <div className="currency-home" role="group" aria-label="Ledger currency" aria-describedby={noteId}>
            <span className="currency-row">
              <span className="currency-row__code">{current}</span>
              <span className="currency-row__name">{homeName}</span>
              <Icon name="lock-closed" size={14} label="Locked" />
            </span>
          </div>
        ) : (
        <ChoiceGroup<Currency>
          legend={
            <>
              Ledger currency
              {lock !== "open" ? (
                <span className="currency-card__lock">
                  <Icon name="lock-closed" size={13} />
                </span>
              ) : null}
            </>
          }
          name="currency"
          appearance="list"
          value={save.isPending ? save.variables.currency : current}
          describedBy={noteId}
          onChange={(currency) => {
            if (currency !== current) save.mutate({ currency, previous: current });
          }}
          options={CURRENCIES.map((code) => ({
            value: code,
            label: code,
            disabled: save.isPending || (lock !== "open" && code !== current),
          }))}
        />
        )}
        <p id={noteId} className="setting-note currency-card__note">
          {lock !== "open" ? (
            <span className="currency-card__note-icon">
              <Icon name="lock-closed" size={16} />
            </span>
          ) : null}
          <span>
            {save.isPending ? <span role="status">Saving…</span> : null} {note}
          </span>
        </p>
      </Card>
      <ExchangeRates email={email} home={current} lastRates={uses.slice(0, 3).map((use) => `${use.code} ${displayRate(use.lastRate)}`)} />
      <Card title="Recent currencies" className="currency-card currency-recent">
        {uses.length ? (
          <ul className="currency-rows">
            {uses.map((use) => (
              <li key={use.code} className="currency-row">
                <span className="currency-row__code">{use.code}</span>
                <span className="currency-row__name">{currencyInfo(use.code)?.name ?? use.code}</span>
                <span className="currency-row__value">{usedText(use.count)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="setting-note">Entries you add in another currency show here, with how often you used it.</p>
        )}
      </Card>
    </>
  );
}

/** "Canadian dollars", "euros", "pounds sterling" for the home currencies' sentence. */
function pluralName(name: string): string {
  if (name === "Euro") return "euros";
  if (name === "Pound sterling") return "pounds sterling";
  return name.endsWith("dollar") ? `${name}s` : name;
}

const isEntry = (value: unknown): value is Transaction => typeof value === "object" && value !== null && "id" in value && "date" in value;

/**
 * Exchange rates (`web-currency-rates`, `web-currency-rates-off`): whether the server fetches the
 * European Central Bank's daily rates and the latest it has; with fetching off, the last rates
 * you used. Offline, the last answer this browser kept.
 */
function ExchangeRates({ email, home, lastRates }: { email: string; home: string; lastRates: string[] }) {
  const today = useToday();
  const rates = useQuery(ratesQuery(email, home, today));
  const answer = rates.data ?? (rates.isError && isOffline(rates.error) ? lastKnownRates(home) : null);
  const noteId = useId();
  let rows: { label: string; sub?: string; value: string }[];
  let note: string;
  if (answer && !answer.enabled) {
    rows = [
      { label: "Daily rates", sub: "Turned off on this server", value: "Off" },
      { label: "Your last rates", value: lastRates.length ? lastRates.join(" · ") : "None yet" },
    ];
    note = "Your server doesn't fetch exchange rates. When you add an entry in another currency, enter the rate you got; Penny suggests the last one you used for that currency.";
  } else if (answer) {
    rows = [
      { label: "Daily rates", sub: `${answer.source ?? DEFAULT_SOURCE} reference rates`, value: "On" },
      { label: "Latest rates", value: answer.latestDate ? weekdayDate(answer.latestDate) : "Not fetched yet" },
    ];
    note = "Each entry in another currency is converted at the rate for its date, and keeps it: later rates never change old totals. On weekends and holidays, the last business day's rate is used. Your server fetches the rates; turning them off is up to whoever runs it.";
  } else {
    rows = [{ label: "Daily rates", value: rates.isPending ? "Checking…" : "Unknown" }];
    note = rates.isPending ? "Checking which rates your server has." : "Penny couldn't ask your server about exchange rates. Entries in another currency ask you for a rate meanwhile.";
  }
  return (
    <Card title="Exchange rates" className="currency-card currency-rates">
      <dl className="currency-rows" aria-describedby={noteId}>
        {rows.map((row) => (
          <div key={row.label} className="currency-row">
            <dt className="currency-row__name">
              {row.label}
              {row.sub ? <span className="currency-row__sub">{row.sub}</span> : null}
            </dt>
            <dd className="currency-row__value pk-num">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p id={noteId} className="setting-note currency-card__note currency-card__note--box">
        <span className="currency-card__note-icon">
          <Icon name="cash" size={16} />
        </span>
        <span>{note}</span>
      </p>
    </Card>
  );
}
