import { File, Paths } from "expo-file-system";
import { type Receipt } from "../domain/ledger";
import { api } from "./api";
export async function saveReceipt(asset: {
  uri: string;
  name: string;
  mime: string;
}): Promise<Receipt> {
  const base64 = await new File(asset.uri).base64();
  return (
    await api("/receipts", {
      method: "POST",
      body: JSON.stringify({ name: asset.name, mime: asset.mime, base64 }),
    })
  ).json();
}
export async function receiptUrl(receipt: Receipt): Promise<string> {
  const response = await api(`/receipts/${encodeURIComponent(receipt.id)}`);
  const file = new File(
    Paths.cache,
    `${receipt.id}.${receipt.mime === "application/pdf" ? "pdf" : receipt.mime.split("/")[1]}`,
  );
  file.create({ overwrite: true });
  file.write(new Uint8Array(await response.arrayBuffer()));
  return file.uri;
}
export function releaseReceiptUrl(_url: string) { }
