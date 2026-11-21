import { useQuery } from "@tanstack/react-query";
import { householdDetailQuery, householdExpensesQuery, monthRecapQuery } from "../../api/households";
import { useAccountEmail } from "../../auth/account";
import { findMe, isCurrent } from "../households/model";
import { useLedgerWorkspace } from "../organize/workspace";
import { privateExpenses, sharedTripTotals, tripMonth, type SharedTrip } from "./model";

/**
 * A shared trip's numbers for the trip list (cards `iphone-trips`, `web-trips`): its members, the
 * trip total, your share (your splits plus your private expenses from before sharing) and your
 * balance in the trip's month. Private expenses are in the ledger currency, so a trip in another
 * currency leaves them out rather than add up two currencies.
 */
export function useSharedTripNumbers(household: SharedTrip, { balance = false }: { balance?: boolean } = {}) {
  const email = useAccountEmail();
  const workspace = useLedgerWorkspace();
  const detail = useQuery(householdDetailQuery(email, household.id));
  const expenses = useQuery(householdExpensesQuery(email, household.id));
  const month = tripMonth(household.trip);
  const recap = useQuery({ ...monthRecapQuery(email, household.id, month), enabled: balance });
  const me = detail.data ? findMe(detail.data.members, email)?.userId : undefined;
  const mine = workspace.ledger?.currency === household.currency ? privateExpenses(workspace.ledger, household.id) : [];
  const totals = detail.data && expenses.data ? sharedTripTotals(expenses.data, me, mine, household.trip) : null;
  return {
    detail,
    expenses,
    me,
    mine,
    month,
    members: detail.data?.members.filter(isCurrent) ?? [],
    totals,
    balance: me ? recap.data?.balances.find((row) => row.userId === me)?.balanceCents : undefined,
    balanceLoading: balance && recap.isPending,
    failed: detail.isError || expenses.isError,
  };
}
