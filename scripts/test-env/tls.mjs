// Throwaway TLS for full-stack runs (MAZ-62, MAZ-265): one self-signed certificate per run,
// made here with Node's own crypto (no openssl needed), for 127.0.0.1 and localhost. The API
// serves HTTPS with it and the local OIDC provider uses the same one, so a simulator or a Node
// runner trusts exactly one file per run (`PENNY_API_CERTIFICATE`, `NODE_EXTRA_CA_CERTS`).
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import tls from "node:tls";

// --- Minimal DER encoding for one self-signed certificate -------------------------
function length(size) {
  if (size < 0x80) return Buffer.from([size]);
  const bytes = [];
  for (let value = size; value > 0; value >>= 8) bytes.unshift(value & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, ...content) => {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const sequence = (...items) => tlv(0x30, ...items);
/**
 * A non-negative DER INTEGER. DER needs the shortest form: no leading 0x00 unless the next byte's
 * top bit is set, so a random serial that starts with 0x00 has to drop it (OpenSSL rejects the
 * padded form as "illegal padding").
 */
export function integer(bytes) {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0 && !(bytes[start + 1] & 0x80)) start += 1;
  const minimal = bytes.subarray(start);
  return tlv(0x02, minimal[0] & 0x80 ? Buffer.concat([Buffer.from([0]), minimal]) : minimal);
}
function oid(text) {
  const [first, second, ...rest] = text.split(".").map(Number);
  const bytes = [40 * first + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}
const time = (date) => tlv(0x17, Buffer.from(`${date.toISOString().slice(2, 19).replace(/[-:T]/g, "")}Z`));
const sha256WithRsa = sequence(oid("1.2.840.113549.1.1.11"), Buffer.from([0x05, 0x00]));

/**
 * A self-signed certificate for 127.0.0.1 and localhost, valid for 30 days. Each one gets its own
 * name: TLS clients find a trusted certificate by its subject, so two runs trusted in one process
 * (or one simulator) must not share it.
 */
export function selfSignedCertificate(commonName = `penny-test-${randomBytes(6).toString("hex")}`) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const name = sequence(tlv(0x31, sequence(oid("2.5.4.3"), tlv(0x0c, Buffer.from(commonName)))));
  const now = Date.now();
  const san = sequence(tlv(0x87, Buffer.from([127, 0, 0, 1])), tlv(0x82, Buffer.from("localhost")));
  const extensions = tlv(0xa3, sequence(
    sequence(oid("2.5.29.17"), tlv(0x04, san)),
    sequence(oid("2.5.29.19"), tlv(0x01, Buffer.from([0xff])), tlv(0x04, sequence())),
    // Server authentication: Apple platforms require it on TLS server certificates.
    sequence(oid("2.5.29.37"), tlv(0x04, sequence(oid("1.3.6.1.5.5.7.3.1")))),
  ));
  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))),
    integer(randomBytes(16)),
    sha256WithRsa,
    name,
    sequence(time(new Date(now - 86_400_000)), time(new Date(now + 30 * 86_400_000))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    extensions,
  );
  const signature = sign("sha256", tbs, privateKey);
  const der = sequence(tbs, sha256WithRsa, tlv(0x03, Buffer.from([0]), signature));
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  new X509Certificate(pem); // Throws if the encoding is wrong.
  return { pem, key: privateKey.export({ type: "pkcs8", format: "pem" }) };
}

/**
 * Writes a new certificate and its key into `directory` (private to the run: 0700, 0600).
 * `trustBundle` is what `NODE_EXTRA_CA_CERTS` points runners at: the run's certificate plus
 * any bundle the caller already had, so exporting it never drops a CA someone relies on.
 */
export function writeCertificate(directory) {
  mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { pem, key } = selfSignedCertificate();
  const certificate = join(directory, "certificate.pem");
  const keyPath = join(directory, "key.pem");
  const trustBundle = join(directory, "trust.pem");
  writeFileSync(certificate, pem, { mode: 0o600 });
  writeFileSync(keyPath, key, { mode: 0o600 });
  const existing = process.env.NODE_EXTRA_CA_CERTS;
  const inherited = existing && existsSync(existing) ? readFileSync(existing, "utf8") : "";
  writeFileSync(trustBundle, `${pem}${inherited ? `\n${inherited}` : ""}`, { mode: 0o600 });
  return { pem, key, certificate, keyPath, trustBundle };
}

const trusted = new Set();
let defaults;

/**
 * Makes this process's TLS clients (including global fetch) trust `pem` as well as the default
 * CAs. NODE_EXTRA_CA_CERTS is read only at start-up, so the runner itself trusts a run this way.
 */
export function trustCertificate(pem) {
  if (!pem || trusted.has(pem)) return;
  if (typeof tls.setDefaultCACertificates !== "function")
    throw new Error("The HTTPS test API needs Node 24.5 or later (tls.setDefaultCACertificates).");
  defaults ??= tls.getCACertificates("default");
  trusted.add(pem);
  tls.setDefaultCACertificates([...defaults, ...trusted]);
}
