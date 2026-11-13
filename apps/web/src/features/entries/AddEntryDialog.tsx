import { EntryFormDialog } from "./EntryForm";

/**
 * Add entry (web card `web-add-entry`): a dialog over the current page, opened by the top bar
 * button, N, or a deep link to `/entries/new`. Esc closes it and keeps the draft for next time;
 * ⌘↵ or Ctrl+Enter saves. The form (MAZ-88) writes through the durable offline store.
 */
export function AddEntryDialog({ onClose }: { onClose: () => void }) {
  return <EntryFormDialog target={{ kind: "new" }} onClose={onClose} />;
}
