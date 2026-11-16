import { describe, expect, it } from "vitest";
import { base64Bytes, sha256Hex } from "../src/crypto.ts";
import { receiptLocalPart } from "../src/address.ts";
import { RECIPIENTS_PATH, sign } from "../src/signature.ts";

// The same vectors as Penny's InboundMailSignatureTests (computed independently with
// Node's crypto module), so the Worker and the API cannot drift apart.
export const SECRET = "cGVubnktdGVzdC1zZWNyZXQtMzItYnl0ZXMtbG9uZyEh";
const TIMESTAMP = "1763300000";
const RECIPIENT = "r-abcdefghijklmnopqrst";
const BODY = new TextEncoder().encode(
  "From: shop@example.test\r\nTo: r-abcdefghijklmnopqrst@receipts.example.test\r\nSubject: Receipt\r\n\r\nThanks!\r\n",
);

describe("signature", () => {
  it("matches the pinned message vector", async () => {
    expect(await sign(base64Bytes(SECRET), "message", TIMESTAMP, RECIPIENT, BODY)).toBe(
      "681b1c87d3494cfbf13a35c8b767dacd26ab0e7b7fd30191eb07f5b8a86454c0",
    );
  });

  it("matches the pinned recipient-list vector", async () => {
    expect(await sign(base64Bytes(SECRET), "recipients", TIMESTAMP, RECIPIENTS_PATH, new Uint8Array())).toBe(
      "0b879075ff6a71840aef5f88a237312387f05f0ed556eb88526f8f57a8480792",
    );
  });

  it("hashes local parts like Penny stores them", async () => {
    expect(await sha256Hex(RECIPIENT)).toBe("360101bf5f8fae97694edd98804306edb00193c5ac915068ff9c928cf06dc469");
  });
});

describe("receiptLocalPart", () => {
  it.each([
    ["r-abcdefghijklmnopqrst@receipts.example.test", "r-abcdefghijklmnopqrst"],
    ["R-ABCDEFGHIJKLMNOPQRST@RECEIPTS.Example.Test", "r-abcdefghijklmnopqrst"],
    ["r-abcdefghijklmnopqrst+amazon@receipts.example.test", "r-abcdefghijklmnopqrst"],
    ["r-abcdefghijklmnopqrst@example.test", null],
    ["r-abcdefghijklmnopqrst@evil.receipts.example.test", null],
    ["r-abcdefghijklmnopqrs1@receipts.example.test", null],
    ["postmaster@receipts.example.test", null],
    ["@receipts.example.test", null],
    ["no-at-sign", null],
  ])("%s -> %s", (recipient, expected) => {
    expect(receiptLocalPart(recipient, "receipts.example.test")).toBe(expected);
  });
});
