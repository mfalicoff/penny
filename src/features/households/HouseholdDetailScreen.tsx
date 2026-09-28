import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { archiveHousehold, createInvite, getAudit, getHousehold, getMonth, leaveHousehold, listRecurring, reimburse, removeMember, renameHousehold,
  type AuditEvent, type Household, type HouseholdExpense, type HouseholdMember, type HouseholdRecurring, type MonthRecap, type Transfer } from "../../data/households";
import { dateKey, parseDate } from "../../domain/ledger";
import { useHouseholds } from "../../providers/HouseholdProvider";
import { useLedger } from "../../providers/LedgerProvider";
import { currencyFormat } from "../../shared/format";
import { Button, C, Field, Icon, Sheet, s } from "../../shared/ui";
import { shiftMonthKey } from "../overview/selectors";
import { ReceiptPreview } from "../receipts/ReceiptPreview";
import { HouseholdExpenseForm } from "./HouseholdExpenseForm";

function describeAudit(event: AuditEvent, memberName: (id: string) => string, money: (cents: number) => string): string[] {
  const before = event.before && typeof event.before === "object" ? event.before as Record<string, unknown> : {};
  const after = event.after && typeof event.after === "object" ? event.after as Record<string, unknown> : {};
  const labels: Record<string, string> = { name: "Name", title: "Title", totalCents: "Amount", amountCents: "Amount", date: "Date", month: "Month", payerUserId: "Payer", fromUserId: "From", toUserId: "To", splitMode: "Split method", category: "Category", note: "Note", splits: "Member shares", receiptId: "Receipt", accountId: "Payer’s account", active: "Status" };
  const format = (key: string, value: unknown): string => {
    if (value == null || value === "") return "None";
    if ((key === "totalCents" || key === "amountCents") && typeof value === "number") return money(value);
    if (["payerUserId", "fromUserId", "toUserId"].includes(key) && typeof value === "string") return memberName(value);
    if (key === "category" && typeof value === "object") return String((value as { name?: string }).name ?? "Other");
    if (key === "splits" && Array.isArray(value)) return value.map((part: { userId: string; amountCents: number }) => `${memberName(part.userId)} ${money(part.amountCents)}`).join(", ");
    if (key === "accountId") return value ? "Selected" : "None";
    if (key === "receiptId") return value ? "Attached" : "None";
    if (key === "active") return value ? "Active" : "Paused";
    return String(value);
  };
  return Object.keys(labels).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => `${labels[key]}: ${key in before ? `${format(key, before[key])} → ` : ""}${format(key, after[key])}`);
}

export default function HouseholdDetailScreen() {
  const params = useLocalSearchParams<{ id: string; month?: string; expenseId?: string; add?: string }>();
  const id = String(params.id ?? "");
  const { email } = useLedger();
  const { refresh: refreshHouseholds } = useHouseholds();
  const [month, setMonth] = useState(/^\d{4}-\d{2}$/.test(String(params.month ?? "")) ? String(params.month) : dateKey().slice(0, 7));
  const [household, setHousehold] = useState<Household>();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [recap, setRecap] = useState<MonthRecap>();
  const [rules, setRules] = useState<HouseholdRecurring[]>([]);
  const [form, setForm] = useState<HouseholdExpense | "new" | null>(params.add === "1" ? "new" : null);
  const [ruleForm, setRuleForm] = useState<HouseholdRecurring | null>(null);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [receipt, setReceipt] = useState<HouseholdExpense["receipt"]>();
  const [invite, setInvite] = useState<{ code: string; expiresAt: number }>();
  const [removeUserId, setRemoveUserId] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState<Transfer>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const openedDeepLink = useRef(params.add === "1");

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const [details, result, schedules] = await Promise.all([getHousehold(id), getMonth(id, month), listRecurring(id)]);
      setHousehold(details.household); setMembers(details.members); setRecap(result); setRules(schedules.rules); setError("");
      if (params.expenseId && !openedDeepLink.current) {
        const match = result.expenses.find((item) => item.id === params.expenseId);
        if (match) { openedDeepLink.current = true; setForm(match); }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load household."); }
  }, [id, month, params.expenseId]);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  const myId = members.find((member) => member.email === email && !member.leftAt)?.userId;
  const creator = household?.creatorId === myId;
  const name = (userId: string) => members.find((member) => member.userId === userId)?.email ?? "Former member";
  const money = (amount: number) => currencyFormat(amount, household?.currency ?? "CAD");
  const monthLabel = parseDate(`${month}-01`).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  async function act(operation: () => Promise<unknown>, after?: () => void) {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); after?.(); await refresh(); await refreshHouseholds(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not complete this action."); }
    finally { setBusy(false); }
  }
  async function showAudit(expenseId: string) {
    try { setAudit((await getAudit(id, expenseId)).events); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load changes."); }
  }

  return <View style={{ gap: 18 }}>
    <Pressable accessibilityRole="button" onPress={() => router.push("/households")} style={[s.row, { alignSelf: "flex-start", minHeight: 44 }]}>
      <Icon name="chevron-back" size={17} color={C.accent} /><Text style={{ color: C.accent }}>All households</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    {household && <>
      <View style={[s.card, { gap: 12 }]}><View style={[s.between, { flexWrap: "wrap" }]}>
        <View style={{ gap: 4 }}><Text style={s.heading}>{household.name}</Text><Text style={s.muted}>{household.currency} · {members.filter((member) => !member.leftAt).length} active members</Text></View>
        <Button title="Add expense" icon="add" disabled={!myId} onPress={() => setForm("new")} />
      </View></View>
      <View style={[s.card, { gap: 15 }]}><View style={s.between}>
        <Button title="Previous" tone="quiet" onPress={() => setMonth(shiftMonthKey(month, -1))} />
        <Text style={[s.heading, { textAlign: "center", flex: 1 }]}>{monthLabel}</Text>
        <Button title="Next" tone="quiet" onPress={() => setMonth(shiftMonthKey(month, 1))} />
      </View>
      {recap?.overdue && <Text style={s.error}>This month has an overdue reimbursement. It stays separate from other months.</Text>}
      {!!recap?.overdueMonths?.length && <View style={[s.row, { flexWrap: "wrap" }]}>
        <Text style={s.muted}>Unpaid older months:</Text>
        {recap.overdueMonths.map((value) => <Button key={value} title={value} tone="quiet" onPress={() => setMonth(value)} />)}
      </View>}
      <Text style={s.muted}>Every month stands on its own. Reimbursements appear here, outside your spending reports.</Text>
      </View>
      <View style={[s.card, { gap: 14 }]}><Text style={s.heading}>Monthly recap</Text>
        {recap?.balances?.map((balance) => <View key={balance.userId} style={s.between}><Text style={s.label}>{name(balance.userId)}</Text>
          <Text style={{ color: balance.balanceCents < 0 ? C.accent : C.green, fontWeight: "600" }}>
            {balance.balanceCents < 0 ? "Owes " : balance.balanceCents > 0 ? "Is owed " : "Settled · "}{money(Math.abs(balance.balanceCents))}
          </Text></View>)}
        {!recap?.balances?.length && <Text style={s.muted}>No balances this month.</Text>}
        <Text style={[s.label, { marginTop: 8 }]}>Suggested reimbursements</Text>
        {recap?.suggestions?.map((transfer, index) => <View key={`${transfer.fromUserId}:${transfer.toUserId}:${index}`} style={[s.between, { alignItems: "flex-start", flexWrap: "wrap" }]}>
          <Text style={[s.muted, { flex: 1 }]}>{name(transfer.fromUserId)} pays {name(transfer.toUserId)} {money(transfer.amountCents)}</Text>
          {(myId === transfer.fromUserId || myId === transfer.toUserId) && <Button title="Record paid" tone="quiet" onPress={() => setConfirmTransfer(transfer)} />}
        </View>)}
        {!recap?.suggestions?.length && <Text style={s.muted}>Nothing to reimburse.</Text>}
        {!!recap?.reimbursements?.length && <><Text style={[s.label, { marginTop: 8 }]}>Recorded reimbursements</Text>
          {recap.reimbursements.map((item) => <Text key={item.id} style={s.muted}>{name(item.fromUserId)} paid {name(item.toUserId)} {money(item.amountCents)}</Text>)}
        </>}
      </View>
      <View style={[s.card, { gap: 12 }]}><Text style={s.heading}>Expenses in {monthLabel}</Text>
        {recap?.expenses?.map((expense) => <View key={expense.id} style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: 12, gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${expense.title}`} onPress={() => setForm(expense)} style={[s.between, { minHeight: 44 }]}>
            <View style={{ flex: 1, gap: 4 }}><Text style={s.label}>{expense.title}</Text><Text style={s.muted}>{expense.date} · Paid by {name(expense.payerUserId)} · {expense.category.name}</Text></View>
            <Text style={s.label}>{money(expense.totalCents)}</Text><Icon name="chevron-forward" size={16} />
          </Pressable>
          <Text style={s.muted}>{expense.splits.map((split) => `${name(split.userId)} ${money(split.amountCents)}`).join(" · ")}</Text>
          <View style={[s.row, { flexWrap: "wrap" }]}><Button title="Change history" tone="quiet" onPress={() => void showAudit(expense.id)} />
            {expense.receipt && <Button title="View receipt" tone="quiet" onPress={() => setReceipt(expense.receipt)} />}</View>
        </View>)}
        {!recap?.expenses?.length && <Text style={s.muted}>No household expenses this month.</Text>}
      </View>
      <View style={[s.card, { gap: 12 }]}><Text style={s.heading}>Recurring household expenses</Text>
        {rules.map((rule) => <Pressable key={rule.id} accessibilityRole="button" accessibilityLabel={`Edit recurring ${rule.title}`} onPress={() => setRuleForm(rule)} style={[s.between, { minHeight: 48, borderTopWidth: 1, borderColor: C.line }]}>
          <View style={{ flex: 1, gap: 4 }}><Text style={s.label}>{rule.title}</Text><Text style={s.muted}>{rule.frequency} · next {rule.nextDate} · {rule.active ? "Active" : "Paused"}</Text></View>
          <Text style={s.label}>{money(rule.totalCents)}</Text><Icon name="chevron-forward" size={16} />
        </Pressable>)}
        {!rules.length && <Text style={s.muted}>No recurring household expenses yet. Choose Repeat when adding an expense.</Text>}
      </View>
      <View style={[s.card, { gap: 12 }]}><Text style={s.heading}>Members</Text>
        {members.filter((member) => !member.leftAt).map((member) => <View key={member.userId} style={s.between}><View style={{ flex: 1 }}><Text style={s.label}>{member.email === email ? "You" : member.email}</Text>
          {member.userId === household.creatorId && <Text style={s.muted}>Creator</Text>}</View>
          {creator && member.userId !== myId && <Button title="Remove" tone="quiet" onPress={() => setRemoveUserId(member.userId)} />}</View>)}
        {creator && <Button title="Invite member" icon="person-add-outline" tone="quiet" onPress={() => void act(async () => setInvite(await createInvite(id)))} />}
        {creator && <Button title="Rename household" tone="quiet" onPress={() => { setNewName(household.name); setRenaming(true); }} />}
        {creator && <Button title="Archive household" tone="quiet" onPress={() => setArchiving(true)} />}
        {(!creator || members.filter((member) => !member.leftAt).length === 1) && <Button title="Leave household" tone="quiet" disabled={busy} onPress={() => void act(() => leaveHousehold(id), () => router.push("/households"))} />}
        <Text style={s.muted}>The creator manages invitations and members. Outstanding balances must be settled before leaving.</Text>
      </View>
      <Button title="View household activity" tone="quiet" onPress={() => void showAudit("")} />
    </>}
    {form && household && <HouseholdExpenseForm household={household} members={members} expense={form === "new" ? undefined : form}
      onClose={() => setForm(null)} onSaved={async () => { await refresh(); await refreshHouseholds(); }} />}
    {ruleForm && household && <HouseholdExpenseForm household={household} members={members} rule={ruleForm}
      onClose={() => setRuleForm(null)} onSaved={async () => { await refresh(); await refreshHouseholds(); }} />}
    {invite && <Sheet visible title="Invite a member" onClose={() => setInvite(undefined)}>
      <Text style={s.muted}>Share this code with someone who has a Penny account. It expires at {new Date(invite.expiresAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}.</Text>
      <Text selectable style={[s.heading, { fontSize: 30, textAlign: "center", letterSpacing: 4, marginVertical: 14 }]}>{invite.code}</Text>
      <Button title="Done" tone="quiet" onPress={() => setInvite(undefined)} />
    </Sheet>}
    {renaming && <Sheet visible title="Rename household" onClose={() => setRenaming(false)}>
      <Field label="Household name" value={newName} onChangeText={setNewName} maxLength={80} />
      <Button title="Save name" disabled={busy || !newName.trim()} onPress={() => void act(() => renameHousehold(id, newName.trim()), () => setRenaming(false))} />
    </Sheet>}
    {archiving && <Sheet visible title="Archive household" onClose={() => setArchiving(false)}>
      <Text style={s.muted}>Archive {household?.name}? Its expense history stays available in personal reports. All reimbursements must be settled first.</Text>
      <Button title="Archive household" tone="danger" disabled={busy} onPress={() => void act(() => archiveHousehold(id), () => { setArchiving(false); router.push("/households"); })} />
      <Button title="Cancel" tone="quiet" onPress={() => setArchiving(false)} />
    </Sheet>}
    {removeUserId && <Sheet visible title="Remove member" onClose={() => setRemoveUserId(undefined)}>
      <Text style={s.muted}>Remove {name(removeUserId)} from future expenses? Their past expenses stay in the household.</Text>
      <Button title="Remove member" tone="danger" disabled={busy} onPress={() => void act(() => removeMember(id, removeUserId), () => setRemoveUserId(undefined))} />
      <Button title="Cancel" tone="quiet" onPress={() => setRemoveUserId(undefined)} />
    </Sheet>}
    {confirmTransfer && <Sheet visible title="Record reimbursement" onClose={() => setConfirmTransfer(undefined)}>
      <Text style={s.muted}>Record that {name(confirmTransfer.fromUserId)} paid {name(confirmTransfer.toUserId)} {money(confirmTransfer.amountCents)} for {monthLabel}? This does not add a spending transaction.</Text>
      <Button title="Record full reimbursement" disabled={busy} onPress={() => void act(() => reimburse(id, month, confirmTransfer), () => setConfirmTransfer(undefined))} />
      <Button title="Cancel" tone="quiet" onPress={() => setConfirmTransfer(undefined)} />
    </Sheet>}
    {audit && <Sheet visible wide title="Change history" onClose={() => setAudit(null)}>
      {audit.map((event) => <View key={event.id} style={{ gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.line }}>
        <Text style={s.label}>{event.action} · {name(event.actorId)}</Text>
        <Text style={s.muted}>{new Date(event.createdAt).toLocaleString("en-CA")}</Text>
        {describeAudit(event, name, money).map((change) => <Text key={change} style={s.muted}>{change}</Text>)}
      </View>)}
      {!audit.length && <Text style={s.muted}>No changes recorded.</Text>}
    </Sheet>}
    {receipt && <Sheet visible wide title={receipt.name} onClose={() => setReceipt(undefined)}><ReceiptPreview receipt={receipt} /></Sheet>}
  </View>;
}
