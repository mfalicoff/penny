/**
 * Privacy rules for browser telemetry (MAZ-129). Nothing that leaves the browser may carry
 * credentials, codes, emails, search text, ledger contents or amounts (MAZ-126), so every Faro
 * item passes through `scrubItem` before it is sent:
 *
 * - URLs keep their origin and the shape of their path only. A path segment survives when it is
 *   a lowercase word of letters (`households`, `password-reset`), an API version (`v1`) or a
 *   built asset's file name; anything else, such as a household id, becomes `:id`. Ids made only
 *   of the letters a-f (hex) are caught too. Query strings (search text, the OIDC
 *   `code`, filters) and fragments are always dropped.
 * - Error and log messages keep their wording, but emails, quoted text and numbers are redacted
 *   and URLs inside them are scrubbed as above.
 */

const WORD = /^[a-z]+(?:[-_][a-z]+)*$/;
const HEX = /^[a-f]{8,}$/;
const API_VERSION = /^v\d{1,2}$/;
// Fingerprinted bundles (/assets/index-Bx3a9.js) so stack traces stay readable.
const ASSET = /^[\w.-]+\.(?:js|mjs|css|map|woff2?|ttf|svg|png|json)$/;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>`]+/g;

function scrubPath(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment === "" || (WORD.test(segment) && segment.length <= 32 && !HEX.test(segment)) || API_VERSION.test(segment) || ASSET.test(segment) ? segment : ":id"))
    .join("/");
}

/** Scrubs one absolute or root-relative URL; other strings are returned unchanged. */
export function scrubUrl(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) {
    const end = value.search(/[?#]/);
    return scrubPath(end === -1 ? value : value.slice(0, end));
  }
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    return `${url.origin}${scrubPath(url.pathname)}`;
  } catch {
    return value;
  }
}

/** Redacts user content from free text (an error or log message), keeping its wording. */
export function scrubText(text: string): string {
  return text
    .replace(URL_IN_TEXT, (url) => scrubUrl(url))
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”/g, "<text>")
    .replace(/(?<![\w:/.-])[-+]?\d[\d,.]*(?![\w])/g, "<n>");
}

// Keys whose string values are free text written by the app or the browser.
const TEXT_KEYS = new Set(["value", "message"]);

/**
 * Returns a copy of a Faro transport item (or any part of one) with every URL scrubbed and the
 * free text of exceptions and logs redacted. Numbers, booleans and other values pass through,
 * so timings and web vitals are unchanged.
 */
export function scrubItem<T>(item: T): T {
  return walk(item, undefined) as T;
}

function walk(value: unknown, key: string | undefined): unknown {
  if (typeof value === "string") return key !== undefined && TEXT_KEYS.has(key) ? scrubText(value) : scrubUrl(value);
  if (Array.isArray(value)) return value.map((entry) => walk(entry, undefined));
  if (value && typeof value === "object") {
    // OTLP attributes ({ key, value: { stringValue } }) name the attribute in a sibling field.
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, walk(entry, name === "value" && "key" in value ? undefined : name)]));
  }
  return value;
}
