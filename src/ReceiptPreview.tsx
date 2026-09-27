import React, { useEffect, useState } from "react";
import { Image, Text } from "react-native";
import { PdfPreview } from "./PdfPreview";
import { type Receipt } from "./model";
import { receiptUrl, releaseReceiptUrl } from "./storage";
import { s } from "./ui";

export function ReceiptPreview({ receipt }: { receipt: Receipt }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let canceled = false;
    let objectUrl = "";
    receiptUrl(receipt)
      .then((url) => {
        objectUrl = url;
        if (canceled) releaseReceiptUrl(url);
        else setSource(url);
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      });
    return () => {
      canceled = true;
      if (objectUrl) releaseReceiptUrl(objectUrl);
    };
  }, [receipt]);
  if (error) return <Text style={s.error}>{error}</Text>;
  if (!source) return <Text style={s.muted}>Opening your receipt…</Text>;
  if (receipt.mime.startsWith("image/"))
    return (
      <Image
        accessibilityLabel="Attached receipt"
        source={{ uri: source }}
        style={{ width: "100%", height: 480 }}
        resizeMode="contain"
        onError={() =>
          setError("This image format cannot be previewed on this device.")
        }
      />
    );
  return <PdfPreview source={source} name={receipt.name} onError={setError} />;
}
