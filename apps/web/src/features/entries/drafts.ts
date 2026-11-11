import type { EntryDraft } from "./model";

/**
 * The unsaved new-entry draft, per account, kept in memory while the tab is open (MAZ-88). Closing
 * Add entry (Escape, the scrim, Cancel or a page change) keeps what was typed; saving, Discard or
 * signing out clears it. It is never written to storage, so a draft never outlives the tab, and it
 * is keyed by account, so it never reaches another account. A receipt uploaded into the draft (MAZ-94)
 * is kept with it as a link only; the file itself is already on the server, owned by the account.
 */
const drafts = new Map<string, EntryDraft>();

export const draftStore = {
  get: (email: string) => drafts.get(email),
  set: (email: string, draft: EntryDraft) => {
    drafts.set(email, draft);
  },
  clear: (email: string) => {
    drafts.delete(email);
  },
  clearAll: () => {
    drafts.clear();
  },
};

/** Whether a draft holds anything worth keeping. */
export function hasContent(draft: EntryDraft): boolean {
  return Boolean(draft.amount.trim() || draft.title.trim() || draft.note.trim() || draft.shareInput.trim() || (draft.kind === "expense" && draft.receipt));
}
