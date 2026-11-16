// Emailed receipts end to end (MAZ-184): a raw email through the real Cloudflare Email
// Worker (`wrangler dev`, workerd), the signed ingress, the API's inbound mail worker and
// penny-render (Gotenberg, pinned in deploy/compose.yaml) into the receipt inbox, then
// attached to an expense with a normal ledger save. Opt-in with the full-stack suite: it
// also needs `npm --prefix apps/email-worker ci` and poppler, libvips and Tesseract (the
// worker's engine check).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { buildApi, down, up } from "../../test-env/environment.mjs";
import { receiptEmail, sendEmail } from "../../test-env/email.mjs";
import { client } from "../../test-env/seed.mjs";

let state;
before(async () => {
  buildApi();
  state = await up({ build: false, email: true });
}, { timeout: 900_000 });
after(async () => {
  if (state) await down(state.runId);
});

// A one-page PDF whose bytes pass the receipt signature check.
const invoice = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

async function inbox(request, token) {
  return (await request("GET", "/api/receipt-inbox", { token })).body.items;
}

async function waitForItems(request, token, count) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const items = await inbox(request, token);
    if (items.length >= count) return items;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The inbox never reached ${count} item(s).`);
}

test("an emailed receipt reaches the inbox and attaches to an expense", { timeout: 600_000 }, async () => {
  const request = client(state.apiUrl);
  const { body: account } = await request("POST", "/api/auth/register", {
    body: { email: `mail-${state.runId}@example.test`, password: "a secure test password" },
  });
  const token = account.token;
  const { body: envelope } = await request("POST", "/api/receipt-email", { token });
  const address = envelope.address.address;
  assert.match(address, /^r-[a-z2-7]{20}@receipts\.penny\.test$/);

  // Refused during the SMTP session by the Worker: never reaches Penny's message endpoint.
  const unknown = await sendEmail(state, {
    to: "r-aaaaaaaaaaaaaaaaaaaa@receipts.penny.test",
    raw: receiptEmail({ to: "r-aaaaaaaaaaaaaaaaaaaa@receipts.penny.test" }),
  });
  assert.equal(unknown.accepted, false);
  assert.match(unknown.reason, /Unknown address/);

  const sent = await sendEmail(state, {
    to: address.replace("@", "+shop@"),
    raw: receiptEmail({
      to: address,
      subject: "Order 1042 confirmed <script>alert(1)</script>",
      html: '<p>Total <b>$12.50</b></p><script>alert(1)</script><img src="http://169.254.169.254/latest">',
      attachments: [{ name: "invoice-0412.pdf", mime: "application/pdf", content: invoice }],
    }),
  });
  assert.equal(sent.accepted, true, sent.reason);

  const [item] = await waitForItems(request, token, 1);
  assert.equal(item.from, "Acme Store");
  assert.equal(item.subject, "Order 1042 confirmed <script>alert(1)</script>");
  assert.equal(item.status, "to_attach");
  assert.equal(item.senderVerified, false);
  assert.deepEqual(item.files.map((file) => [file.kind, file.mime]), [["email", "application/pdf"], ["attachment", "application/pdf"]]);

  const email = await fetch(`${state.apiUrl}${item.files[0].uri}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(email.status, 200);
  const pdf = Buffer.from(await email.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const attachment = await fetch(`${state.apiUrl}${item.files[1].uri}`, { headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), invoice);

  // Attaching is a normal ledger save with the file's receipt.
  const { body: snapshot } = await request("GET", "/api/ledger", { token });
  const ledger = snapshot.ledger;
  const file = item.files[1];
  ledger.transactions.push({
    id: `entry-${state.runId}`,
    title: "Groceries",
    kind: "expense",
    total: 1250,
    share: 1250,
    categoryId: ledger.categories.find((category) => category.kind === "expense")?.id ?? ledger.categories[0].id,
    date: new Date().toISOString().slice(0, 10),
    note: "",
    receipt: { id: file.receiptId, name: file.name, mime: file.mime, uri: file.uri },
  });
  const saved = await request("PUT", "/api/ledger", { token, body: snapshot });
  assert.equal(saved.status, 200);
  const [partly] = await inbox(request, token);
  assert.equal(partly.status, "partly_attached");

  // Done drops the rendered email, which nothing links, and keeps the invoice.
  const { body: done } = await request("POST", `/api/receipt-inbox/${item.id}/done`, { token });
  assert.deepEqual(done, { deleted: 1, kept: 1 });
  assert.deepEqual(await inbox(request, token), []);
});
