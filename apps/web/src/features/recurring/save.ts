import { useState } from "react";
import type { LedgerChange } from "@domain/commands.ts";
import { LedgerSaveError, type SaveReceipt } from "../../offline/engine";
import { useLedgerEngine } from "../../offline/OfflineLedgerProvider";

/** Toast detail for a saved schedule change: on this device only, or on its way to the server. */
export const savedDetail = (receipt: SaveReceipt, online: string) => (receipt.savedOffline ? "Saved on this device. It syncs when you're back online." : online);

/**
 * Saves a schedule change to the durable offline ledger. A refusal (a rule check, storage, signing
 * out) is kept as `error` with the engine's message, which says the draft is still there; nothing
 * changed on this device or the server.
 */
export function useScheduleSave() {
  const engine = useLedgerEngine();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(change: LedgerChange): Promise<SaveReceipt | null> {
    if (!engine) {
      setError("The demo doesn't save changes.");
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      return await engine.save(change);
    } catch (failure) {
      // The banner adds "Your changes are still here.", so the engine's own reminder isn't repeated.
      const message = failure instanceof LedgerSaveError || failure instanceof Error ? failure.message : "This change couldn't be saved.";
      setError(message.replace(/\s*Your draft is still here\.$/, ""));
      return null;
    } finally {
      setSaving(false);
    }
  }
  return { save, saving, error, clearError: () => { setError(null); } };
}
