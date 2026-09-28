import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { saveReceipt } from "../../data/receipts";
import {
  cents,
  kinds,
  kindLabels,
  dateKey,
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
import { ReceiptPreview } from "../receipts/ReceiptPreview";
import { DateField } from "../../shared/ui/DateField";
import { buildEntry, buildSchedule } from "./entryDraft";
import { AccountForm } from "../accounts/AccountForm";
import type { LedgerChange } from "../../domain/commands";
import { EntryPillPicker } from "./EntryPillPicker";
import type { Household } from "../../data/households";

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
  onHousehold,
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
  onSave: (entry: Transaction, rule?: Recurring) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  households?: Household[];
  onHousehold?: (householdId: string) => void;
}) {
  const initial = rule ?? entry;
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "expense");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(
    initial ? (initial.total / 100).toFixed(2) : "",
  );
  const [date, setDate] = useState(rule?.nextDate ?? entry?.date ?? dateKey());
  const [categoryId, setCategory] = useState(initial?.categoryId ?? "food");
  const [accountId, setAccountId] = useState(initial?.accountId);
  const [tripId, setTripId] = useState(entry?.tripId ?? initialTripId);
  const [openPicker, setOpenPicker] = useState<"category" | "trip" | "account" | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [note, setNote] = useState(initial?.note ?? "");
  const [split, setSplit] = useState<"full" | "equal" | "amount" | "percent">(
    initial && initial.share !== initial.total ? "amount" : "full",
  );
  const [shareInput, setShareInput] = useState(
    initial ? (initial.share / 100).toFixed(2) : "2",
  );
  const [frequency, setFrequency] = useState<Frequency | "none">(rule?.frequency ?? "none");
  const [viewingReceipt, setViewingReceipt] = useState<Receipt>();
  const [receipt, setReceipt] = useState<Receipt | undefined>(entry?.receipt);
  const [attachment, setAttachment] = useState<{
    uri: string;
    name: string;
    mime: string;
  }>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  let preview = "—";
  try {
    preview = new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(
      personalShare(
        cents(amount),
        kind === "expense" ? split : "full",
        shareInput,
      ) / 100,
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
      if (accountId && !accounts.some((a) => a.id === accountId)) throw new Error("Choose an available payment account.");
      if (kind === "expense" && !rule && tripId && !trips.some((trip) => trip.id === tripId)) throw new Error("Choose an available trip.");
      const draft = { kind, title, amount, date, categoryId, accountId, tripId: rule ? undefined : tripId, note, split, shareInput, frequency, receipt };
      const { transaction, recurring }: { transaction: Transaction; recurring?: Recurring } = rule
        ? { transaction: rule, recurring: buildSchedule(draft, categories, rule) }
        : buildEntry(draft, categories, entry);
      setSaving(true);
      setError("");
      if (kind === "expense" && attachment) transaction.receipt = await saveReceipt(attachment);
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
  if (addingAccount && commit) return <AccountForm commit={commit} onSaved={(account) => setAccountId(account.id)} onClose={() => setAddingAccount(false)} />;
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
      title={rule ? "Edit recurring entry" : entry ? "Edit entry" : "A little update."}
      headerActions={<>
        <DateField label={rule ? "Next occurrence" : "Date"} value={date} onChange={setDate} pill iconOnly />
        <EntryPillPicker label="Category" value={categoryId} iconOnly align="center"
          options={categories.filter((c) => c.kind === kind).map((c) => ({ id: c.id, label: c.name, icon: c.icon, color: c.color }))}
          open={openPicker === "category"} onToggle={() => setOpenPicker(openPicker === "category" ? null : "category")}
          onSelect={(id) => { setCategory(id); setOpenPicker(null); }} />
        {kind === "expense" && !rule && <EntryPillPicker label="Trip" value={tripId ?? ""} iconOnly align="right"
          options={[{ id: "", label: "No trip" }, ...trips.map((trip) => ({ id: trip.id, label: trip.name, accessibilityLabel: `Assign to ${trip.name}` }))]}
          emptyMessage={!trips.length ? "Create a trip in Trips to organize travel expenses." : undefined}
          open={openPicker === "trip"} onToggle={() => setOpenPicker(openPicker === "trip" ? null : "trip")}
          onSelect={(id) => { setTripId(id || undefined); setOpenPicker(null); }} />}
        <EntryPillPicker label="Account" value={accountId ?? ""} iconOnly align="right"
          options={[{ id: "", label: "Unassigned" }, ...accounts.map((account) => ({
            id: account.id, label: account.name, icon: accountTypeIcons[account.type], accessibilityLabel: `Use ${account.name}`,
          }))]}
          open={openPicker === "account"} onToggle={() => setOpenPicker(openPicker === "account" ? null : "account")}
          onSelect={(id) => { setAccountId(id || undefined); setOpenPicker(null); }}
          footerAction={commit ? { label: "Add account", onPress: () => { setOpenPicker(null); setAddingAccount(true); } } : undefined} />
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
            title={saving ? "Saving…" : initial ? "Save changes" : `Add ${kind}`}
            icon="checkmark"
            disabled={saving}
            onPress={submit}
          />
        </>
      }
    >
      <View
        style={{ gap: 22, position: "relative", opacity: saving ? 0.6 : 1, pointerEvents: saving ? "none" : "auto" }}
      >
        {openPicker && <Pressable accessibilityRole="button" accessibilityLabel="Close selection"
          onPress={() => setOpenPicker(null)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 }} />}
        <View
          style={[
            s.row,
            { backgroundColor: C.bg, padding: 5, borderRadius: 13 },
          ]}
        >
          {kinds.map((k) => (
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
                backgroundColor: kind === k ? "#fff" : "transparent",
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
        </View>
        {kind === "investment" && (
          <Text style={{ color: C.muted, fontSize: 12 }}>
            Record money you contribute to investments. This reduces cash remaining without counting as spending or tracking portfolio value.
          </Text>
        )}
        {kind === "expense" && !initial && !!households.length && onHousehold && <View style={{ gap: 8 }}>
          <Text style={s.label}>Add to a household instead</Text>
          <View style={[s.row, { flexWrap: "wrap" }]}>{households.map((household) => <Button key={household.id} title={household.name} tone="quiet" icon="people-outline" onPress={() => onHousehold(household.id)} />)}</View>
          <Text style={s.muted}>Household expenses are split among members and appear in your personal reports.</Text>
        </View>}
        <Field
          label={`Amount (${currency})`}
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
          autoFocus={!initial && Platform.OS === "web"}
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
        {kind === "expense" && (
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
        {kind === "expense" && !rule && (
          <View style={{ gap: 10 }}>
            <Text style={s.label}>Receipt</Text>
            {receipt || attachment ? (
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
                    {attachment?.name ?? receipt?.name}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove receipt"
                    onPress={() => {
                      setReceipt(undefined);
                      setAttachment(undefined);
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
                <Text style={s.muted}>
                  Photos or PDFs, up to 10 MB. Saved with this expense.
                </Text>
              </>
            )}
          </View>
        )}
        {(!entry || rule) && (
          <View style={{ gap: 10 }}>
            <Text style={s.label}>Repeat</Text>
            <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
              {(["none", "weekly", "monthly", "yearly"] as const).filter((f) => !rule || f !== "none").map((f) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: frequency === f }}
                  key={f}
                  style={[s.chip, frequency === f && s.chipActive]}
                  onPress={() => setFrequency(f)}
                >
                  <Text style={{ fontSize: 12, color: C.ink }}>
                    {f === "none"
                      ? "Just once"
                      : f[0].toUpperCase() + f.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {frequency !== "none" && (
              <Text style={s.muted}>
                {rule ? "Changes apply to future occurrences. Recorded entries keep their original details." : "Due entries are added automatically when you open the app."}
                {!rule && kind === "expense" ? " Receipts apply to this entry only." : ""}
              </Text>
            )}
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
        {entry &&
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
                    await onDelete(entry.id);
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
