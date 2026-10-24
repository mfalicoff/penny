import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { receiptUrl, saveReceipt } from "../../data/receipts";
import { calculateHouseholdSplits } from "../../domain/households";
import {
  cents,
  kinds,
  kindLabels,
  dateKey,
  validDate,
  personalShare,
  accountTypeIcons,
  type PaymentAccount,
  type Category,
  type Frequency,
  type Kind,
  type Receipt,
  type Recurring,
  type Transaction,
  type Trip,
} from "../../domain/ledger";
import { Button, C, Field, Icon, Sheet, s } from "../../shared/ui";
import { useResponsive } from "../../shared/useResponsive";
import { ReceiptPreview } from "../receipts/ReceiptPreview";
import { DateField } from "../../shared/ui/DateField";
import { buildEntry, buildSchedule } from "./entryDraft";
import { AccountForm } from "../accounts/AccountForm";
import { CategoryForm } from "../categories/CategoryForm";
import type { LedgerChange } from "../../domain/commands";
import { createExpense, createRecurring, deleteExpense, deleteRecurring, getHousehold, updateExpense, updateRecurring,
  type ExpenseInput, type Household, type HouseholdExpense, type HouseholdMember, type HouseholdRecurring } from "../../data/households";
import { EntryPillMenu, EntryPillPicker, type PillMenuPosition, type PillOption } from "./EntryPillPicker";

const sharedCategoryId = "__household_original_category__";

function originalAllocations(expense?: HouseholdExpense): Record<string, string> {
  if (!expense) return {};
  let assigned = 0;
  return Object.fromEntries(expense.splits.map((part, index) => {
    if (expense.splitMode !== "percent") return [part.userId, (part.amountCents / 100).toFixed(2)];
    const basisPoints = index === expense.splits.length - 1 ? 10000 - assigned
      : Math.round(part.amountCents / expense.totalCents * 10000);
    assigned += basisPoints;
    return [part.userId, (basisPoints / 100).toFixed(2)];
  }));
}

export function EntryForm({
  categories,
  accounts = [],
  trips = [],
  initialTripId,
  commit,
  entry,
  rule,
  currency,
  onClose,
  onSave,
  onDelete,
  demo = false,
  households = [],
  userEmail,
  initialHousehold,
  initialMembers = [],
  householdExpense,
  householdRule,
  onHouseholdSaved,
  onHouseholdFeedback,
}: {
  demo?: boolean;
  categories: Category[];
  accounts?: PaymentAccount[];
  trips?: Trip[];
  initialTripId?: string;
  commit?: (change: LedgerChange, message: string) => Promise<void>;
  entry?: Transaction;
  rule?: Recurring;
  currency: string;
  onClose: () => void;
  onSave?: (entry: Transaction, rule?: Recurring) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  households?: Household[];
  userEmail?: string | null;
  initialHousehold?: Household;
  initialMembers?: HouseholdMember[];
  householdExpense?: HouseholdExpense;
  householdRule?: HouseholdRecurring;
  onHouseholdSaved?: () => Promise<void> | void;
  onHouseholdFeedback?: (message: string, kind?: Kind) => void;
}) {
  const { compact } = useResponsive();
  const initial = rule ?? entry;
  const sharedInitial = householdExpense ?? householdRule;
  const editing = Boolean(initial || sharedInitial);
  const [kind, setKind] = useState<Kind>(sharedInitial ? "expense" : initial?.kind ?? "expense");
  const [title, setTitle] = useState(initial?.title ?? sharedInitial?.title ?? "");
  const [amount, setAmount] = useState(
    initial ? (initial.total / 100).toFixed(2) : sharedInitial ? (sharedInitial.totalCents / 100).toFixed(2) : "",
  );
  const [date, setDate] = useState(rule?.nextDate ?? entry?.date ?? householdRule?.nextDate ?? householdExpense?.date ?? dateKey());
  const [categoryId, setCategory] = useState(initial?.categoryId ?? categories.find((item) => item.kind === "expense" && item.name === sharedInitial?.category.name)?.id ?? (sharedInitial ? sharedCategoryId : "food"));
  const [accountId, setAccountId] = useState(initial?.accountId ?? sharedInitial?.accountId);
  const [tripId, setTripId] = useState(entry?.tripId ?? initialTripId);
  const [householdId, setHouseholdId] = useState(initialHousehold?.id ?? "");
  const [members, setMembers] = useState<HouseholdMember[]>(initialMembers);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const selectionRequest = useRef(0);
  const [payerUserId, setPayerUserId] = useState(sharedInitial?.payerUserId ?? initialMembers.find((member) => member.email === userEmail && !member.leftAt)?.userId ?? "");
  const [householdSplit, setHouseholdSplit] = useState<ExpenseInput["splitMode"]>(sharedInitial?.splitMode ?? "equal");
  const [allocations, setAllocations] = useState<Record<string, string>>(() => originalAllocations(householdExpense));
  const [ruleActive, setRuleActive] = useState(householdRule?.active ?? true);
  const [openPicker, setOpenPicker] = useState<"category" | "trip" | "account" | null>(null);
  const [menuPosition, setMenuPosition] = useState<PillMenuPosition | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [note, setNote] = useState(initial?.note ?? sharedInitial?.note ?? "");
  const [split, setSplit] = useState<"full" | "equal" | "amount" | "percent">(
    initial && initial.share !== initial.total ? "amount" : "full",
  );
  const [shareInput, setShareInput] = useState(
    initial ? (initial.share / 100).toFixed(2) : "2",
  );
  const [frequency, setFrequency] = useState<Frequency | "none">(rule?.frequency ?? householdRule?.frequency ?? "none");
  const [viewingReceipt, setViewingReceipt] = useState<Receipt>();
  const [receipt, setReceipt] = useState<Receipt | undefined>(entry?.receipt ?? householdExpense?.receipt);
  const [retainedReceiptId, setRetainedReceiptId] = useState(sharedInitial?.receiptId);
  const [attachment, setAttachment] = useState<{
    uri: string;
    name: string;
    mime: string;
  }>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedHousehold = initialHousehold?.id === householdId ? initialHousehold : households.find((item) => item.id === householdId);
  const activeMembers = members.filter((member) => selectedHousehold?.trip ? !member.leftAt
    : (member.joinedOn ?? dateKey(new Date(member.joinedAt))) <= date &&
      (!member.leftAt || new Date(member.leftAt).toISOString().slice(0, 10) > date));
  const selfId = members.find((member) => member.email === userEmail)?.userId;
  const sharedCurrency = selectedHousehold?.currency ?? currency;
  async function selectHousehold(id: string) {
    if (id === householdId) return;
    const request = ++selectionRequest.current;
    setHouseholdId(id);
    setMembers([]);
    setPayerUserId("");
    setAllocations({});
    setHouseholdSplit("equal");
    setError("");
    if (!id) {
      if (sharedInitial) setCategory(categories.find((item) => item.kind === "expense" && item.name === sharedInitial.category.name)?.id
        ?? categories.find((item) => item.kind === "expense")?.id ?? "");
      setSplit("full");
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);
    try {
      const details = await getHousehold(id);
      if (selectionRequest.current !== request) return;
      setMembers(details.members);
      setPayerUserId(details.members.find((member) => member.email === userEmail && !member.leftAt)?.userId ?? details.members.find((member) => !member.leftAt)?.userId ?? "");
      setTripId(undefined);
    } catch (failure) {
      if (selectionRequest.current !== request) return;
      setError(failure instanceof Error ? failure.message : "Could not load household members.");
      setHouseholdId("");
    } finally { if (selectionRequest.current === request) setLoadingMembers(false); }
  }
  let preview = "—";
  try {
    preview = new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: sharedCurrency,
    }).format(
      householdId && selfId
        ? (householdSplit === "equal" ? calculateHouseholdSplits(cents(amount), { mode: "equal", memberIds: activeMembers.map((member) => member.userId) }).find((part) => part.userId === selfId)?.amountCents ?? 0
          : householdSplit === "exact" ? cents(allocations[selfId] || "0")
            : Math.round(cents(amount) * cents(allocations[selfId] || "0") / 10000)) / 100
        : personalShare(cents(amount), kind === "expense" ? split : "full", shareInput) / 100,
    );
  } catch { }
  const switchKind = (value: Kind) => {
    setKind(value);
    setCategory(categories.find((c) => c.kind === value)?.id ?? "");
    setSplit("full");
    setOpenPicker(null);
  };
  function attach(uri: string, name: string, mime: string, size?: number) {
    if (size && size > 10 * 1024 * 1024)
      throw new Error("Choose a receipt smaller than 10 MB.");
    if (!mime.startsWith("image/") && mime !== "application/pdf")
      throw new Error("Choose a photo or PDF receipt.");
    setAttachment({ uri, name, mime });
    setReceipt(undefined);
    setError("");
  }
  async function pickFile() {
    if (demo) {
      setError("Sign in to attach receipts to your own entries.");
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/*", "application/pdf"],
        copyToCacheDirectory: true,
        base64: true,
      });
      if (!result.canceled) {
        const a = result.assets[0];
        attach(
          a.uri,
          a.name,
          a.mimeType ||
          (/\.pdf$/i.test(a.name) ? "application/pdf" : "image/jpeg"),
          a.size,
        );
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not attach this receipt.",
      );
    }
  }
  async function pickPhoto() {
    if (demo) {
      setError("Sign in to attach receipts to your own entries.");
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });
      if (!result.canceled) {
        const a = result.assets[0];
        attach(
          a.uri,
          a.fileName ?? "Receipt.jpg",
          a.mimeType ?? "image/jpeg",
          a.fileSize,
        );
      }
    } catch {
      setError("Could not open your photos. Please try the file picker.");
    }
  }
  async function submit() {
    if (saving) return;
    try {
      if (householdId) {
        if (!selectedHousehold || loadingMembers || !activeMembers.length) throw new Error("Wait for household members to load.");
        const totalCents = cents(amount);
        if (!title.trim()) throw new Error("Enter what this expense was for.");
        if (totalCents <= 0) throw new Error("Enter an amount greater than zero.");
        if (!validDate(date)) throw new Error("Enter a valid date.");
        if (!activeMembers.some((member) => member.userId === payerUserId)) throw new Error("Choose an active payer.");
        const category = categories.find((item) => item.id === categoryId && item.kind === "expense")
          ?? (categoryId === sharedCategoryId ? sharedInitial?.category : undefined);
        if (!category) throw new Error("Choose a category.");
        if (accountId && payerUserId === selfId && !accounts.some((item) => item.id === accountId)) throw new Error("Choose an available payment account.");
        if (frequency !== "none" && householdSplit !== "equal") throw new Error("Recurring household expenses must be split equally.");
        let parts: ExpenseInput["allocations"];
        if (householdSplit === "exact") {
          parts = activeMembers.map((member) => ({ userId: member.userId, amountCents: cents(allocations[member.userId] || "0") }));
          if (parts.reduce((sum, item) => sum + ("amountCents" in item ? item.amountCents : 0), 0) !== totalCents)
            throw new Error("Member amounts must add up to the expense total.");
        } else if (householdSplit === "percent") {
          parts = activeMembers.map((member) => ({ userId: member.userId, percentBasisPoints: cents(allocations[member.userId] || "0") }));
          if (parts.reduce((sum, item) => sum + ("percentBasisPoints" in item ? item.percentBasisPoints : 0), 0) !== 10000)
            throw new Error("Member percentages must add up to 100%.");
        }
        setSaving(true);
        setError("");
        const savedReceipt = attachment ? await saveReceipt(attachment) : undefined;
        const input: ExpenseInput = {
          title: title.trim(), totalCents, date, payerUserId, splitMode: householdSplit,
          allocations: parts, category: { name: category.name, icon: category.icon, color: category.color },
          note: note.trim(), accountId: payerUserId === selfId ? accountId : undefined,
          receiptId: savedReceipt?.id ?? receipt?.id ?? retainedReceiptId,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        };
        if (entry && !onDelete) throw new Error("This expense cannot be moved here.");
        if (householdRule) await updateRecurring(householdId, householdRule.id, householdRule.revision,
          { ...input, nextDate: date, frequency: frequency === "none" ? householdRule.frequency : frequency, active: ruleActive });
        else if (householdExpense) await updateExpense(householdExpense.householdId, householdExpense.id, householdExpense.revision, input,
          householdId !== householdExpense.householdId ? householdId : undefined);
        else if (frequency !== "none") await createRecurring(householdId, { ...input, nextDate: date, frequency });
        else {
          const created = await createExpense(householdId, input);
          if (entry) {
            try { await onDelete!(entry.id); }
            catch (failure) {
              try { await deleteExpense(householdId, created.expense.id, created.expense.revision); }
              catch { throw new Error("The household copy was saved, but the original could not be removed. Review both entries."); }
              throw failure;
            }
          }
        }
        await onHouseholdSaved?.();
        onClose();
        onHouseholdFeedback?.(
          householdRule ? "Schedule updated" : householdExpense || entry ? "Changes saved" : frequency !== "none" ? "Schedule added" : "Expense added",
          householdRule || householdExpense || entry || frequency !== "none" ? undefined : "expense",
        );
        return;
      }
      if (accountId && !accounts.some((a) => a.id === accountId)) throw new Error("Choose an available payment account.");
      if (kind === "expense" && !rule && tripId && !trips.some((trip) => trip.id === tripId)) throw new Error("Choose an available trip.");
      const draft = { kind, title, amount, date, categoryId, accountId, tripId: rule ? undefined : tripId, note, split, shareInput, frequency, receipt };
      const { transaction, recurring }: { transaction: Transaction; recurring?: Recurring } = rule
        ? { transaction: rule, recurring: buildSchedule(draft, categories, rule) }
        : buildEntry(draft, categories, entry);
      setSaving(true);
      setError("");
      if (householdExpense) {
        if (!onSave || !onDelete) throw new Error("This expense cannot be moved here.");
        transaction.receipt = attachment ? await saveReceipt(attachment)
          : receipt ? await saveReceipt({ uri: await receiptUrl(receipt), name: receipt.name, mime: receipt.mime }) : undefined;
        await onSave(transaction);
        try { await deleteExpense(householdExpense.householdId, householdExpense.id, householdExpense.revision); }
        catch (failure) {
          try { await onDelete(transaction.id); }
          catch { throw new Error("The personal copy was saved, but the household expense could not be removed. Review both entries."); }
          throw failure;
        }
        await onHouseholdSaved?.();
        onClose();
        return;
      }
      if (kind === "expense" && attachment) transaction.receipt = await saveReceipt(attachment);
      if (!onSave) throw new Error("This entry cannot be saved here.");
      await onSave(transaction, recurring);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your entry is still here; please try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  const categoryOptions: PillOption[] = categories.filter((c) => c.kind === kind).map((c) => ({ id: c.id, label: c.name, icon: c.icon, color: c.color }));
  if (kind === "expense" && sharedInitial && !categories.some((item) => item.kind === "expense" && item.name === sharedInitial.category.name))
    categoryOptions.push({ id: sharedCategoryId, label: sharedInitial.category.name, icon: sharedInitial.category.icon, color: sharedInitial.category.color });
  const tripOptions: PillOption[] = [{ id: "", label: "No trip" }, ...trips.map((trip) => ({ id: trip.id, label: trip.name, accessibilityLabel: `Assign to ${trip.name}` }))];
  const accountOptions: PillOption[] = [{ id: "", label: "Unassigned" }, ...accounts.map((account) => ({
    id: account.id, label: account.name, icon: accountTypeIcons[account.type], accessibilityLabel: `Use ${account.name}`,
  }))];
  const pickerOptions = openPicker === "category" ? categoryOptions : openPicker === "trip" ? tripOptions : accountOptions;
  const pickerValue = openPicker === "category" ? categoryId : openPicker === "trip" ? tripId ?? "" : accountId ?? "";
  const tripEmptyMessage = !trips.length ? "Create a trip in Trips to organize travel expenses." : undefined;
  const accountFooter = commit ? { label: "Add account", onPress: () => { setOpenPicker(null); setAddingAccount(true); } } : undefined;
  const categoryFooter = commit ? { label: "Add category", onPress: () => { setOpenPicker(null); setAddingCategory(true); } } : undefined;
  const togglePicker = (picker: "category" | "trip" | "account") => {
    setMenuPosition(null);
    setOpenPicker(openPicker === picker ? null : picker);
  };
  const selectPickerOption = (id: string) => {
    if (openPicker === "category") setCategory(id);
    if (openPicker === "trip") setTripId(id || undefined);
    if (openPicker === "account") setAccountId(id || undefined);
    setOpenPicker(null);
  };
  if (addingAccount && commit) return <AccountForm commit={commit} onSaved={(account) => setAccountId(account.id)} onClose={() => setAddingAccount(false)} />;
  if (addingCategory && commit) return <CategoryForm initialKind={kind} commit={commit}
    onSaved={(category) => setCategory(category.id)} onClose={() => setAddingCategory(false)} />;
  if (viewingReceipt)
    return (
      <Sheet
        visible
        title={viewingReceipt.name}
        wide
        onClose={() => setViewingReceipt(undefined)}
      >
        <ReceiptPreview receipt={viewingReceipt} />
        <Button
          title="Back to entry"
          tone="quiet"
          onPress={() => setViewingReceipt(undefined)}
        />
      </Sheet>
    );
  return (
    <Sheet
      visible
      title={rule || householdRule ? "Edit recurring entry" : entry || householdExpense ? "Edit entry" : compact && householdId ? "Add expense" : "A little update."}
      overlay={openPicker && <EntryPillMenu label={openPicker === "category" ? "Category" : openPicker === "trip" ? "Trip" : "Account"}
        value={pickerValue} options={pickerOptions} position={menuPosition}
        onClose={() => setOpenPicker(null)} onSelect={selectPickerOption}
        emptyMessage={openPicker === "trip" ? tripEmptyMessage : undefined}
        footerAction={openPicker === "account" ? accountFooter : openPicker === "category" ? categoryFooter : undefined} />}
      headerActions={<>
        <DateField label={rule ? "Next occurrence" : "Date"} value={date} onChange={setDate} pill iconOnly />
        <EntryPillPicker label="Category" value={categoryId} iconOnly align="center"
          options={categoryOptions} open={openPicker === "category"} onToggle={() => togglePicker("category")}
          onPosition={setMenuPosition} hasFooterAction={Boolean(categoryFooter)} />
        {kind === "expense" && !rule && !householdId && <EntryPillPicker label="Trip" value={tripId ?? ""} iconOnly align="right"
          options={tripOptions} emptyMessage={tripEmptyMessage}
          open={openPicker === "trip"} onToggle={() => togglePicker("trip")}
          onPosition={setMenuPosition} />}
        {(!householdId || payerUserId === selfId) && <EntryPillPicker label="Account" value={accountId ?? ""} iconOnly align="right"
          options={accountOptions} open={openPicker === "account"} onToggle={() => togglePicker("account")}
          onPosition={setMenuPosition} hasFooterAction={Boolean(accountFooter)} />}
      </>}
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
          <Button
            title={saving ? "Saving…" : editing ? "Save changes" : `Add ${kind}`}
            icon="checkmark"
            disabled={saving}
            onPress={submit}
          />
        </>
      }
    >
      <View
        style={{ gap: compact ? 16 : 22, opacity: saving ? 0.6 : 1, pointerEvents: saving ? "none" : "auto" }}
      >
        {(!compact || !householdId) && <View
          style={[
            s.row,
            { backgroundColor: C.bg, padding: 5, borderRadius: 13 },
          ]}
        >
          {kinds.filter((k) => !householdId || k === "expense").map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={kindLabels[k]}
              accessibilityState={{ selected: kind === k }}
              onPress={() => switchKind(k)}
              style={{
                flex: 1,
                paddingVertical: 12,
                paddingHorizontal: 4,
                alignItems: "center",
                borderRadius: 9,
                backgroundColor: kind === k ? C.paper : "transparent",
              }}
            >
              <Text
                style={{
                  color: kind === k ? C.ink : C.muted,
                  fontWeight: "600",
                }}
              >
                {kindLabels[k]}
              </Text>
            </Pressable>
          ))}
        </View>}
        {kind === "investment" && (
          <Text style={{ color: C.muted, fontSize: 12 }}>
            Record money you contribute to investments. This reduces cash remaining without counting as spending or tracking portfolio value.
          </Text>
        )}
        {kind === "expense" && !rule && !householdRule && (households.length > 0 || !!initialHousehold) && <View style={{ gap: 8 }}>
          <Text style={s.label}>Expense for</Text>
          <View style={[s.row, { flexWrap: "wrap" }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: !householdId }}
              onPress={() => void selectHousehold("")} style={[s.chip, !householdId && s.chipActive]}><Text style={s.label}>Personal</Text></Pressable>
            {(initialHousehold && !households.some((item) => item.id === initialHousehold.id) ? [initialHousehold, ...households] : households)
              .filter((household) => household.currency === currency).map((household) =>
              <Pressable key={household.id} accessibilityRole="button" accessibilityLabel={`Expense for ${household.name}`}
                accessibilityState={{ selected: householdId === household.id }}
                onPress={() => void selectHousehold(household.id)} style={[s.chip, householdId === household.id && s.chipActive]}>
                <Text style={s.label}>{household.trip ? `Trip · ${household.name}` : household.name}</Text>
              </Pressable>)}
          </View>
          {loadingMembers && <Text style={s.muted}>Loading household members…</Text>}
        </View>}
        <Field
          label={`Amount (${sharedCurrency})`}
          placeholder="0.00"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          style={{
            fontSize: 36,
            height: 76,
            fontWeight: "500",
            letterSpacing: -1,
          }}
          autoFocus={!editing && Platform.OS === "web"}
        />
        <Field
          label={
            kind === "investment" ? "Where are you investing?" : kind === "expense" ? "What was it for?" : "Where did it come from?"
          }
          placeholder={
            kind === "expense"
              ? "Coffee, groceries, a good evening…"
              : kind === "investment" ? "TFSA, retirement, brokerage…" : "Salary, a project, a gift…"
          }
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />
        {kind === "expense" && !householdId && (
          <View
            style={{
              gap: 12,
              borderTopWidth: 1,
              borderColor: C.line,
              paddingTop: 20,
            }}
          >
            <View style={s.between}>
              <View style={s.row}>
                <Icon name="people-outline" size={18} />
                <Text style={s.label}>Your part of the receipt</Text>
              </View>
              <Text style={{ color: C.accent, fontWeight: "600" }}>
                {preview}
              </Text>
            </View>
            <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
              {(
                [
                  ["full", "All mine"],
                  ["equal", "Split equally"],
                  ["amount", "My amount"],
                  ["percent", "Percentage"],
                ] as const
              ).map(([mode, label]) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: split === mode }}
                  key={mode}
                  style={[s.chip, split === mode && s.chipActive]}
                  onPress={() => {
                    setSplit(mode);
                    setShareInput(
                      mode === "equal" ? "2" : mode === "percent" ? "50" : "",
                    );
                  }}
                >
                  <Text style={{ fontSize: 12, color: C.ink }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {split !== "full" && (
              <>
                <Field
                  label={
                    split === "equal"
                      ? "Number of people (including you)"
                      : split === "amount"
                        ? `Your amount (${currency})`
                        : "Your percentage (%)"
                  }
                  value={shareInput}
                  onChangeText={setShareInput}
                  keyboardType="decimal-pad"
                />
                <Text style={s.muted}>
                  Only your share counts toward your spending.
                </Text>
              </>
            )}
          </View>
        )}
        {kind === "expense" && !!householdId && (!compact || activeMembers.length !== 1 || editing) && <View style={{ gap: 12, borderTopWidth: 1, borderColor: C.line, paddingTop: 20 }}>
          <View style={s.between}><View style={s.row}><Icon name="people-outline" size={18} /><Text style={s.label}>Your part of the receipt</Text></View>
            <Text style={{ color: C.accent, fontWeight: "600" }}>{preview}</Text></View>
          <Text style={s.label}>Paid by</Text>
          <View style={[s.row, { flexWrap: "wrap", gap: 6 }]}>{activeMembers.map((member) =>
            <Pressable key={member.userId} accessibilityRole="button" accessibilityState={{ selected: payerUserId === member.userId }}
              onPress={() => setPayerUserId(member.userId)} style={[s.chip, payerUserId === member.userId && s.chipActive]}>
              <Text style={s.label}>{member.email === userEmail ? "You" : member.email}</Text>
            </Pressable>)}</View>
          {!activeMembers.length && <Text style={s.muted}>No household members are active on this date.</Text>}
          <Text style={s.label}>Split among members</Text>
          <View style={[s.row, { flexWrap: "wrap", gap: 6 }]}>
            {([ ["equal", "Equally"], ["exact", "Exact amounts"], ["percent", "Percentages"] ] as const)
              .filter(([mode]) => frequency === "none" || mode === "equal").map(([mode, label]) =>
                <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: householdSplit === mode }}
                  onPress={() => { setHouseholdSplit(mode); if (mode !== householdSplit) setAllocations({}); }}
                  style={[s.chip, householdSplit === mode && s.chipActive]}><Text style={s.label}>{label}</Text></Pressable>)}</View>
          {householdSplit === "equal" ? !compact && <Text style={s.muted}>Every active member owes an equal share, including the payer.</Text>
            : activeMembers.map((member) => <Field key={member.userId}
              label={`${member.email === userEmail ? "You" : member.email} (${householdSplit === "percent" ? "%" : sharedCurrency})`}
              value={allocations[member.userId] ?? ""}
              onChangeText={(value) => setAllocations((current) => ({ ...current, [member.userId]: value }))}
              placeholder="0" keyboardType="decimal-pad" />)}
        </View>}
        {kind === "expense" && !rule && !householdRule && (
          <View style={{ gap: 10 }}>
            <Text style={s.label}>Receipt</Text>
            {receipt || attachment || retainedReceiptId ? (
              <View
                style={[
                  s.card,
                  { padding: 14, gap: 10, backgroundColor: C.bg },
                ]}
              >
                <View style={s.row}>
                  <Icon name="document-attach-outline" color={C.accent} />
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, color: C.ink, fontSize: 13 }}
                  >
                    {attachment?.name ?? receipt?.name ?? "Receipt attached"}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove receipt"
                    onPress={() => {
                      setReceipt(undefined);
                      setAttachment(undefined);
                      setRetainedReceiptId(undefined);
                    }}
                  >
                    <Icon name="close-circle-outline" />
                  </Pressable>
                </View>
                {attachment?.mime.startsWith("image/") && (
                  <Image
                    source={{ uri: attachment.uri }}
                    style={{ width: "100%", height: 160, borderRadius: 8 }}
                    resizeMode="contain"
                  />
                )}
                {receipt && (
                  <Button
                    title="View receipt"
                    tone="quiet"
                    onPress={() => setViewingReceipt(receipt)}
                  />
                )}
              </View>
            ) : (
              <>
                <View style={s.row}>
                  <Button
                    title="Upload photo"
                    icon="image-outline"
                    tone="quiet"
                    onPress={pickPhoto}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Choose file"
                    icon="attach-outline"
                    tone="quiet"
                    onPress={pickFile}
                    style={{ flex: 1 }}
                  />
                </View>
                {!compact && <Text style={s.muted}>
                  Photos or PDFs, up to 10 MB. Saved with this expense.
                </Text>}
              </>
            )}
          </View>
        )}
        {(!entry && !householdExpense || rule || householdRule) && (
          <View style={{ gap: 10 }}>
            <Text style={s.label}>Repeat</Text>
            <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
              {(["none", "weekly", "monthly", "yearly"] as const).filter((f) => !(rule || householdRule) || f !== "none").map((f) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: frequency === f }}
                  key={f}
                  style={[s.chip, frequency === f && s.chipActive]}
                  onPress={() => { setFrequency(f); if (householdId && f !== "none") { setHouseholdSplit("equal"); setAllocations({}); } }}
                >
                  <Text style={{ fontSize: 12, color: C.ink }}>
                    {f === "none"
                      ? "Just once"
                      : f[0].toUpperCase() + f.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {frequency !== "none" && !compact && (
              <Text style={s.muted}>
                {rule || householdRule ? "Changes apply to future occurrences. Recorded entries keep their original details." : householdId ? "Each occurrence is split among members active on its date." : "Due entries are added automatically when you open the app."}
                {!rule && !householdRule && kind === "expense" ? " Receipts apply to this entry only." : ""}
              </Text>
            )}
            {householdRule && <Button title={ruleActive ? "Pause schedule" : "Resume schedule"} tone="quiet" onPress={() => setRuleActive(!ruleActive)} />}
          </View>
        )}
        {entry?.recurringId && (
          <Text style={s.muted}>
            Changes apply to this occurrence. Manage future entries in
            Recurring.
          </Text>
        )}
        <Field
          label="Note (optional)"
          placeholder="Anything you’d like to remember"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={1000}
        />
        {(entry || householdExpense || householdRule) &&
          (confirmDelete ? (
            <View style={{ gap: 10 }}>
              <Text style={s.muted}>
                Delete this entry? This cannot be undone.
              </Text>
              <Button
                title="Delete this entry"
                tone="danger"
                onPress={async () => {
                  setSaving(true);
                  try {
                    if (householdExpense && householdId) await deleteExpense(householdId, householdExpense.id, householdExpense.revision);
                    else if (householdRule && householdId) await deleteRecurring(householdId, householdRule.id, householdRule.revision);
                    else if (entry && onDelete) await onDelete(entry.id);
                    await onHouseholdSaved?.();
                    onClose();
                  } catch {
                    setError("Could not delete this entry. Please try again.");
                  } finally {
                    setSaving(false);
                  }
                }}
              />
              <Button
                title="Keep entry"
                tone="quiet"
                onPress={() => setConfirmDelete(false)}
              />
            </View>
          ) : (
            <Button
              title="Delete entry"
              tone="danger"
              onPress={() => setConfirmDelete(true)}
            />
          ))}
      </View>
    </Sheet>
  );
}
