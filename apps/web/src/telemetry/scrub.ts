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
const CODE_IN_TEXT = /([?#&])(code|token|state)=[^\s&#"'<>`]+/gi;

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
    // Codes and tokens after a path without an origin, such as `/reset-password#code=…` (MAZ-124).
    .replace(CODE_IN_TEXT, "$1$2=<code>")
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

// Session Replay (MAZ-129). Attributes that describe layout or state, never content; every other
// attribute value is masked. The API applies the same list again (ReplayEvent.cs).
const STRUCTURAL_ATTRIBUTES = new Set([
  "class",
  "style",
  "rel",
  "type",
  "role",
  "tabindex",
  "lang",
  "dir",
  "charset",
  "media",
  "width",
  "height",
  "viewbox",
  "preserveaspectratio",
  "xmlns",
  "focusable",
  "d",
  "points",
  "transform",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "fill-rule",
  "clip-rule",
  "disabled",
  "checked",
  "selected",
  "hidden",
  "open",
  "readonly",
  "required",
  "multiple",
  "aria-hidden",
  "aria-expanded",
  "aria-selected",
  "aria-current",
  "aria-checked",
  "aria-pressed",
  "aria-disabled",
  "aria-haspopup",
  "aria-modal",
  "aria-busy",
  "aria-live",
  "aria-invalid",
  "aria-orientation",
  "colspan",
  "rowspan",
  "autocomplete",
  "inputmode",
  "data-theme",
  "rr_width",
  "rr_height",
  "rr_scrollleft",
  "rr_scrolltop",
  "rr_mediastate",
  "_csstext",
]);
const LINK_ATTRIBUTES = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "poster",
]);
// Strings that are page text or what someone typed.
const CONTENT_KEYS = new Set(["textContent", "text", "value"]);

/** Replaces every visible character with `*`, keeping whitespace. */
export function mask(text: string): string {
  return text.replace(/\S/g, "*");
}

function maskAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => {
      if (
        typeof value !== "string" ||
        STRUCTURAL_ATTRIBUTES.has(name.toLowerCase())
      )
        return [name, value];
      if (LINK_ATTRIBUTES.has(name.toLowerCase()))
        return [name, /^data:/i.test(value) ? "data:," : scrubUrl(value)];
      return [name, mask(value)];
    }),
  );
}

function maskNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskNode);
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  const isStyle = node.isStyle === true;
  return Object.fromEntries(
    Object.entries(node).map(([name, entry]) => {
      if (
        name === "attributes" &&
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry)
      )
        return [name, maskAttributes(entry as Record<string, unknown>)];
      if (typeof entry === "string") {
        if (name === "textContent" && isStyle) return [name, entry];
        if (CONTENT_KEYS.has(name)) return [name, mask(entry)];
        if (name === "href") return [name, scrubUrl(entry)];
        return [name, entry];
      }
      if (name === "payload") return [name, null];
      return [name, maskNode(entry)];
    }),
  );
}

/**
 * Masks one rrweb event before Faro sends it: text and typed values (already masked by the
 * recorder's own options, so this is a second line), and the attributes the recorder leaves
 * alone, such as `aria-label`, `title`, `alt`, `placeholder`, ids and data attributes.
 */
export function maskReplayEvent<T>(event: T): T {
  return maskNode(event) as T;
}
