import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { validDate, nextOccurrence } from "../../src/domain/ledger.ts";
import { calculateHouseholdSplits, calculateMonthlyBalances, suggestReimbursements, activeMemberIds, calculateRecurringSplits, type SplitInput, type HouseholdMember, type HouseholdRecurring, type SharedExpense, type HouseholdReimbursement } from "../../src/domain/households.ts";
import { ApplicationError } from "../application/errors.ts";
import type { Security } from "../application/ports.ts";

type Row = Record<string, unknown>;
const id = z.string().min(1).max(100);
const date = z.string().refine(validDate);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const positiveCents = z.number().int().positive().max(99999999999);
const category = z.object({ name: z.string().trim().min(1).max(50), icon: z.string().max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });
const allocations = z.array(z.union([
  z.object({ userId: id, amountCents: z.number().int().nonnegative() }),
  z.object({ userId: id, percentBasisPoints: z.number().int().min(0).max(10000) }),
])).max(100);
const expenseInput = z.object({ title: z.string().trim().min(1).max(100), totalCents: positiveCents, date, payerUserId: id, splitMode: z.enum(["equal", "exact", "percent"]), allocations: allocations.optional(), category, note: z.string().max(1000).default(""), accountId: id.optional(), receiptId: id.optional() });
const recurringInput = expenseInput.omit({ date: true }).extend({ nextDate: date, frequency: z.enum(["weekly", "monthly", "yearly"]) });
const householdInput = z.object({ name: z.string().trim().min(1).max(80), currency: z.enum(["CAD", "USD", "EUR", "GBP"]) });
const reimbursementInput = z.object({ fromUserId: id, toUserId: id, amountCents: positiveCents });
const time = () => Date.now();
function fail(reason: "invalid" | "forbidden" | "not_found" | "conflict", message: string): never { throw new ApplicationError(reason, message); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) fail("invalid", "Invalid household data."); return result.data; }
function transaction<T>(db: DatabaseSync, work: () => T): T { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
function json(value: unknown) { return JSON.stringify(value); }
function rowToMember(row: Row) { return { userId: row.user_id as string, email: row.email as string, joinedAt: row.joined_at as number, ...(row.left_at ? { leftAt: row.left_at as number } : {}) }; }
function rowToHousehold(row: Row) { return { id: row.id as string, name: row.name as string, currency: row.currency as string, creatorId: row.creator_id as string, createdAt: row.created_at as number, memberCount: row.member_count as number }; }
function split(totalCents: number, mode: "equal" | "exact" | "percent", memberIds: string[], input?: z.infer<typeof allocations>) {
  if (!memberIds.length || new Set(memberIds).size !== memberIds.length) fail("invalid", "Select distinct members.");
  let splitInput: SplitInput;
  if (mode === "equal") {
    splitInput = { mode, memberIds };
  } else {
    if (!input?.length || input.length !== memberIds.length ||
        input.some((item) => !memberIds.includes(item.userId)) ||
        new Set(input.map((item) => item.userId)).size !== memberIds.length) {
      fail("invalid", "Provide one split for every eligible member.");
    }
    if (mode === "exact") {
      if (input.some((item) => !("amountCents" in item))) fail("invalid", "Exact splits need amounts.");
      splitInput = { mode, allocations: input as { userId: string; amountCents: number }[] };
    } else {
      if (input.some((item) => !("percentBasisPoints" in item))) fail("invalid", "Percentage splits need percentages.");
      splitInput = { mode, allocations: input as { userId: string; percentBasisPoints: number }[] };
    }
  }
  try { return calculateHouseholdSplits(totalCents, splitInput); }
  catch { fail("invalid", "Split shares must add up to the expense total."); }
}

export function createHouseholdService(db: DatabaseSync, security: Pick<Security, "randomId" | "hashToken">, now = time) {
  const member = (householdId: string, userId: string, historical = false) => db.prepare(`SELECT m.*, u.email FROM household_members m JOIN users u ON u.id=m.user_id WHERE m.household_id=? AND m.user_id=? ${historical ? "" : "AND m.left_at IS NULL"}`).get(householdId, userId) as Row | undefined;
  const members = (householdId: string) => (db.prepare("SELECT m.*, u.email FROM household_members m JOIN users u ON u.id=m.user_id WHERE household_id=? ORDER BY m.joined_at, m.user_id").all(householdId) as Row[]).map(rowToMember);
  const requireMember = (householdId: string, userId: string, historical = false) => { if (!member(householdId, userId, historical) || (!historical && !household(householdId))) fail("not_found", "Household not found."); };
  const household = (householdId: string, includeArchived = false) => db.prepare(`SELECT h.*, (SELECT COUNT(*) FROM household_members m WHERE m.household_id=h.id AND m.left_at IS NULL) AS member_count FROM households h WHERE h.id=? ${includeArchived ? "" : "AND h.archived_at IS NULL"}`).get(householdId) as Row | undefined;
  const requireCreator = (householdId: string, userId: string) => { requireMember(householdId, userId); if (household(householdId)?.creator_id !== userId) fail("forbidden", "Only the household creator can manage members."); };
  const activeIds = (householdId: string, onDate: string) => {
    const periods = db.prepare("SELECT user_id, joined_at, left_at FROM household_member_periods WHERE household_id=?").all(householdId) as Row[];
    const members: HouseholdMember[] = periods.map((period) => ({
      householdId,
      userId: period.user_id as string,
      displayName: "",
      joinedOn: new Date(period.joined_at as number).toISOString().slice(0, 10),
      ...(period.left_at ? { leftOn: new Date(period.left_at as number).toISOString().slice(0, 10) } : {}),
    }));
    return activeMemberIds(members, onDate);
  };
  const currentIds = (householdId: string) => (db.prepare("SELECT user_id FROM household_members WHERE household_id=? AND left_at IS NULL ORDER BY user_id").all(householdId) as Row[]).map((r) => r.user_id as string);
  const canSeeExpense = (householdId: string, userId: string, expenseId: string) => {
    if (member(householdId, userId)) return true;
    return !!db.prepare("SELECT 1 FROM household_splits s JOIN household_expenses e ON e.id=s.expense_id WHERE s.expense_id=? AND s.user_id=? AND e.household_id=?").get(expenseId,userId,householdId);
  };
  const audit = (householdId: string, actorId: string, action: string, before: unknown, after: unknown, expenseId?: string) => {
    const eventId = security.randomId(16);
    const occurredAt = now();
    db.prepare("INSERT INTO household_audit VALUES (?,?,?,?,?,?,?,?)").run(eventId, householdId, expenseId ?? null, actorId, action, before == null ? null : json(before), after == null ? null : json(after), occurredAt);
    if (["expense.created", "expense.updated", "reimbursement.created"].includes(action)) {
      const eventData = after as { date?: string; month?: string } | null;
      const eventMonth = eventData?.month ?? eventData?.date?.slice(0, 7);
      const recipients = db.prepare("SELECT user_id FROM household_members WHERE household_id=? AND left_at IS NULL AND user_id<>?").all(householdId, actorId) as Row[];
      for (const recipient of recipients) {
        db.prepare("INSERT INTO push_outbox (id,user_id,household_id,event_type,entity_id,payload,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?)")
          .run(security.randomId(16), recipient.user_id as string, householdId, action, expenseId ?? eventId, json({ householdId, month: eventMonth, ...(expenseId ? { expenseId } : {}), eventId }), occurredAt, occurredAt);
      }
    }
  };
  const expense = (householdId: string, expenseId: string, viewerId: string, unrestricted = false) => {
    const row = db.prepare("SELECT * FROM household_expenses WHERE id=? AND household_id=? AND deleted_at IS NULL").get(expenseId, householdId) as Row | undefined;
    if (!row || !unrestricted && !canSeeExpense(householdId, viewerId, expenseId)) fail("not_found", "Expense not found.");
    const shares = db.prepare("SELECT user_id, amount_cents FROM household_splits WHERE expense_id=? ORDER BY user_id").all(expenseId) as Row[];
    const receipt = row.receipt_id ? db.prepare("SELECT id,name,mime FROM receipts WHERE id=?").get(row.receipt_id as string) as Row | undefined : undefined;
    return { id: row.id, householdId, title: row.title, totalCents: row.total_cents, date: row.expense_date, payerUserId: row.payer_id, splitMode: row.split_mode, splits: shares.map((s) => ({ userId: s.user_id, amountCents: s.amount_cents })), category: JSON.parse(row.category as string), note: row.note, ...(viewerId === row.payer_id && row.account_id ? { accountId: row.account_id } : {}), ...(receipt ? { receiptId: receipt.id, receipt: { id: receipt.id, name: receipt.name, mime: receipt.mime, uri: `/api/receipts/${receipt.id}` } } : {}), revision: row.revision, createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at, ...(row.recurring_id ? { recurringId: row.recurring_id } : {}) };
  };
  const validateAccount = (payerId: string, actorId: string, accountId?: string) => {
    if (!accountId) return;
    if (payerId !== actorId) fail("forbidden", "Only the payer can attach a payment account.");
    const ledger = db.prepare("SELECT data FROM ledgers WHERE user_id=?").get(payerId) as Row | undefined;
    if (!ledger || !(JSON.parse(ledger.data as string).accounts as { id: string }[]).some((a) => a.id === accountId)) fail("invalid", "Payment account not found.");
  };
  const validateReceipt = (householdId: string, actorId: string, receiptId?: string) => {
    if (!receiptId) return;
    const owned = db.prepare("SELECT id FROM receipts WHERE id=? AND user_id=?").get(receiptId, actorId);
    const linked = db.prepare("SELECT id FROM household_expenses WHERE household_id=? AND receipt_id=? AND deleted_at IS NULL").get(householdId, receiptId);
    if (!owned && !linked) fail("invalid", "Receipt is not available to this household.");
  };
  const listExpenses = (householdId: string, userId: string, monthValue?: string) => {
    requireMember(householdId, userId, true);
    if (monthValue) parse(month, monthValue);
    const rows = (monthValue ? db.prepare("SELECT id FROM household_expenses WHERE household_id=? AND deleted_at IS NULL AND expense_date LIKE ? ORDER BY expense_date DESC, created_at DESC").all(householdId, `${monthValue}-%`) : db.prepare("SELECT id FROM household_expenses WHERE household_id=? AND deleted_at IS NULL ORDER BY expense_date DESC, created_at DESC").all(householdId)) as Row[];
    return rows.flatMap((r) => { try { return [expense(householdId, r.id as string, userId)]; } catch (error) { if (error instanceof ApplicationError && error.reason === "not_found") return []; throw error; } });
  };
  const listReimbursements = (householdId: string, monthValue: string) => (db.prepare("SELECT * FROM household_reimbursements WHERE household_id=? AND month=? ORDER BY created_at").all(householdId, monthValue) as Row[]).map((r) => ({ id: r.id, householdId, month: r.month, fromUserId: r.from_user_id, toUserId: r.to_user_id, amountCents: r.amount_cents, createdBy: r.created_by, createdAt: r.created_at }));
  const recap = (householdId: string, userId: string, monthValue: string) => {
    requireMember(householdId, userId, true); parse(month, monthValue); const membership=member(householdId,userId,true)!; if(membership.left_at && monthValue > new Date(membership.left_at as number).toISOString().slice(0,7))fail("not_found","Month not found.");
    const expenses = listExpenses(householdId, userId, monthValue);
    const allReimbursements = listReimbursements(householdId, monthValue);
    const reimbursements = membership.left_at ? allReimbursements.filter((r)=>(r.createdAt as number)<=(membership.left_at as number)||r.fromUserId===userId||r.toUserId===userId) : allReimbursements;
    const allExpenseIds = db.prepare("SELECT id FROM household_expenses WHERE household_id=? AND deleted_at IS NULL AND expense_date LIKE ?").all(householdId, `${monthValue}-%`) as Row[];
    const allExpenses = membership.left_at ? expenses as SharedExpense[] : allExpenseIds.map((row) => expense(householdId, row.id as string, userId, true)) as SharedExpense[];
    const balances = calculateMonthlyBalances(monthValue, allExpenses, reimbursements as HouseholdReimbursement[]);
    const suggestions = suggestReimbursements(balances);
    const currentMonth = new Date(now()).toISOString().slice(0, 7);
    return { month: monthValue, expenses, reimbursements, balances, suggestions, overdue: monthValue < currentMonth && suggestions.length > 0 };
  };
  const allMonths = (householdId: string) => (db.prepare("SELECT DISTINCT substr(expense_date,1,7) AS month FROM household_expenses WHERE household_id=? AND deleted_at IS NULL UNION SELECT DISTINCT month FROM household_reimbursements WHERE household_id=?").all(householdId,householdId) as Row[]).map((r) => r.month as string);
  const canLeave = (householdId: string, userId: string) => {
    for (const monthValue of allMonths(householdId)) if (recap(householdId,userId,monthValue).balances.some((b) => b.userId===userId && b.balanceCents!==0)) fail("conflict", "Settle every monthly balance before leaving.");
  };
  const createExpense = (householdId: string, actorId: string, data: z.infer<typeof expenseInput>, recurringId?: string, predeterminedSplits?: { userId: string; amountCents: number }[]) => {
    const memberIds = activeIds(householdId, data.date);
    if (!memberIds.includes(data.payerUserId)) fail("invalid", "The payer must be a current household member.");
    validateAccount(data.payerUserId,actorId,data.accountId); validateReceipt(householdId,actorId,data.receiptId);
    const shares = predeterminedSplits ?? split(data.totalCents,data.splitMode,memberIds,data.allocations);
    const idValue = security.randomId(16), stamp = now();
    db.prepare("INSERT INTO household_expenses VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(idValue,householdId,data.title,data.totalCents,data.date,data.payerUserId,data.splitMode,json(data.category),data.note,data.accountId??null,data.receiptId??null,0,actorId,stamp,actorId,stamp,null,recurringId??null);
    for (const share of shares) db.prepare("INSERT INTO household_splits VALUES (?,?,?)").run(idValue,share.userId,share.amountCents);
    const result = expense(householdId,idValue,actorId); audit(householdId,actorId,"expense.created",null,{...result,accountId:undefined},idValue); return result;
  };
  return {
    list(userId: string) { return { households: (db.prepare("SELECT h.*, (SELECT COUNT(*) FROM household_members x WHERE x.household_id=h.id AND x.left_at IS NULL) AS member_count FROM households h JOIN household_members m ON m.household_id=h.id WHERE m.user_id=? AND h.archived_at IS NULL ORDER BY h.created_at DESC").all(userId) as Row[]).map(rowToHousehold) }; },
    create(userId: string, body: unknown) { const input = parse(householdInput,body); return transaction(db,() => { const ledger=db.prepare("SELECT data FROM ledgers WHERE user_id=?").get(userId) as Row; if(JSON.parse(ledger.data as string).currency!==input.currency)fail("invalid","Household currency must match your ledger currency."); const householdId=security.randomId(16), stamp=now(); db.prepare("INSERT INTO households VALUES (?,?,?,?,?,NULL)").run(householdId,input.name,input.currency,userId,stamp); db.prepare("INSERT INTO household_members VALUES (?,?,?,NULL)").run(householdId,userId,stamp); db.prepare("INSERT INTO household_member_periods VALUES (?,?,?,?,NULL)").run(security.randomId(16),householdId,userId,stamp); const result=rowToHousehold(household(householdId)!); audit(householdId,userId,"household.created",null,result); return { household:result }; }); },
    get(householdId: string,userId: string) { requireMember(householdId,userId,true); const row=household(householdId,true); if (!row) fail("not_found","Household not found."); const membership=member(householdId,userId,true)!; return {household:rowToHousehold(row),members:members(householdId).filter((m)=>!membership.left_at || m.joinedAt <= (membership.left_at as number))}; },
    rename(householdId: string,userId: string,body: unknown) { requireCreator(householdId,userId); const input=parse(z.object({name:householdInput.shape.name}),body); return transaction(db,()=>{ const before=rowToHousehold(household(householdId)!); db.prepare("UPDATE households SET name=? WHERE id=?").run(input.name,householdId); const after=rowToHousehold(household(householdId)!); audit(householdId,userId,"household.renamed",before,after); return {household:after}; }); },
    archive(householdId: string, userId: string) {
      return transaction(db, () => {
        requireCreator(householdId, userId);
        for (const monthValue of allMonths(householdId)) {
          if (recap(householdId,userId,monthValue).suggestions.length) fail("conflict","Settle all monthly balances before archiving.");
        }
        db.prepare("UPDATE households SET archived_at=? WHERE id=?").run(now(),householdId);
        audit(householdId,userId,"household.archived",null,{householdId});
        return {ok:true};
      });
    },
    invite(householdId: string,userId: string) { requireCreator(householdId,userId); return transaction(db,()=>{ db.prepare("DELETE FROM household_invites WHERE household_id=?").run(householdId); const code=security.randomId(5).toUpperCase(),expiresAt=now()+600000; db.prepare("INSERT INTO household_invites VALUES (?,?,?,NULL)").run(security.hashToken(code),householdId,expiresAt); audit(householdId,userId,"invite.created",null,{expiresAt}); return {code,expiresAt}; }); },
    join(userId: string,body: unknown) { const {code}=parse(z.object({code:z.string().regex(/^[A-Fa-f0-9]{10}$/)}),body); return transaction(db,()=>{ const invitation=db.prepare("SELECT * FROM household_invites WHERE code_hash=? AND expires_at>? ").get(security.hashToken(code.toUpperCase()),now()) as Row|undefined; if (!invitation) fail("invalid","Invite code is invalid or expired."); const householdId=invitation.household_id as string; const ledger=db.prepare("SELECT data FROM ledgers WHERE user_id=?").get(userId) as Row; if(JSON.parse(ledger.data as string).currency!==household(householdId)?.currency)fail("invalid","Household currency must match your ledger currency."); if (member(householdId,userId)) fail("conflict","You are already a member."); if (member(householdId,userId,true)) db.prepare("UPDATE household_members SET joined_at=?,left_at=NULL WHERE household_id=? AND user_id=?").run(now(),householdId,userId); else db.prepare("INSERT INTO household_members VALUES (?,?,?,NULL)").run(householdId,userId,now()); db.prepare("INSERT INTO household_member_periods VALUES (?,?,?,?,NULL)").run(security.randomId(16),householdId,userId,now()); audit(householdId,userId,"member.joined",null,{userId}); return {household:rowToHousehold(household(householdId)!)}; }); },
    leave(householdId: string,userId: string) { return transaction(db,()=>{ requireMember(householdId,userId); if (household(householdId)?.creator_id===userId && currentIds(householdId).length>1) fail("conflict","The creator cannot leave while other members remain."); canLeave(householdId,userId); db.prepare("UPDATE household_members SET left_at=? WHERE household_id=? AND user_id=?").run(now(),householdId,userId); db.prepare("UPDATE household_member_periods SET left_at=? WHERE household_id=? AND user_id=? AND left_at IS NULL").run(now(),householdId,userId); audit(householdId,userId,"member.left",{userId},null); return {ok:true}; }); },
    remove(householdId: string,actorId: string,userId: string) { return transaction(db,()=>{ requireCreator(householdId,actorId); if (actorId===userId) fail("invalid","The creator cannot remove themselves."); requireMember(householdId,userId); canLeave(householdId,userId); db.prepare("UPDATE household_members SET left_at=? WHERE household_id=? AND user_id=?").run(now(),householdId,userId); db.prepare("UPDATE household_member_periods SET left_at=? WHERE household_id=? AND user_id=? AND left_at IS NULL").run(now(),householdId,userId); audit(householdId,actorId,"member.removed",{userId},null); return {ok:true}; }); },
    expenses(householdId: string,userId: string,monthValue?: string) { return {expenses:listExpenses(householdId,userId,monthValue)}; },
    getExpense(householdId: string,userId: string,expenseId: string) { requireMember(householdId,userId,true); return {expense:expense(householdId,expenseId,userId)}; },
    createExpense(householdId: string,userId: string,body: unknown) { requireMember(householdId,userId); const input=parse(expenseInput,body); return transaction(db,()=>({expense:createExpense(householdId,userId,input)})); },
    updateExpense(householdId: string,userId: string,expenseId: string,body: unknown) { requireMember(householdId,userId); const input=parse(expenseInput.extend({revision:z.number().int().nonnegative()}),body); return transaction(db,()=>{ const before=expense(householdId,expenseId,userId); if (before.revision!==input.revision) fail("conflict","Expense changed. Refresh and try again."); const memberIds=activeIds(householdId,input.date); if (!memberIds.includes(input.payerUserId)) fail("invalid","The payer must be a current household member."); const storedAccount=db.prepare("SELECT payer_id,account_id FROM household_expenses WHERE id=? AND household_id=?").get(expenseId,householdId) as Row; const accountId=input.accountId ?? (userId!==input.payerUserId && storedAccount.payer_id===input.payerUserId ? storedAccount.account_id as string|undefined : undefined); validateAccount(input.payerUserId,userId,input.accountId); validateReceipt(householdId,userId,input.receiptId); const shares=split(input.totalCents,input.splitMode,memberIds,input.allocations); db.prepare("UPDATE household_expenses SET title=?,total_cents=?,expense_date=?,payer_id=?,split_mode=?,category=?,note=?,account_id=?,receipt_id=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND household_id=? AND revision=?").run(input.title,input.totalCents,input.date,input.payerUserId,input.splitMode,json(input.category),input.note,accountId??null,input.receiptId??null,userId,now(),expenseId,householdId,input.revision); db.prepare("DELETE FROM household_splits WHERE expense_id=?").run(expenseId); for(const share of shares) db.prepare("INSERT INTO household_splits VALUES (?,?,?)").run(expenseId,share.userId,share.amountCents); const after=expense(householdId,expenseId,userId); audit(householdId,userId,"expense.updated",{...before,accountId:undefined},{...after,accountId:undefined},expenseId); return {expense:after}; }); },
    deleteExpense(householdId: string,userId: string,expenseId: string,body: unknown) { requireMember(householdId,userId); const {revision}=parse(z.object({revision:z.number().int().nonnegative()}),body); return transaction(db,()=>{ const before=expense(householdId,expenseId,userId); if(before.revision!==revision) fail("conflict","Expense changed. Refresh and try again."); db.prepare("UPDATE household_expenses SET deleted_at=?,updated_by=?,revision=revision+1 WHERE id=?").run(now(),userId,expenseId); audit(householdId,userId,"expense.deleted",{...before,accountId:undefined},null,expenseId); return {ok:true}; }); },
    month(householdId: string,userId: string,monthValue: string) { const result=recap(householdId,userId,monthValue); const currentMonth=new Date(now()).toISOString().slice(0,7); const membership=member(householdId,userId,true)!; const leftMonth=membership.left_at?new Date(membership.left_at as number).toISOString().slice(0,7):undefined; const overdueMonths=allMonths(householdId).filter((m)=>m<currentMonth&&(!leftMonth||m<=leftMonth)&&recap(householdId,userId,m).suggestions.length>0).sort(); return {...result,overdueMonths}; },
    reimburse(householdId: string,userId: string,monthValue: string,body: unknown) { requireMember(householdId,userId); parse(month,monthValue); const input=parse(reimbursementInput,body); if(input.fromUserId===input.toUserId) fail("invalid","Choose two different members."); if(userId!==input.fromUserId && userId!==input.toUserId) fail("forbidden","Only people involved can record a reimbursement."); return transaction(db,()=>{ const suggestion=recap(householdId,userId,monthValue).suggestions.find((s)=>s.fromUserId===input.fromUserId&&s.toUserId===input.toUserId&&s.amountCents===input.amountCents); if(!suggestion) fail("conflict","This is no longer the full suggested reimbursement."); const idValue=security.randomId(16),stamp=now(); db.prepare("INSERT INTO household_reimbursements VALUES (?,?,?,?,?,?,?,?)").run(idValue,householdId,monthValue,input.fromUserId,input.toUserId,input.amountCents,userId,stamp); const result={id:idValue,householdId,month:monthValue,...input,createdBy:userId,createdAt:stamp}; audit(householdId,userId,"reimbursement.created",null,result); return {reimbursement:result}; }); },
    audit(householdId: string,userId: string,expenseId?: string) { requireMember(householdId,userId,true); const rows=(expenseId?db.prepare("SELECT * FROM household_audit WHERE household_id=? AND expense_id=? ORDER BY created_at DESC").all(householdId,expenseId):db.prepare("SELECT * FROM household_audit WHERE household_id=? ORDER BY created_at DESC LIMIT 500").all(householdId)) as Row[]; const membership=member(householdId,userId,true)!; const visible=membership.left_at ? rows.filter((r)=>r.expense_id?canSeeExpense(householdId,userId,r.expense_id as string):(r.created_at as number)<=(membership.left_at as number)) : rows; return {events:visible.map((r)=>({id:r.id,householdId, ...(r.expense_id?{expenseId:r.expense_id}:{}),actorId:r.actor_id,action:r.action,before:r.before_json?JSON.parse(r.before_json as string):null,after:r.after_json?JSON.parse(r.after_json as string):null,createdAt:r.created_at}))}; },
    projection(userId: string,monthValue?: string,yearValue?: string) { if(monthValue)parse(month,monthValue); if(yearValue&&!/^\d{4}$/.test(yearValue))fail("invalid","Invalid year."); const rows=(monthValue?db.prepare("SELECT e.id,e.household_id FROM household_expenses e JOIN household_members m ON m.household_id=e.household_id AND m.user_id=? WHERE e.deleted_at IS NULL AND e.expense_date LIKE ? ORDER BY e.expense_date DESC").all(userId,`${monthValue}-%`):yearValue?db.prepare("SELECT e.id,e.household_id FROM household_expenses e JOIN household_members m ON m.household_id=e.household_id AND m.user_id=? WHERE e.deleted_at IS NULL AND e.expense_date LIKE ? ORDER BY e.expense_date DESC").all(userId,`${yearValue}-%`):db.prepare("SELECT e.id,e.household_id FROM household_expenses e JOIN household_members m ON m.household_id=e.household_id AND m.user_id=? WHERE e.deleted_at IS NULL ORDER BY e.expense_date DESC").all(userId)) as Row[]; return {transactions:rows.flatMap((r)=>{ const e=expense(r.household_id as string,r.id as string,userId); const share=e.splits.find((s)=>s.userId===userId); if(!share)return []; return [{id:e.id,householdId:e.householdId,householdName:household(e.householdId as string,true)?.name,householdCurrency:household(e.householdId as string,true)?.currency,title:e.title,date:e.date,totalCents:e.totalCents,shareCents:share.amountCents,payerUserId:e.payerUserId,category:e.category,note:e.note,...(e.receipt?{receipt:e.receipt}:{}),...(e.accountId?{accountId:e.accountId}:{})}]; })}; },
    canReadReceipt(userId: string,receiptId: string) { return !!db.prepare("SELECT 1 FROM household_expenses e JOIN household_members m ON m.household_id=e.household_id AND m.user_id=? WHERE e.receipt_id=? AND e.deleted_at IS NULL AND (m.left_at IS NULL OR EXISTS (SELECT 1 FROM household_splits s WHERE s.expense_id=e.id AND s.user_id=?))").get(userId,receiptId,userId); },
    recurring(householdId:string,userId:string) { requireMember(householdId,userId,true); if (!member(householdId,userId)) return {rules:[]}; return {rules:(db.prepare("SELECT * FROM household_recurring WHERE household_id=? ORDER BY next_date").all(householdId) as Row[]).map((r)=>({id:r.id,householdId,title:r.title,totalCents:r.total_cents,payerUserId:r.payer_id,splitMode:r.split_mode,allocations:r.allocations_json?JSON.parse(r.allocations_json as string):undefined,category:JSON.parse(r.category as string),note:r.note,...(r.payer_id===userId&&r.account_id?{accountId:r.account_id}:{}),...(r.receipt_id?{receiptId:r.receipt_id}:{}),frequency:r.frequency,nextDate:r.next_date,anchorDay:r.anchor_day,active:!!r.active,revision:r.revision}))}; },
    createRecurring(householdId: string, userId: string, body: unknown) {
      requireMember(householdId, userId);
      const input = parse(recurringInput, body);
      validateAccount(input.payerUserId, userId, input.accountId);
      validateReceipt(householdId, userId, input.receiptId);
      const memberIds = currentIds(householdId);
      if (!memberIds.includes(input.payerUserId)) fail("invalid", "Payer must be a current member.");
      split(input.totalCents, input.splitMode, memberIds, input.allocations);
      return transaction(db, () => {
        const idValue = security.randomId(16);
        db.prepare("INSERT INTO household_recurring VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
          idValue, householdId, input.title, input.totalCents, input.payerUserId,
          input.splitMode, input.allocations ? json(input.allocations) : null,
          json(input.category), input.note, input.accountId ?? null, input.receiptId ?? null,
          input.frequency, input.nextDate, Number(input.nextDate.slice(8)), 1, userId, 0,
        );
        const rule = { id: idValue, householdId, ...input, active: true, revision: 0 };
        audit(householdId, userId, "recurring.created", null, { ...rule, accountId: undefined });
        return { rule };
      });
    },
    updateRecurring(householdId: string, userId: string, ruleId: string, body: unknown) {
      requireMember(householdId, userId);
      const input = parse(recurringInput.extend({ revision: z.number().int().nonnegative(), active: z.boolean() }), body);
      validateReceipt(householdId, userId, input.receiptId);
      const memberIds = currentIds(householdId);
      if (!memberIds.includes(input.payerUserId)) fail("invalid", "Payer must be a current member.");
      split(input.totalCents, input.splitMode, memberIds, input.allocations);
      return transaction(db, () => {
        const before = db.prepare("SELECT * FROM household_recurring WHERE id=? AND household_id=?").get(ruleId, householdId) as Row | undefined;
        if (!before) fail("not_found", "Recurring rule not found.");
        if (before.revision !== input.revision) fail("conflict", "Recurring rule changed. Refresh and try again.");
        const accountId = input.accountId ?? (userId !== input.payerUserId && before.payer_id === input.payerUserId ? before.account_id as string | undefined : undefined);
        validateAccount(input.payerUserId, userId, input.accountId);
        db.prepare("UPDATE household_recurring SET title=?,total_cents=?,payer_id=?,split_mode=?,allocations_json=?,category=?,note=?,account_id=?,receipt_id=?,frequency=?,next_date=?,anchor_day=?,active=?,revision=revision+1 WHERE id=? AND revision=?").run(
          input.title,input.totalCents,input.payerUserId,input.splitMode,input.allocations?json(input.allocations):null,
          json(input.category),input.note,accountId??null,input.receiptId??null,input.frequency,
          input.nextDate,Number(input.nextDate.slice(8)),input.active?1:0,ruleId,input.revision,
        );
        const rule = { id: ruleId, householdId, ...input, revision: input.revision + 1 };
        audit(householdId,userId,"recurring.updated",{ id: ruleId, title: before.title, active: !!before.active, revision: before.revision },{...rule,accountId:undefined});
        return {rule};
      });
    },
    deleteRecurring(householdId: string, userId: string, ruleId: string, body: unknown) {
      requireMember(householdId, userId);
      const { revision } = parse(z.object({revision:z.number().int().nonnegative()}), body);
      return transaction(db, () => {
        const before = db.prepare("SELECT id,title,revision FROM household_recurring WHERE id=? AND household_id=?").get(ruleId,householdId) as Row | undefined;
        if (!before) fail("not_found", "Recurring rule not found.");
        if (before.revision !== revision) fail("conflict", "Recurring rule changed. Refresh and try again.");
        db.prepare("DELETE FROM household_recurring WHERE id=?").run(ruleId);
        audit(householdId,userId,"recurring.deleted",before,null);
        return {ok:true};
      });
    },
    runRecurring(untilDate: string) {
      parse(date, untilDate);
      return transaction(db, () => {
        const created: unknown[] = [];
        const rows = db.prepare("SELECT * FROM household_recurring WHERE active=1 AND next_date<=?").all(untilDate) as Row[];
        for (const rule of rows) {
          let nextDate = rule.next_date as string;
          let limit = 0;
          while (nextDate <= untilDate && limit++ < 366) {
            const householdId = rule.household_id as string;
            const payerId = rule.payer_id as string;
            const active = activeIds(householdId, nextDate);
            if (active.includes(payerId)) {
              const existing = db.prepare("SELECT id FROM household_expenses WHERE recurring_id=? AND expense_date=?").get(rule.id as string,nextDate);
              if (!existing) {
                const periods = db.prepare("SELECT * FROM household_member_periods WHERE household_id=?").all(householdId) as Row[];
                const members: HouseholdMember[] = periods.map((period) => ({
                  householdId, userId: period.user_id as string, displayName: "",
                  joinedOn: new Date(period.joined_at as number).toISOString().slice(0, 10),
                  ...(period.left_at ? {leftOn:new Date(period.left_at as number).toISOString().slice(0, 10)} : {}),
                }));
                const splitMode = rule.split_mode as "equal" | "exact" | "percent";
                const storedAllocations = rule.allocations_json ? JSON.parse(rule.allocations_json as string) as z.infer<typeof allocations> : undefined;
                const splitInput: SplitInput = splitMode === "equal" ? {mode:"equal",memberIds:active} : splitMode === "exact" ? {mode:"exact",allocations:storedAllocations as {userId:string;amountCents:number}[]} : {mode:"percent",allocations:storedAllocations as {userId:string;percentBasisPoints:number}[]};
                const recurrence: HouseholdRecurring = {
                  id: rule.id as string, householdId, title: rule.title as string,
                  totalCents: rule.total_cents as number, payerUserId: payerId,
                  frequency: rule.frequency as "weekly"|"monthly"|"yearly", nextDate,
                  anchorDay: rule.anchor_day as number, active:true, splitInput,
                };
                const shares = calculateRecurringSplits(recurrence,members,nextDate);
                const templateIds = splitMode === "equal" ? active : storedAllocations!.map((item) => item.userId);
                const sameMembers = templateIds.length === active.length && active.every((id) => templateIds.includes(id));
                created.push(createExpense(householdId,payerId,{
                  title:rule.title as string,totalCents:rule.total_cents as number,date:nextDate,
                  payerUserId:payerId,splitMode:sameMembers?splitMode:"equal",
                  category:JSON.parse(rule.category as string),note:rule.note as string,
                  ...(rule.account_id?{accountId:rule.account_id as string}:{}),
                },rule.id as string,shares));
              }
            }
            nextDate = nextOccurrence(nextDate,rule.frequency as "weekly"|"monthly"|"yearly",rule.anchor_day as number);
          }
          db.prepare("UPDATE household_recurring SET next_date=? WHERE id=?").run(nextDate,rule.id as string);
        }
        return {expenses:created};
      });
    },
  };
}
export type HouseholdService=ReturnType<typeof createHouseholdService>;
