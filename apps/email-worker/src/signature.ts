import { hmacSha256Hex, sha256Hex } from "./crypto.ts";

// The request signature Penny verifies (InboundMailSignature in the .NET API):
//   penny/inbound-mail/v1 \n <purpose> \n <timestamp> \n <subject> \n <sha256(body) hex>
// `message` signs the recipient local part and the raw MIME; `recipients` signs the
// request path and an empty body, so neither signature can be replayed as the other.
export const SIGNATURE_VERSION = "penny/inbound-mail/v1";
export const RECIPIENTS_PATH = "/api/inbound-mail/recipients";
export const MESSAGE_PATH = "/api/inbound-mail";

export type Purpose = "message" | "recipients";

export async function sign(
  secret: Uint8Array,
  purpose: Purpose,
  timestamp: string,
  subject: string,
  body: ArrayBuffer | Uint8Array,
): Promise<string> {
  const canonical = `${SIGNATURE_VERSION}\n${purpose}\n${timestamp}\n${subject}\n${await sha256Hex(body)}`;
  return hmacSha256Hex(secret, canonical);
}

export function unixSeconds(nowMs: number): string {
  return Math.floor(nowMs / 1000).toString();
}
