import { currencyInfo } from "@domain/currency.ts";
import { convertSigned } from "@domain/households.ts";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { ratesQuery } from "../../api/rates";
import type { HouseholdMember, MonthRecap, Transfer } from "../../api/schemas";
import { useAccountEmail } from "../../auth/account";
import { cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { formatMinor } from "../entries/currency";
import { isCurrent, localDate } from "./model";
import { currencyPlural } from "./sharedCurrency";

/**
 * Balances and suggested payments in one currency (MAZ-151 phase 2, cards `web-trip-currencies`,
 * `iphone-trip-balances-currency`). A household's (or shared trip's) balances are in its own
 * currency, each expense at its own date's rate. "Settle in" shows them in another currency at
 * today's rate (the shared `settleIn`), display only: Record paid still records the household's
 * amount. Under each balance, a member whose home currency differs sees it in theirs, at today's
 * rate. Today's rates come from `GET /api/rates` with each target currency as base.
 */
export interface SettleView {
  /** The household's own currency, the one balances are kept in. */
  currency: string;
  /** The viewer's home currency, which writes "$" for it and "US$" for another dollar. */
  home: string;
  /** Show the several-currencies layout: a member, or you, keeps another home currency. */
  multi: boolean;
  /** The currency shown ("Settle in EUR"). */
  code: string;
  options: string[];
  choose: (code: string) => void;
  /** Formats an amount in the household's currency, converted to `code` (null while today's rate loads). */
  shown: (cents: number, signed?: boolean) => string | null;
  /** A month's balances and suggestions in `code`; the suggestions keep the household-currency transfer to record. */
  convert: (recap: Pick<MonthRecap, "balances" | "suggestions">) => { balances: Map<string, number>; suggestions: { transfer: Transfer; cents: number }[] } | null;
  /** "≈ US$349.76": a member's balance in their own currency when it isn't the shown one, else null. */
  approx: (userId: string, cents: number) => string | null;
}


/** One rate per currency: `to` units per household unit, today ("1" for the household's own). */
function useTodayRates(email: string, from: string, targets: readonly string[], enabled: boolean) {
  const today = localDate();
  const others = targets.filter((code) => code !== from);
  const answers = useQueries({ queries: others.map((code) => ({ ...ratesQuery(email, code, today), enabled })) });
  const rates = new Map<string, string>([[from, "1"]]);
  others.forEach((code, index) => {
    const rate = answers[index]?.data?.rates[from];
    if (rate) rates.set(code, rate);
  });
  return rates;
}

export function useSettleIn({ currency, home, members, meId }: { currency: string; home: string | undefined; members: readonly HouseholdMember[]; meId: string | undefined }): SettleView {
  const email = useAccountEmail();
  const viewer = home ?? currency;
  const currencyOf = (member: HouseholdMember) => (member.userId === meId ? viewer : member.currency);
  const homes = members.filter(isCurrent).flatMap((member) => currencyOf(member) ?? []);
  const multi = Boolean(currency) && (viewer !== currency || homes.some((code) => code !== currency));
  const options = [...new Set([currency, ...homes])];
  const [chosen, setChosen] = useState<string | null>(null);
  const code = chosen && options.includes(chosen) ? chosen : currency;
  const rates = useTodayRates(email, currency, options, multi);
  const rate = rates.get(code) ?? null;
  const format = (cents: number, to: string, signed = false) => formatMinor(cents, to, viewer, { signed });

  return {
    currency,
    home: viewer,
    multi,
    code,
    options,
    choose: (next) => {
      setChosen(next === currency ? null : next);
    },
    shown: (cents, signed = false) => {
      if (code === currency) return format(cents, currency, signed);
      if (!rate) return null;
      return format(convertSigned(cents, currency, code, rate), code, signed);
    },
    convert: (recap) => {
      if (!rate) return null;
      const balances = new Map(recap.balances.map((row) => [row.userId, convertSigned(row.balanceCents, currency, code, rate)]));
      const suggestions = recap.suggestions.map((transfer) => ({ transfer, cents: convertSigned(transfer.amountCents, currency, code, rate) }));
      return { balances, suggestions };
    },
    approx: (userId, cents) => {
      const member = members.find((item) => item.userId === userId);
      const own = member ? currencyOf(member) : undefined;
      if (!own || own === code) return null;
      const ownRate = rates.get(own);
      if (!ownRate) return null;
      return `≈ ${format(convertSigned(cents, currency, own, ownRate), own)}`;
    },
  };
}

/** "Balances in euros". */
export const balancesTitle = (code: string) => `Balances in ${currencyPlural(code)}`;

/**
 * Under the suggested payments (`web-trip-currencies`): how the currencies work. `records`: the web
 * card adds that Penny only records payments.
 */
export function settleNote(settle: SettleView, records: boolean): string {
  const plural = currencyPlural(settle.currency);
  const lead = `Each expense counts in ${plural} at its own date's rate, so balances don't move later. Under a balance: that person's own currency, at today's rate.`;
  const shown = settle.code === settle.currency ? "" : ` Shown in ${currencyPlural(settle.code)} at today's rate; Record paid records ${plural}.`;
  return `${lead}${shown}${records ? " Penny records payments; it never moves money." : ""}`;
}

/**
 * "Settle in EUR ⌄": the currencies balances can be shown in, the household's first, then each
 * member's own. Escape closes it (focus back on the button), as does a click outside.
 */
export function SettleInMenu({ settle, className }: { settle: SettleView; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>("[aria-current='true'], .settle-menu__item")?.focus();
    function onPointer(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (settle.options.length < 2) return null;
  return (
    <div
      ref={root}
      className={cx("settle-menu", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button ref={button} type="button" className="settle-menu__button" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`Settle in ${settle.code}, ${currencyInfo(settle.code)?.name ?? settle.code}`} onClick={() => { setOpen((value) => !value); }}>
        Settle in {settle.code}
        <Icon name="chevron-down" size={13} weight={48} />
      </button>
      {open ? (
        <ul id={id} className="more-menu__list settle-menu__list" aria-label="Settle in">
          {settle.options.map((code) => (
            <li key={code}>
              <button
                type="button"
                className="more-menu__item settle-menu__item"
                aria-current={code === settle.code ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  settle.choose(code);
                  button.current?.focus();
                }}
              >
                <b>{code}</b>
                <span>{currencyInfo(code)?.name ?? code}</span>
                {code === settle.currency ? <span className="settle-menu__aside">balances</span> : null}
                {code === settle.code ? <Icon name="checkmark" size={14} weight={48} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
