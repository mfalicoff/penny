import { type Receipt } from "../domain/ledger";
import { api } from "./api";
export async function saveReceipt(asset: {
  uri: string;
  name: string;
  mime: string;
}): Promise<Receipt> {
  const blob = await (await fetch(asset.uri)).blob();
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return (
    await api("/receipts", {
      method: "POST",
      body: JSON.stringify({ name: asset.name, mime: asset.mime, base64 }),
    })
  ).json();
}
export async function receiptUrl(receipt: Receipt): Promise<string> {
  const response = await api(`/receipts/${encodeURIComponent(receipt.id)}`);
  return URL.createObjectURL(await response.blob());
}
export function releaseReceiptUrl(url: string) {
  URL.revokeObjectURL(url);
}
