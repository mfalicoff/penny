import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { saveAccount, type LedgerChange } from "../../domain/commands";
import { accountTypes, accountTypeIcons, accountTypeLabels, uid, type PaymentAccount } from "../../domain/ledger";
import { Button, C, Field, Icon, Sheet, s } from "../../shared/ui";

export function AccountForm({ account, used = false, commit, onClose, onSaved }: {
  account?: PaymentAccount;
  used?: boolean;
  commit: (change: LedgerChange, message: string) => Promise<void>;
  onClose: () => void;
  onSaved?: (account: PaymentAccount) => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState(account?.type ?? "bank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(remove = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const item = { id: account?.id ?? uid(), name: name.trim(), type };
      await commit(saveAccount(item, account, remove), remove ? "Account removed" : "Account saved");
      if (!remove) onSaved?.(item);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this account.");
    } finally {
      setBusy(false);
    }
  }
  return <Sheet visible title={account ? "Edit account" : "Add account"} onClose={() => { if (!busy) onClose(); }}>
    <View style={{ gap: 20, pointerEvents: busy ? "none" : "auto" }}>
      <Field label="Account name" placeholder="e.g. Main chequing, Visa, wallet" value={name} onChangeText={setName} maxLength={50} />
      <Text style={s.label}>Account type</Text>
      <View style={[s.row, { flexWrap: "wrap" }]}>
        {accountTypes.map((value) => <Pressable key={value} accessibilityRole="button"
          accessibilityLabel={accountTypeLabels[value]} aria-selected={type === value}
          onPress={() => setType(value)} style={[s.chip, { minHeight: 44 }, type === value && s.chipActive]}>
          <Icon name={accountTypeIcons[value]} size={18} />
          <Text style={{ color: C.ink }}>{accountTypeLabels[value]}</Text>
        </Pressable>)}
      </View>
      <Text style={s.muted}>Use this account to label where money comes from or how you pay. No bank connection is needed.</Text>
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      <Button title={busy ? "Saving…" : "Save account"} disabled={busy} onPress={() => save()} />
      {account && <>
        {used && <Text style={s.muted}>This account is linked to entries or schedules. Reassign them before deleting it.</Text>}
        <Button title={used ? "Account is in use" : "Delete unused account"} tone="danger" disabled={used || busy} onPress={() => save(true)} />
      </>}
    </View>
  </Sheet>;
}
