import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { accountTypeIcons, accountTypeLabels, type PaymentAccount } from "../../domain/ledger";
import { useLedger } from "../../providers/LedgerProvider";
import { Button, C, Icon, s } from "../../shared/ui";
import { useResponsive } from "../../shared/useResponsive";
import { AccountForm } from "./AccountForm";

export default function AccountsScreen() {
  const { ledger, commit } = useLedger();
  const { compact } = useResponsive();
  const [form, setForm] = useState<{ account?: PaymentAccount } | null>(null);
  const usage = useMemo(() => {
    const counts = new Map<string, { entries: number; schedules: number }>();
    for (const entry of ledger.transactions) {
      if (!entry.accountId) continue;
      const count = counts.get(entry.accountId) ?? { entries: 0, schedules: 0 };
      count.entries++;
      counts.set(entry.accountId, count);
    }
    for (const rule of ledger.recurring) {
      if (!rule.accountId) continue;
      const count = counts.get(rule.accountId) ?? { entries: 0, schedules: 0 };
      count.schedules++;
      counts.set(rule.accountId, count);
    }
    return counts;
  }, [ledger.transactions, ledger.recurring]);
  return <View style={{ gap: 20 }}>
    <Text style={s.muted}>Add your bank accounts, credit cards, and cash wallets, then choose one when recording an entry.</Text>
    <Button title="Add account" icon="add" onPress={() => setForm({})} />
    {!ledger.accounts.length && <View style={[s.card, { alignItems: "center", gap: 12 }]}>
      <Icon name="wallet-outline" color={C.green} size={32} />
      <Text style={s.heading}>Where your money lives.</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>Start with a bank account, a credit card, or the cash in your pocket.</Text>
    </View>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {ledger.accounts.map((account) => {
        const count = usage.get(account.id);
        return <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`Edit account ${account.name}`}
          onPress={() => setForm({ account })} style={[s.card, s.row, { width: compact ? "100%" : "48%", padding: 20 }]}>
          <Icon name={accountTypeIcons[account.type]} color={C.green} size={26} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={s.heading}>{account.name}</Text>
            <Text style={s.muted}>{accountTypeLabels[account.type]}</Text>
            <Text style={s.muted}>{count?.entries ?? 0} entries · {count?.schedules ?? 0} schedules</Text>
          </View>
          <Icon name="create-outline" color={C.muted} size={18} />
        </Pressable>;
      })}
    </View>
    {form && <AccountForm account={form.account} used={!!form.account && usage.has(form.account.id)} commit={commit} onClose={() => setForm(null)} />}
  </View>;
}
