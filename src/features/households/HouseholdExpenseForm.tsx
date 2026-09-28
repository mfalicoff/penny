import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { createExpense, deleteExpense, updateExpense, createRecurring, updateRecurring, deleteRecurring,
  type ExpenseInput, type Household, type HouseholdExpense, type HouseholdMember, type HouseholdRecurring } from "../../data/households";
import { saveReceipt } from "../../data/receipts";
import { cents, dateKey, validDate } from "../../domain/ledger";
import { useLedger } from "../../providers/LedgerProvider";
import { Button, Field, Sheet, s } from "../../shared/ui";
import { DateField } from "../../shared/ui/DateField";

export function HouseholdExpenseForm({ household, members, expense, rule, onClose, onSaved }: {
  household: Household; members: HouseholdMember[]; expense?: HouseholdExpense; rule?: HouseholdRecurring;
  onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const { ledger, email } = useLedger();
  const eligible = (at: string) => members.filter((member) => new Date(member.joinedAt).toISOString().slice(0, 10) <= at && (!member.leftAt || new Date(member.leftAt).toISOString().slice(0, 10) > at));
  const initial = expense ?? rule;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(initial ? (initial.totalCents / 100).toFixed(2) : "");
  const [date, setDate] = useState(expense?.date ?? rule?.nextDate ?? dateKey());
  const [payerUserId, setPayer] = useState(initial?.payerUserId ?? members.find((member) => member.email === email && !member.leftAt)?.userId ?? members.find((member) => !member.leftAt)?.userId ?? "");
  const [splitMode, setSplitMode] = useState<ExpenseInput["splitMode"]>(initial?.splitMode ?? "equal");
  const [allocations, setAllocations] = useState<Record<string, string>>(() => Object.fromEntries((expense?.splits ?? []).map((split) => [split.userId, (split.amountCents / 100).toFixed(2)])));
  const [categoryId, setCategoryId] = useState(() => ledger.categories.find((category) => category.kind === "expense" && category.name === initial?.category.name)?.id ?? (initial ? "" : "food"));
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [receiptId, setReceiptId] = useState(initial?.receiptId ?? "");
  const [frequency, setFrequency] = useState<"none" | HouseholdRecurring["frequency"]>(rule?.frequency ?? "none");
  const [ruleActive, setRuleActive] = useState(rule?.active ?? true);
  const [attachment, setAttachment] = useState<{ uri: string; name: string; mime: string }>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = eligible(date);
  const selfId = members.find((member) => member.email === email)?.userId;
  const isPayer = selfId === payerUserId;
  const category = ledger.categories.find((item) => item.id === categoryId && item.kind === "expense") ?? initial?.category;

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], copyToCacheDirectory: true });
      if (!result.canceled) {
        const file = result.assets[0];
        if (file.size && file.size > 10 * 1024 * 1024) throw new Error("Choose a receipt smaller than 10 MB.");
        setAttachment({ uri: file.uri, name: file.name, mime: file.mimeType ?? "application/pdf" });
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not attach receipt."); }
  }
  async function pickPhoto() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
      if (!result.canceled) {
        const file = result.assets[0];
        if (file.fileSize && file.fileSize > 10 * 1024 * 1024) throw new Error("Choose a receipt smaller than 10 MB.");
        setAttachment({ uri: file.uri, name: file.fileName ?? "Receipt.jpg", mime: file.mimeType ?? "image/jpeg" });
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not attach receipt."); }
  }
  async function submit() {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const totalCents = cents(amount);
      if (!title.trim()) throw new Error("Enter what this expense was for.");
      if (totalCents <= 0) throw new Error("Enter an amount greater than zero.");
      if (!validDate(date)) throw new Error("Enter a valid date.");
      if (!active.some((member) => member.userId === payerUserId)) throw new Error("Choose an active payer.");
      if (!category) throw new Error("Choose a category.");
      let parts: ExpenseInput["allocations"];
      if (splitMode === "exact") {
        parts = active.map((member) => ({ userId: member.userId, amountCents: cents(allocations[member.userId] || "0") }));
        if (parts.reduce((sum, item) => sum + ("amountCents" in item ? item.amountCents : 0), 0) !== totalCents)
          throw new Error("Member amounts must add up to the expense total.");
      } else if (splitMode === "percent") {
        parts = active.map((member) => ({ userId: member.userId, percentBasisPoints: cents(allocations[member.userId] || "0") }));
        if (parts.reduce((sum, item) => sum + ("percentBasisPoints" in item ? item.percentBasisPoints : 0), 0) !== 10000)
          throw new Error("Member percentages must add up to 100%. ");
      }
      const receipt = attachment ? await saveReceipt(attachment) : null;
      const input: ExpenseInput = {
        title: title.trim(), totalCents, date, payerUserId, splitMode,
        allocations: parts, category: { name: category.name, icon: category.icon, color: category.color },
        note: note.trim(), accountId: isPayer && accountId ? accountId : undefined,
        receiptId: receipt?.id ?? (receiptId || undefined),
      };
      if (rule) await updateRecurring(household.id, rule.id, rule.revision, { ...input, nextDate: date, frequency: frequency === "none" ? rule.frequency : frequency, active: ruleActive });
      else if (expense) await updateExpense(household.id, expense.id, expense.revision, input);
      else if (frequency !== "none") await createRecurring(household.id, { ...input, nextDate: date, frequency });
      else await createExpense(household.id, input);
      await onSaved(); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save expense."); }
    finally { setSaving(false); }
  }
  async function remove() {
    if ((!expense && !rule) || saving) return;
    setSaving(true); setError("");
    try { if (rule) await deleteRecurring(household.id, rule.id, rule.revision); else if (expense) await deleteExpense(household.id, expense.id, expense.revision); await onSaved(); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete expense."); }
    finally { setSaving(false); }
  }

  return <Sheet visible wide title={rule ? "Edit recurring household expense" : expense ? "Edit household expense" : "Add household expense"} onClose={onClose}
    footer={<>{error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      <Button title={saving ? "Saving…" : expense || rule ? "Save changes" : frequency === "none" ? "Add expense" : "Create schedule"} disabled={saving} onPress={() => void submit()} /></>}>
    <View style={{ gap: 20 }}>
      <Field label={`Amount (${household.currency})`} value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" />
      <Field label="What was it for?" value={title} onChangeText={setTitle} maxLength={100} placeholder="Groceries, rent, dinner…" />
      <DateField label="Date" value={date} onChange={setDate} />
      <View style={{ gap: 8 }}><Text style={s.label}>Category</Text><View style={[s.row, { flexWrap: "wrap" }]}>
        {!categoryId && initial?.category && <Text style={s.muted}>Shared category: {initial.category.name}</Text>}
        {ledger.categories.filter((item) => item.kind === "expense").map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: categoryId === item.id }}
          onPress={() => setCategoryId(item.id)} style={[s.chip, categoryId === item.id && s.chipActive]}><Text style={s.label}>{item.name}</Text></Pressable>)}
      </View></View>
      <View style={{ gap: 8 }}><Text style={s.label}>Paid by</Text><View style={[s.row, { flexWrap: "wrap" }]}>
        {active.map((member) => <Pressable key={member.userId} accessibilityRole="button" accessibilityState={{ selected: payerUserId === member.userId }}
          onPress={() => { setPayer(member.userId); setAccountId(""); }} style={[s.chip, payerUserId === member.userId && s.chipActive]}><Text style={s.label}>{member.email === email ? "You" : member.email}</Text></Pressable>)}
      </View></View>
      {isPayer && ledger.accounts.length > 0 && <View style={{ gap: 8 }}><Text style={s.label}>Your payment account (optional)</Text><View style={[s.row, { flexWrap: "wrap" }]}>
        <Pressable accessibilityRole="button" onPress={() => setAccountId("")} style={[s.chip, !accountId && s.chipActive]}><Text style={s.label}>No account</Text></Pressable>
        {ledger.accounts.map((account) => <Pressable key={account.id} accessibilityRole="button" accessibilityState={{ selected: accountId === account.id }} onPress={() => setAccountId(account.id)} style={[s.chip, accountId === account.id && s.chipActive]}><Text style={s.label}>{account.name}</Text></Pressable>)}
      </View></View>}
      <View style={{ gap: 8 }}><Text style={s.label}>Split between members</Text><View style={[s.row, { flexWrap: "wrap" }]}>
        {([ ["equal", "Equal"], ["exact", "Exact amounts"], ["percent", "Percentages"] ] as const).filter(([mode]) => frequency === "none" || mode === "equal").map(([mode, label]) => <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: splitMode === mode }} onPress={() => { setSplitMode(mode); if (mode !== splitMode) setAllocations({}); }} style={[s.chip, splitMode === mode && s.chipActive]}><Text style={s.label}>{label}</Text></Pressable>)}
      </View>
      {!expense && <View style={{ gap: 8 }}><Text style={s.label}>Repeat</Text><View style={[s.row, { flexWrap: "wrap" }]}>
        {([ ["none", "Just once"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"] ] as const).filter(([mode]) => !rule || mode !== "none").map(([mode, label]) => <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: frequency === mode }} onPress={() => { setFrequency(mode); if (mode !== "none") { setSplitMode("equal"); setAllocations({}); } }} style={[s.chip, frequency === mode && s.chipActive]}><Text style={s.label}>{label}</Text></Pressable>)}
      </View>{frequency !== "none" && <Text style={s.muted}>Each occurrence is recorded on its date and split among members active then.</Text>}
      {rule && <Button title={ruleActive ? "Pause schedule" : "Resume schedule"} tone="quiet" onPress={() => setRuleActive(!ruleActive)} />}</View>}
      {splitMode === "equal" ? <Text style={s.muted}>Every active member owes an equal share, including the payer.</Text> : active.map((member) => <Field key={member.userId} label={`${member.email === email ? "You" : member.email} (${splitMode === "percent" ? "%" : household.currency})`}
        value={allocations[member.userId] ?? ""} onChangeText={(value) => setAllocations((current) => ({ ...current, [member.userId]: value }))} placeholder="0" keyboardType="decimal-pad" />)}
      </View>
      <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={1000} multiline />
      <View style={{ gap: 8 }}><Text style={s.label}>Receipt</Text>
        {attachment ? <View style={{ gap: 8 }}><Text style={s.muted}>{attachment.name}</Text>{attachment.mime.startsWith("image/") && <Image source={{ uri: attachment.uri }} style={{ height: 140, width: "100%" }} resizeMode="contain" />}
          <Button title="Remove attachment" tone="quiet" onPress={() => setAttachment(undefined)} /></View>
          : receiptId ? <View style={s.row}><Text style={s.muted}>Receipt attached</Text><Button title="Remove" tone="quiet" onPress={() => setReceiptId("")} /></View>
            : <View style={[s.row, { flexWrap: "wrap" }]}><Button title="Upload photo" tone="quiet" onPress={() => void pickPhoto()} /><Button title="Choose file" tone="quiet" onPress={() => void pickFile()} /></View>}
      </View>
      {(expense || rule) && (confirmDelete ? <View style={{ gap: 8 }}><Text style={s.muted}>Delete this {rule ? "schedule" : "expense"} for everyone?</Text><Button title={rule ? "Delete schedule" : "Delete expense"} tone="danger" disabled={saving} onPress={() => void remove()} /><Button title="Keep it" tone="quiet" onPress={() => setConfirmDelete(false)} /></View>
        : <Button title={rule ? "Delete schedule" : "Delete expense"} tone="danger" onPress={() => setConfirmDelete(true)} />)}
    </View>
  </Sheet>;
}
