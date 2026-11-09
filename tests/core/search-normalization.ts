// Reference implementation of the search v1 text normalization (docs/migration/search.md,
// "Text normalization") used to check the shared fixtures. The legacy app's own local
// search is unchanged; MAZ-73/88 adopt this function in the clients.
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\u03c2/g, "\u03c3")
    .replace(/\u00df/g, "ss")
    .replace(/\p{White_Space}+/gu, " ")
    // Not String.prototype.trim: it also removes U+FEFF, which is not White_Space.
    .replace(/^ | $/g, "");
}
