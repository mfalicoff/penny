import type { EntryDraft } from "./model";

/**
 * The unsaved new-entry draft, per account, kept in memory while the tab is open (MAZ-88). Closing
 * Add entry (Escape, the scrim, Cancel or a page change) keeps what was typed; saving, Discard or
 * signing out clears it. It is never written to storage, so a draft never outlives the tab, and it
 * is keyed by account, so it never reaches another account.
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
  return Boolean(draft.amount.trim() || draft.title.trim() || draft.note.trim() || draft.shareInput.trim());
}
