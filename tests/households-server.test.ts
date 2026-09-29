import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { openDatabase } from "../server/infrastructure/database.ts";
import { createHouseholdService } from "../server/infrastructure/households.ts";
import { security } from "../server/infrastructure/security.ts";
import { emptyLedger } from "../src/domain/ledger.ts";
import { createRepositories } from "../server/infrastructure/repositories.ts";
import { createLedgerService } from "../server/application/ledger.ts";

const stamp = Date.parse("2026-09-28T12:00:00Z");
const category = { name: "Groceries", icon: "basket-outline", color: "#6C9C79" };
function setup() {
  const db = openDatabase(":memory:");
  for (const [id,email] of [["alex","alex@example.test"],["bea","bea@example.test"],["cam","cam@example.test"],["outsider","other@example.test"]]) {
    db.prepare("INSERT INTO users VALUES (?,?,?,?)").run(id,email,"hash","salt");
    db.prepare("INSERT INTO ledgers VALUES (?,0,?)").run(id,JSON.stringify(emptyLedger()));
  }
  let currentTime = stamp;
  const service = createHouseholdService(db,security,()=>currentTime);
  const household = service.create("alex",{name:"Home",currency:"CAD"}).household;
  return {db,service,household,advance:(date:string)=>{currentTime=Date.parse(date);}};
}
function join(service: ReturnType<typeof createHouseholdService>, householdId: string, userId: string) {
  const {code}=service.invite(householdId,"alex");
  return service.join(userId,{code});
}
function expense(totalCents: number, payerUserId="alex", date="2026-09-28") {
  return {title:"Groceries",totalCents,date,payerUserId,splitMode:"equal",category,note:""};
}

test("household invite, access, splits, recap, reimbursement and audit", (t) => {
  const {db,service,household,advance}=setup(); t.after(()=>db.close());
  assert.throws(()=>service.invite(household.id,"bea"),{reason:"not_found"});
  const first=service.invite(household.id,"alex");
  assert.equal(first.expiresAt,stamp+600000);
  assert.throws(()=>service.join("bea",{code:"0000000000"}),{reason:"invalid"});
  service.join("bea",{code:first.code});
  service.join("cam",{code:first.code});
  assert.equal(service.get(household.id,"cam").members.length,3);
  assert.throws(()=>service.get(household.id,"outsider"),{reason:"not_found"});
  const created=service.createExpense(household.id,"alex",expense(9000)).expense;
  assert.deepEqual(created.splits.map((s)=>s.amountCents),[3000,3000,3000]);
  assert.equal(service.projection("bea").transactions[0]?.shareCents,3000);
  const month=service.month(household.id,"bea","2026-09");
  assert.deepEqual(month.suggestions.map((s)=>s.amountCents),[3000,3000]);
  assert.throws(()=>service.leave(household.id,"bea"),{reason:"conflict"});
  assert.throws(()=>service.leave(household.id,"alex"),{reason:"conflict"});
  assert.throws(()=>service.reimburse(household.id,"bea","2026-09",{fromUserId:"bea",toUserId:"alex",amountCents:3000}),{reason:"conflict"},"the month is still open");
  advance("2026-09-30T12:00:00Z");
  assert.throws(()=>service.reimburse(household.id,"bea","2026-09",{fromUserId:"bea",toUserId:"alex",amountCents:2999}),{reason:"conflict"});
  const repaid=service.reimburse(household.id,"bea","2026-09",{fromUserId:"bea",toUserId:"alex",amountCents:3000}).reimbursement;
  assert.equal(repaid.amountCents,3000);
  assert.equal(service.projection("bea").transactions.length,1,"reimbursement is not a spending transaction");
  assert.equal(service.month(household.id,"bea","2026-09").balances.find((b)=>b.userId==="bea")?.balanceCents,0);
  service.leave(household.id,"bea");
  assert.equal(service.get(household.id,"alex").members.find((m)=>m.userId==="bea")?.leftAt,Date.parse("2026-09-30T12:00:00Z"));
  assert.equal(service.get(household.id,"bea").members.length,3,"departed member retains history");
  const history=service.audit(household.id,"bea",created.id as string);
  assert.equal(history.events[0]?.action,"expense.created");
  assert.throws(()=>service.createExpense(household.id,"bea",expense(3000)),{reason:"not_found"});
});

test("exact and percent splits, stale edits, private accounts and receipt access", (t) => {
  const {db,service,household}=setup(); t.after(()=>db.close());
  join(service,household.id,"bea"); join(service,household.id,"cam");
  const ledger=emptyLedger(); ledger.accounts.push({id:"checking",name:"Checking",type:"bank"});
  db.prepare("UPDATE ledgers SET data=? WHERE user_id='alex'").run(JSON.stringify(ledger));
  const receiptId="receipt-test";
  db.prepare("INSERT INTO receipts VALUES (?,?,?,?,?)").run(receiptId,"alex","Slip.pdf","application/pdf",Buffer.from("%PDF"));
  assert.throws(()=>service.createExpense(household.id,"bea",{...expense(10000),accountId:"checking"}),{reason:"forbidden"});
  const created=service.createExpense(household.id,"alex",{...expense(10000),splitMode:"percent",allocations:[{userId:"alex",percentBasisPoints:3334},{userId:"bea",percentBasisPoints:3333},{userId:"cam",percentBasisPoints:3333}],accountId:"checking",receiptId}).expense;
  assert.equal(created.splits.reduce((sum,s)=>sum+(s.amountCents as number),0),10000);
  assert.equal(created.accountId,"checking");
  assert.equal(service.getExpense(household.id,"bea",created.id as string).expense.accountId,undefined);
  assert.equal(service.canReadReceipt("bea",receiptId),true);
  assert.equal(service.canReadReceipt("outsider",receiptId),false);
  assert.equal((service.getExpense(household.id,"bea",created.id as string).expense.receipt as {name:string}|undefined)?.name,"Slip.pdf");
  assert.throws(()=>service.updateExpense(household.id,"bea",created.id as string,{...expense(10000),splitMode:"exact",allocations:[{userId:"alex",amountCents:5000},{userId:"bea",amountCents:2500},{userId:"cam",amountCents:2500}],accountId:"checking",revision:0}),{reason:"forbidden"});
  const updated=service.updateExpense(household.id,"bea",created.id as string,{...expense(10000),splitMode:"exact",allocations:[{userId:"alex",amountCents:5000},{userId:"bea",amountCents:2500},{userId:"cam",amountCents:2500}],revision:0}).expense;
  assert.equal(updated.revision,1);
  assert.throws(()=>service.updateExpense(household.id,"alex",created.id as string,{...expense(10000),revision:0}),{reason:"conflict"});
  assert.equal(service.audit(household.id,"cam",created.id as string).events.length,2);
  assert.equal(service.getExpense(household.id,"alex",created.id as string).expense.accountId,"checking","another member's edit preserves payer account");
  service.updateExpense(household.id,"alex",created.id as string,{...expense(10000),splitMode:"exact",allocations:[{userId:"alex",amountCents:5000},{userId:"bea",amountCents:2500},{userId:"cam",amountCents:2500}],revision:1});
  assert.equal(service.getExpense(household.id,"alex",created.id as string).expense.accountId,undefined,"payer can clear account");
});

test("household currency and recurring occurrences use current membership", (t) => {
  const {db,service,household}=setup(); t.after(()=>db.close());
  const otherLedger=emptyLedger(); otherLedger.currency="USD";
  db.prepare("UPDATE ledgers SET data=? WHERE user_id='bea'").run(JSON.stringify(otherLedger));
  const code=service.invite(household.id,"alex").code;
  assert.throws(()=>service.join("bea",{code}),{reason:"invalid"});
  db.prepare("UPDATE ledgers SET data=? WHERE user_id='bea'").run(JSON.stringify(emptyLedger()));
  service.join("bea",{code});
  const rule=service.createRecurring(household.id,"alex",{...expense(9000),date:undefined,nextDate:"2026-09-28",frequency:"monthly"}).rule;
  assert.equal(rule.active,true);
  const first=service.runRecurring("2026-09-28").expenses;
  assert.equal(first.length,1);
  assert.equal(service.runRecurring("2026-09-28").expenses.length,0,"occurrence is idempotent");
  join(service,household.id,"cam");
  const second=service.runRecurring("2026-10-28").expenses;
  assert.equal(second.length,1);
  const expenses=service.expenses(household.id,"cam").expenses;
  assert.deepEqual(expenses.map((e)=>e.splits.length),[3,2]);
});

test("departed member sees only their own historical expense and receipt", (t) => {
  const {db,service,household,advance}=setup(); t.after(()=>db.close());
  join(service,household.id,"bea");
  const oldReceipt="old-receipt";
  db.prepare("INSERT INTO receipts VALUES (?,?,?,?,?)").run(oldReceipt,"alex","Old.pdf","application/pdf",Buffer.from("%PDF"));
  const old=service.createExpense(household.id,"alex",{...expense(9000),receiptId:oldReceipt}).expense;
  service.createRecurring(household.id,"alex",{...expense(9000),date:undefined,nextDate:"2026-10-28",frequency:"monthly"});
  advance("2026-09-30T12:00:00Z");
  service.reimburse(household.id,"bea","2026-09",{fromUserId:"bea",toUserId:"alex",amountCents:4500});
  service.leave(household.id,"bea");
  const newReceipt="new-receipt";
  db.prepare("INSERT INTO receipts VALUES (?,?,?,?,?)").run(newReceipt,"alex","New.pdf","application/pdf",Buffer.from("%PDF"));
  const newer=service.createExpense(household.id,"alex",{...expense(1200,"alex","2026-10-01"),receiptId:newReceipt}).expense;
  assert.deepEqual(service.expenses(household.id,"bea").expenses.map((e)=>e.id),[old.id]);
  assert.throws(()=>service.getExpense(household.id,"bea",newer.id as string),{reason:"not_found"});
  assert.equal(service.canReadReceipt("bea",oldReceipt),true);
  assert.equal(service.canReadReceipt("bea",newReceipt),false);
  assert.deepEqual(service.recurring(household.id,"bea").rules,[]);
  assert.equal(service.month(household.id,"bea","2026-09").expenses.length,1);
  assert.equal(service.audit(household.id,"bea").events.some((e)=>e.expenseId===newer.id),false);
});

test("private ledger cannot change currency or remove a linked household account", (t) => {
  const {db,service,household}=setup(); t.after(()=>db.close());
  const repositories=createRepositories(db);
  const ledgerService=createLedgerService(repositories.ledgers,repositories.receipts);
  const snapshot=repositories.ledgers.read("alex");
  snapshot.ledger.currency="USD";
  assert.throws(()=>ledgerService.save("alex",snapshot),{reason:"invalid"});
  const clean=repositories.ledgers.read("alex");
  clean.ledger.accounts.push({id:"checking",name:"Checking",type:"bank"});
  ledgerService.save("alex",clean);
  service.createExpense(household.id,"alex",{...expense(1000),accountId:"checking"});
  const linked=repositories.ledgers.read("alex");
  linked.ledger.accounts=[];
  assert.throws(()=>ledgerService.save("alex",linked),{reason:"invalid"});
  const scheduled=repositories.ledgers.read("alex");
  scheduled.ledger.accounts.push({id:"schedule-account",name:"Schedule",type:"bank"});
  ledgerService.save("alex",scheduled);
  service.createRecurring(household.id,"alex",{...expense(1000),date:undefined,nextDate:"2026-10-28",frequency:"monthly",accountId:"schedule-account"});
  const ruleLinked=repositories.ledgers.read("alex");
  ruleLinked.ledger.accounts=ruleLinked.ledger.accounts.filter((account)=>account.id!=="schedule-account");
  assert.throws(()=>ledgerService.save("alex",ruleLinked),{reason:"invalid"},"future household occurrences still use this account");
});

test("opening a pre-household database preserves private ledger and marks migration", (t) => {
  const folder=mkdtempSync(joinPath(tmpdir(),"penny-household-migration-"));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const path=joinPath(folder,"old.sqlite");
  const old=new DatabaseSync(path);
  old.exec("CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,salt TEXT NOT NULL); CREATE TABLE ledgers (user_id TEXT PRIMARY KEY REFERENCES users(id),revision INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);");
  old.prepare("INSERT INTO users VALUES (?,?,?,?)").run("alex","alex@example.test","hash","salt");
  old.prepare("INSERT INTO ledgers VALUES (?,0,?)").run("alex",JSON.stringify(emptyLedger()));
  old.close();
  const upgraded=openDatabase(path);
  t.after(()=>upgraded.close());
  assert.equal(upgraded.prepare("PRAGMA user_version").get()!.user_version,1);
  assert.equal((upgraded.prepare("SELECT data FROM ledgers WHERE user_id='alex'").get()!.data as string),JSON.stringify(emptyLedger()));
  assert.equal(upgraded.prepare("SELECT count(*) AS n FROM household_members").get()!.n,0);
});

test("HTTP household routes enforce sessions and share receipts only with members", async (t) => {
  const today = new Date().toISOString().slice(0, 10);
  const { createApp } = await import("../server/app.ts");
  const { once } = await import("node:events");
  const instance=createApp({databasePath:":memory:"});
  const server=instance.app.listen(0,"127.0.0.1");
  t.after(async()=>{ await new Promise<void>((resolve)=>server.close(()=>resolve())); instance.db.close(); });
  await once(server,"listening");
  const port=(server.address() as {port:number}).port;
  const base=`http://127.0.0.1:${port}/api`;
  const request=(path:string,method:string,body?:unknown,token?:string)=>fetch(base+path,{method,headers:{...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request("/households","GET")).status,401);
  const alex=await (await request("/auth/register","POST",{email:"alex@example.test",password:"a secure test password"})).json() as {token:string};
  const bea=await (await request("/auth/register","POST",{email:"bea@example.test",password:"a secure test password"})).json() as {token:string};
  const outsider=await (await request("/auth/register","POST",{email:"outside@example.test",password:"a secure test password"})).json() as {token:string};
  const created=await request("/households","POST",{name:"Home",currency:"CAD"},alex.token);
  assert.equal(created.status,201);
  const {household}=await created.json() as {household:{id:string;creatorId:string}};
  assert.equal((await request(`/households/${household.id}`,"GET",undefined,bea.token)).status,404);
  assert.equal((await request(`/households/${household.id}/invites`,"POST",{},bea.token)).status,404);
  const invite=await (await request(`/households/${household.id}/invites`,"POST",{},alex.token)).json() as {code:string};
  assert.equal((await request("/households/join","POST",{code:invite.code},bea.token)).status,200);
  const pdf=Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
  const uploaded=await request("/receipts","POST",{name:"Slip.pdf",mime:"application/pdf",base64:pdf.toString("base64")},alex.token);
  assert.equal(uploaded.status,201,await uploaded.clone().text());
  const receipt=await uploaded.json() as {id:string};
  const e=await request(`/households/${household.id}/expenses`,"POST",{...expense(8000,household.creatorId,today),receiptId:receipt.id},alex.token);
  assert.equal(e.status,201,await e.clone().text());
  assert.equal((await request(`/receipts/${receipt.id}`,"GET",undefined,bea.token)).status,200);
  assert.equal((await request(`/receipts/${receipt.id}`,"GET",undefined,outsider.token)).status,404);
  assert.equal((await request(`/households/${household.id}/expenses`,"GET",undefined,outsider.token)).status,404);
  const projection=await (await request(`/households/projection?year=${today.slice(0, 4)}`,"GET",undefined,bea.token)).json() as {transactions:{shareCents:number}[]};
  assert.equal(projection.transactions[0].shareCents,4000);
});
