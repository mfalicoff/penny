// Reference implementation of the search v1 text normalization (docs/reference/search.md,
// "Text normalization") used to check the shared fixtures. Local search in the clients
// (src/domain/search.ts) is a plain substring match and does no folding.
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
