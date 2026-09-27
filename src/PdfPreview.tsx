import React from "react";
import * as Sharing from "expo-sharing";
import { Button } from "./ui";
export function PdfPreview({
  source,
  name,
  onError,
}: {
  source: string;
  name: string;
  onError: (message: string) => void;
}) {
  return (
    <Button
      title="Open or share PDF"
      icon="document-outline"
      onPress={async () => {
        try {
          await Sharing.shareAsync(source, {
            mimeType: "application/pdf",
            UTI: "com.adobe.pdf",
            dialogTitle: name,
          });
        } catch {
          onError("Could not open this PDF. Please try again.");
        }
      }}
    />
  );
}
