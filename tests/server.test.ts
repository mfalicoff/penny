import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.ts";

test("accounts, two-device sync, conflict protection, receipts, and persistence", async () => {
  const folder = mkdtempSync(join(tmpdir(), "penny-test-"));
  const databasePath = join(folder, "test.sqlite");
  let instance = createApp({ databasePath });
  let server = instance.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  let base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
  ) =>
    fetch(base + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await request("/ledger")).status, 401);
    const register = await request("/auth/register", "POST", {
      email: "a@example.test",
      password: "a secure test password",
    });
    assert.equal(register.status, 201);
    assert.match(register.headers.get("set-cookie")!, /HttpOnly/);
    const { token } = await register.json();
    assert.equal(
      (
        await request("/auth/login", "POST", {
          email: "a@example.test",
          password: "incorrect password",
        })
      ).status,
      401,
    );
    const secondSession = await (
      await request("/auth/login", "POST", {
        email: "a@example.test",
        password: "a secure test password",
      })
    ).json();
    const other = await (
      await request("/auth/register", "POST", {
        email: "b@example.test",
        password: "another secure password",
      })
    ).json();
    const snap1 = await (
      await request("/ledger", "GET", undefined, token)
    ).json();
    const snap2 = await (
      await request("/ledger", "GET", undefined, secondSession.token)
    ).json();
    snap1.ledger.transactions.push({
      id: "dinner",
      title: "Dinner",
      kind: "expense",
      total: 12000,
      share: 6000,
      categoryId: "food",
      date: "2026-09-27",
      note: "",
    });
    const saved = await request("/ledger", "PUT", snap1, token);
    assert.equal(saved.status, 200);
    assert.equal(
      (await request("/ledger", "PUT", snap2, secondSession.token)).status,
      409,
      "stale devices cannot overwrite changes",
    );
    let remote = await (
      await request("/ledger", "GET", undefined, secondSession.token)
    ).json();
    assert.equal(
      remote.ledger.transactions[0].share,
      6000,
      "second device receives first device entry",
    );
    assert.equal(
      (await (await request("/ledger", "GET", undefined, other.token)).json())
        .ledger.transactions.length,
      0,
    );
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const upload = await request(
      "/receipts",
      "POST",
      {
        name: "Dinner.pdf",
        mime: "application/pdf",
        base64: pdf.toString("base64"),
      },
      token,
    );
    assert.equal(upload.status, 201);
    const receipt = await upload.json();
    const downloaded = await request(
      `/receipts/${receipt.id}`,
      "GET",
      undefined,
      secondSession.token,
    );
    assert.equal(downloaded.headers.get("content-type"), "application/pdf");
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
    assert.equal(
      (await request(`/receipts/${receipt.id}`, "GET", undefined, other.token))
        .status,
      404,
    );
    assert.equal(
      (
        await request(
          "/receipts",
          "POST",
          {
            name: "fake.pdf",
            mime: "application/pdf",
            base64: Buffer.from("not a pdf").toString("base64"),
          },
          token,
        )
      ).status,
      400,
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6GQAAAABJRU5ErkJggg==",
      "base64",
    );
    assert.equal(
      (
        await request(
          "/receipts",
          "POST",
          {
            name: "Receipt.png",
            mime: "image/png",
            base64: png.toString("base64"),
          },
          token,
        )
      ).status,
      201,
    );
    remote.ledger.transactions[0].receipt = receipt;
    assert.equal(
      (await request("/ledger", "PUT", remote, secondSession.token)).status,
      200,
    );
    const foreign = await (
      await request("/ledger", "GET", undefined, other.token)
    ).json();
    foreign.ledger.transactions = remote.ledger.transactions;
    assert.equal(
      (await request("/ledger", "PUT", foreign, other.token)).status,
      400,
      "accounts cannot reference another account’s receipt",
    );
    const invalid = await (
      await request("/ledger", "GET", undefined, token)
    ).json();
    invalid.ledger.transactions[0].share = 999999;
    assert.equal((await request("/ledger", "PUT", invalid, token)).status, 400);
    assert.equal(
      (
        await fetch(base + "/ledger", {
          method: "PUT",
          headers: {
            Origin: "https://untrusted.example",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(remote),
        })
      ).status,
      403,
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
    instance.db.close();
    instance = createApp({ databasePath });
    server = instance.app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as any).port}/api`;
    remote = await (await request("/ledger", "GET", undefined, token)).json();
    assert.equal(
      remote.ledger.transactions[0].receipt.id,
      receipt.id,
      "data survives restart",
    );
    assert.equal(
      (await request(`/receipts/${receipt.id}`, "GET", undefined, token))
        .status,
      200,
    );
    assert.equal(
      (await request("/auth/logout", "POST", undefined, token)).status,
      200,
    );
    assert.equal(
      (await request("/ledger", "GET", undefined, token)).status,
      401,
      "logout invalidates session",
    );
    assert.equal(
      (await request("/ledger", "GET", undefined, secondSession.token)).status,
      200,
      "other device stays signed in",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    instance.db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
