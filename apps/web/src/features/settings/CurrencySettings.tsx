import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { ApiError } from "../../api/client";
import { changeCurrency, CURRENCIES, currencyLock, ledgerQuery, setLedgerSnapshot, type Currency } from "../../api/ledger";
import { invalidateSearch } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { Card, ChoiceGroup } from "../../design/controls";
import { ErrorState, LoadingState, SaveErrorBanner, useToast } from "../../design/states";

const NAMES: Record<Currency, string> = {
  CAD: "Canadian dollar",
  USD: "US dollar",
  EUR: "Euro",
  GBP: "British pound",
};

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
 * stated, not hidden. Shared households keep their own currency.
 */
export function CurrencySettings() {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const toast = useToast();
  const ledger = useQuery(ledgerQuery(email));
  const noteId = useId();

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
        detail: NAMES[currency],
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
  const note =
    lock === "open"
      ? "Choose your currency before adding entries. Once you record something it stays fixed, so your totals always add up."
      : lock === "locked"
        ? `Your ledger already has entries in ${current}, so the currency can't change. One currency per account keeps your totals consistent.`
        : "Penny couldn't confirm that your ledger is empty, so the currency can't change from the browser right now.";

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
    <Card title="Currency">
      {save.isError ? <SaveErrorBanner message={describeSaveError(save.error)} {...retry} /> : null}
      <ChoiceGroup<Currency>
        legend="Ledger currency"
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
          description: NAMES[code],
          disabled: save.isPending || (lock !== "open" && code !== current),
        }))}
      />
      <p id={noteId} className="setting-note">
        {save.isPending ? <span role="status">Saving…</span> : null} {note} Shared households keep their own currency.
      </p>
    </Card>
  );
}
