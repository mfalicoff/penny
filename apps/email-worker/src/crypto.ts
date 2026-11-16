// SHA-256 and HMAC-SHA256 as lowercase hex, with Web Crypto.
const encoder = new TextEncoder();

export function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

export function base64Bytes(value: string): Uint8Array {
  const binary = atob(value.trim());
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function hmacSha256Hex(secret: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}
