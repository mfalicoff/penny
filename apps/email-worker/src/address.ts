// Receipt address local parts (MAZ-184): `r-` and 20 characters of lowercase base32.
// The domain must be the receipts subdomain; case is ignored and `+tag` is dropped,
// exactly like Penny's ReceiptMailAddresses.Normalize.
const LOCAL_PART = /^r-[a-z2-7]{20}$/;

export function receiptLocalPart(recipient: string, domain: string): string | null {
  if (recipient.length > 320) return null;
  const at = recipient.lastIndexOf("@");
  if (at <= 0) return null;
  if (recipient.slice(at + 1).toLowerCase() !== domain.toLowerCase()) return null;
  const local = recipient.slice(0, at).toLowerCase().split("+")[0] ?? "";
  return LOCAL_PART.test(local) ? local : null;
}
