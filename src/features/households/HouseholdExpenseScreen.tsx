import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { getExpense, getHousehold, type Household, type HouseholdExpense, type HouseholdMember } from "../../data/households";
import { useHouseholds } from "../../providers/HouseholdProvider";
import { s } from "../../shared/ui";
import { HouseholdExpenseForm } from "./HouseholdExpenseForm";

export default function HouseholdExpenseScreen() {
  const params = useLocalSearchParams<{ id: string; expenseId: string }>();
  const householdId = String(params.id ?? "");
  const expenseId = String(params.expenseId ?? "");
  const { refresh } = useHouseholds();
  const [household, setHousehold] = useState<Household>();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [expense, setExpense] = useState<HouseholdExpense>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([getHousehold(householdId), getExpense(householdId, expenseId)])
      .then(([details, result]) => { if (active) { setHousehold(details.household); setMembers(details.members); setExpense(result.expense); } })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "Could not open expense."); });
    return () => { active = false; };
  }, [householdId, expenseId]);
  const close = () => router.replace(`/households/${householdId}`);
  return <View style={{ gap: 12 }}>
    {error ? <Text style={s.error}>{error}</Text> : null}
    {!household && !error ? <Text style={s.muted}>Opening expense…</Text> : null}
    {household && expense && <HouseholdExpenseForm household={household} members={members} expense={expense} onClose={close} onSaved={refresh} />}
  </View>;
}
