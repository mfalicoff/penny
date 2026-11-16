# Emailed receipts: design and implementation plan (MAZ-184)

[App showcase](../../README.md) · [Documentation](../README.md) · [Receipts](../reference/receipts.md)

Status: **in progress**. Stage 1 (schema, addresses API, signed ingress, recipient list and the Email Worker in [`apps/email-worker`](../../apps/email-worker/README.md)) stage 2a (parser, sanitizer, `penny-render`, the inbound mail worker and storage: tasks 5 to 7) and stage 2b (the inbox API, states, discard, Done and expiry: task 8 without the push notification) are implemented. The feature stays off (`InboundMail__Enabled=false`) until the clients land. Tracked in [MAZ-184](https://linear.app/mfalicoff/issue/MAZ-184/receive-receipts-by-email-at-a-private-per-user-address).

Each user can get a private receipt address, such as `r-7kq2m9xh4tdw3pzc8vbn@receipts.example.com`. They forward an order confirmation, or send a receipt from their phone, to that address. The server turns each message into a PDF, stores it in the existing encrypted receipt store, and lists it in the user's **receipt inbox**. From the inbox, the user attaches it to a transaction or discards it.

The address is effectively a public drop box. Anyone who learns it can send mail there, and every message is untrusted input from the internet. Most of this design exists to keep that input away from the user's ledger and the API process, and to stop it from reaching the network.

## Goals and non-goals

**Goals**

- One address per user. The user can rotate or revoke it at any time, and it expires on its own.
- Each accepted message becomes one rendered PDF of the email (headers and body). It also produces one receipt for each supported attachment (PDF, JPEG, PNG, WebP, GIF, HEIC, HEIF).
- Results go to an inbox that only the owner can see. Nothing is attached to a transaction until the user does it.
- The design reuses what already exists: the encrypted file store, `ReceiptFormat` checks, the access rules, the OCR worker and push notifications.
- Self-hosters can turn the feature off (the default) and choose how mail reaches the server.

**Non-goals (first version)**

- Automatic attaching, or creating transactions from email without the person. Penny only *suggests* entries, by date (see [UX guidelines](#ux-guidelines-attaching-an-emailed-receipt)). Amount matching from OCR text may come later.
- Household addresses. Receipts reach a household only when a member attaches one to a shared expense, under the [existing access rules](../reference/receipts.md#access).
- Archives (`.zip`, `.rar`), Office documents, `.eml` attachments and calendar files. These are rejected, not converted.
- Sending any mail. Penny never replies, bounces or confirms (see [no outbound mail](#no-outbound-mail)).

## How it works

```
sender ──SMTP──▶ Cloudflare Email Routing ──▶ Email Worker ──signed raw MIME──▶ inbound_messages
                 (or penny-mail, later)        (via Tunnel/Access)              (encrypted, pending)
                                                                                      │
                                                                                      ▼
                                    inbound mail worker (API process, leased)
                                      parse with limits ─▶ sanitize HTML
                                                │
                                                ▼
                                    penny-render (no network, no JS)
                                                │ PDF bytes
                                                ▼
                         ReceiptFormat checks ─▶ encrypted receipt store
                                                │
                                                ▼
                          receipt inbox item ─▶ push "New receipt"
                                                │
                                   user attaches to an entry or discards
```

### 1. Ingress

The supported ingress is a **Cloudflare Email Worker**. A self-hosted SMTP listener is a later, optional alternative for operators who don't use Cloudflare. Both deliver the raw RFC 5322 message to the same signed endpoint, so everything after ingress is shared.

#### Cloudflare Email Worker (default)

Cloudflare Email Routing is the MX for the receipt subdomain. A catch-all rule (`*@receipts.example.com`) sends every message to a small Worker. The Worker refuses any recipient that isn't on Penny's [list of live addresses](#recipient-list), so mail to unknown addresses never reaches Penny. The subdomain is used only for receipts, so the catch-all can't catch anything else. Its source is kept in this repository at `apps/email-worker/` and deployed with Wrangler. Why this fits:

- **No inbound port 25 and no MTA to run.** Residential ISPs often block port 25, and running a public mail server is the hardest part to secure. Cloudflare takes on SMTP, TLS, spam-level abuse and connection floods.
- **Rejects happen during the SMTP session.** The Worker can call `message.setReject()`, so unknown addresses and over-limit senders are refused before anything reaches Penny. Penny never needs to bounce (see [no outbound mail](#no-outbound-mail)).
- **Sender authentication is already done.** Email Routing checks SPF, DKIM and DMARC and records the results in the message headers. Penny reads them for the [sender policy](#sender-policy). Confirm which headers Email Routing actually adds during task 4.
- **No public API needed.** The Worker can reach Penny through a Cloudflare Tunnel, which many self-hosters already run, or through a public hostname protected by Cloudflare Access. Either way, `/api/inbound-mail` doesn't have to be open to the internet.

The Worker is kept **deliberately thin**. It checks the address shape, the recipient list and the size, signs the raw bytes, and forwards them. All parsing, sanitizing and rendering stay in Penny. That keeps the security logic in one tested place, avoids Worker CPU limits on large messages, and keeps the SMTP alternative identical.

```js
// apps/email-worker/src/index.ts (sketch; the implementation adds the recipient list and Access headers)
export default {
  async email(message, env) {
    const local = message.to.split("@")[0].toLowerCase().split("+")[0];
    if (!/^r-[a-z2-7]{20}$/.test(local)) return message.setReject("Unknown address");
    if (!(await isLiveRecipient(local, env))) return message.setReject("Unknown address"); // see Recipient list
    if (message.rawSize > Number(env.MAX_MESSAGE_BYTES)) return message.setReject("Message too large");

    const body = await new Response(message.raw).arrayBuffer();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmac(env.PENNY_WEBHOOK_SECRET, timestamp, local, body);

    const res = await fetch(`${env.PENNY_ORIGIN}/api/inbound-mail`, {
      method: "POST",
      headers: {
        "Content-Type": "message/rfc822",
        "X-Penny-Recipient": local,
        "X-Penny-Timestamp": timestamp,
        "X-Penny-Signature": signature,
        // plus CF-Access-Client-Id / -Secret when the origin sits behind Cloudflare Access
      },
      body,
    });
    if (res.status === 404) return message.setReject("Unknown address");
    if (res.status === 429) return message.setReject("Try again later");
    if (!res.ok) throw new Error(`Penny returned ${res.status}`); // Email Routing reports a temporary failure, so the sender retries
  },
};
```

Secrets (`PENNY_WEBHOOK_SECRET` and any Access service token) are Wrangler secrets, never in `wrangler.toml`. The Worker logs only status codes, never addresses or content. Turn off Workers observability log sampling for request bodies.

#### Recipient list

The Worker keeps a copy of the hashes of live addresses, so it can refuse unknown recipients before calling Penny. **Penny holds no Cloudflare credentials.** The Worker pulls the list from Penny, and Penny never pushes to Cloudflare.

- **Endpoint:** `GET /api/inbound-mail/recipients`. It is signed with the same secret, but the HMAC covers a distinct purpose label (`recipients` instead of `message`), the timestamp and the path, so a signature for one call can't be replayed as the other. The response holds `{ version, generatedAt, hashes: [...] }`: the SHA-256 of each live local part, which is the value Penny already stores. It has no user ids, no counts per user and no expiry dates. A leaked copy doesn't reveal any address, because each hash comes from a 100-bit random token.
- **Caching:** the Worker keeps the list in memory for 60 s (`RECIPIENT_LIST_TTL_SECONDS`) and sends `If-None-Match: <version>`, so an unchanged list is a `304`. Each Worker isolate has its own copy. That's fine at this size: 10,000 addresses is about 640 KB of hex. A Bloom filter can replace the list if it ever grows too large.
- **New addresses:** when a hash isn't in the cached list and the list is more than 10 s old, the Worker refreshes it once before refusing. A brand-new address therefore works within seconds, and a flood of unknown recipients causes at most one refresh every 10 s per isolate.
- **Penny unreachable:** the Worker uses the last good list for up to 1 hour. If the list is older than that, or there never was one, the Worker throws, and Email Routing reports a temporary failure so the sender retries. It never *fails open*, which would mean forwarding everything because it can't check.
- **Revocation is still immediate.** The list only filters noise. Penny checks every forwarded message against its own database, so a revoked or expired address is refused even while a Worker still has it cached.

#### Signed endpoint

`POST /api/inbound-mail` accepts the raw MIME (`message/rfc822`). The signature is HMAC-SHA256 over the purpose label `message`, the timestamp, the recipient and the body, keyed with `InboundMail__WebhookSecret`. Timestamps more than 5 minutes off are rejected, and a seen-signature cache blocks replays. Only the Worker and `penny-mail` hold the secret, so the endpoint can answer honestly: `404` for an unknown, revoked or expired address and `429` over a limit. The Worker turns those into SMTP rejects. An unsigned or badly signed request always gets a plain `401`, whatever the address.

#### SMTP listener (optional, later)

For operators who don't use Cloudflare, `penny-mail` is a small receive-only SMTP container. It accepts mail only for `InboundMail__Domain`, never relays, offers STARTTLS, and calls the same signed endpoint over the internal network.

Checks at the endpoint, before anything is stored:

- **Recipient lookup.** The local part is hashed (SHA-256, like session tokens) and looked up among live addresses.
- **Size.** The raw message can be at most 25 MiB (`InboundMail__MaxMessageBytes`). The Worker rejects larger mail from `message.rawSize` before reading it, and the endpoint enforces the limit again on the request body.
- **Rate limits per address.** The defaults are 20 messages per hour and 100 per day. A per-user cap on pending inbox items (default 200) and a global cap on the pending queue also apply. Mail over a limit gets `429`, which the Worker turns into an SMTP reject, and nothing is stored.
- **Authentication results** (SPF, DKIM, DMARC) are recorded from the headers Cloudflare Email Routing (or `penny-mail`) adds. Penny trusts these headers only on signed requests, and only the copy added by its own ingress, never one the sender included. They feed the optional sender allowlist (see [sender policy](#sender-policy)).

The raw message is sealed with the receipt encryption scheme, using its own HKDF `info` (`penny/inbound-mail/v1`). It is written to `Receipts__Root/inbound/` with a `pending` row in `inbound_messages`, following the receipt store's write order (file first, then the row). Ingress does no parsing at all.

### 2. Parsing (inbound mail worker)

A new leased worker, `InboundMail__Worker`, claims pending messages the same way the OCR and push workers do. It parses with MimeKit using strict limits. Exceeding any limit rejects the message, and the reason is recorded.

| Limit | Default |
| --- | --- |
| MIME nesting depth | 8 |
| MIME parts | 50 |
| Header block | 64 KiB |
| Decoded attachment size | 10 MiB each (the receipt limit) |
| Total decoded size | 40 MiB |
| HTML body | 2 MiB |
| Wall-clock per message | 60 s |

Steps:

1. **Choose the body.** Prefer `text/html`, then fall back to `text/plain`. For a forwarded message, render the outer body. That body already contains the quoted original, which is usually the receipt.
2. **Collect attachments.** An attachment is kept only when its declared type is one of the receipt types and its **bytes match that type's signature** (`ReceiptFormat`). Anything else, including a "PDF" that is really an executable, is dropped and listed on the cover page as "not imported". Filenames are cleaned (control and bidi characters, path separators and NUL are removed; at most 255 characters, keeping the extension) and used only as display names.
3. **Sanitize HTML** with an allowlist sanitizer (for example HtmlSanitizer/AngleSharp):
   - Remove `script`, `style` URLs, `iframe`, `object`, `embed`, `form`, `input`, `meta refresh`, `base`, `link`, SVG and MathML, all `on*` attributes, and `javascript:`, `data:` (except images re-encoded by step 4), `file:` and `http(s):` resource URLs.
   - Keep links as plain text only (`href` is removed), so the PDF holds no clickable trackers or phishing links.
   - **Remote images are never fetched.** Fetching them would reach attacker-chosen hosts from the server (SSRF) and tell the sender the receipt was opened (tracking pixels). They are replaced with a "remote image not loaded" placeholder.
4. **Inline images** (`cid:` parts) are decoded and kept only if they pass the image signature check. They are re-encoded through libvips to PNG (stripping metadata and odd encodings) and embedded as `data:` URLs.
5. **Plain text** is HTML-escaped and wrapped in a `<pre>` template, so both kinds of body go through one renderer.
6. A fixed **cover header** is prepended from parsed, escaped fields: From, To, Date, Subject, the authentication summary, and the list of imported and skipped attachments.

### 3. Rendering to PDF (`penny-render`)

HTML-to-PDF is the riskiest step, because it runs a layout engine on hostile input. Even after sanitizing, it is isolated.

- It runs in a **separate container**, not in the API. The suggested engine is headless Chromium (for example via Gotenberg) with **JavaScript disabled**, or WeasyPrint, which has no JavaScript engine.
- The container is attached only to an `internal: true` Compose network that **has no route out**. It can't reach the internet, PostgreSQL or the API's other ports. The API calls it, and it never calls back. A URL deny-all rule inside the renderer is a second layer, not the only one.
- It has a read-only root filesystem, no capabilities, `no-new-privileges`, a non-root user, memory and CPU limits, and a tmpfs for scratch. It is restarted on crash.
- Each render has a 30 s timeout and a page limit (default 50 pages). The output can be at most 10 MiB, or it is rejected as "too large to convert".
- The returned bytes go through `ReceiptFormat` like any upload (`%PDF-` signature, size). They are stored with `ReceiptService`, so encryption, owner binding and OCR queueing all work as they do for uploads.

On NixOS, the module runs the renderer as a separate systemd unit with `PrivateNetwork=yes`, `DynamicUser`, `ProtectSystem=strict` and a syscall filter.

### 4. The receipt inbox

- `receipt_inbox_items` links one inbound message to its receipts (the rendered email PDF and each attachment). It stores the sender, subject and received date, encrypted with the receipt scheme, because a subject line can be personal.
- Inbox items are **private to the owner**. Their receipts belong to the owner, so the existing rules apply without change. Attaching a receipt to a shared expense is the only way a household member gains access, as with an upload.
- Attaching uses the normal entry and shared expense save with `receiptId`. No new attach endpoint exists, so offline edits, revision checks and household rules work unchanged. When a save that the server accepts links an inbox receipt, the server updates the item's state in the same transaction (see [inbox states](#inbox-states)).
- **Unlinking returns the file to the inbox.** When an inbox receipt loses its last link (removed or replaced on an entry, or the entry deleted), its item goes back to *To attach*, and its expiry restarts at 30 days. The file is not lost and can be attached somewhere else.
- **Discard** deletes the inbox item and its *unlinked* receipts: the file, the row and the OCR text. Today there is no receipt delete. This adds one only for receipts that came from an inbox item and are linked nowhere, checked in the same transaction as the delete.
- An unhandled item expires after 30 days (`InboundMail__InboxRetentionDays`) and is deleted the same way.
- A new item sends a push notification ("New receipt from <sender display name>") through the existing outbox, if the user has push enabled. The notification includes no subject or amounts.
- Subjects, sender names and filenames are shown in the clients as **text only**. They are never interpreted as HTML or Markdown.

### 5. Addresses

- **Format:** `r-<20 characters of lowercase base32>@<domain>`, which is about 100 bits of randomness. That is enough that guessing is not a practical attack. The prefix keeps the rest of the domain free for other uses. The domain is lowercased and matched case-insensitively, and plus-addressing (`r-…+anything`) maps to the same address.
- **Storage:** only `SHA-256(local part)` is stored, like session and invite tokens. The full address is shown to the user once and can be shown again from the stored encrypted copy, so the user can copy it later.
- **Lifetime:** an address expires after 90 days by default (`InboundMail__AddressLifetimeDays`), and the user can extend it. **Rotate** issues a new address and revokes the old one immediately. **Revoke** turns the feature off for that user. A user has at most one live address.
- **Account lifecycle:** deleting an account or disabling a user revokes the address and purges pending messages and inbox items.

### Sender policy

An address alone means *anyone who knows it* can fill the inbox. That is acceptable only because the inbox never changes the ledger by itself. Users who want more can turn on an **allowed senders** list:

- A message is accepted only when the `From` domain passes DMARC (aligned SPF or DKIM) **and** the address or domain is on the list. A `From` header alone is trivially forged, so it is never trusted on its own.
- Forwarding often breaks SPF, while DKIM usually survives. When a message is forwarded from the user's own mailbox, the forwarder's DKIM signature (for example Gmail or iCloud) is what passes. The UI explains this, and suggests adding the user's own address.
- Rejected mail is dropped and counted. No inbox item and no bounce are created.

## Threat model

| Threat | Impact | Mitigation |
| --- | --- | --- |
| Address leaks (forwarded thread, shared screenshot, breach at a merchant) | Spam or junk filling the inbox; a convincing fake "receipt" | Inbox is staging only, so nothing is attached automatically. Rate limits and inbox caps. Rotate and revoke in one tap. Expiry. Optional DMARC-backed sender allowlist |
| Address guessing or enumeration | Discovery of live addresses | 100-bit tokens, so a reject at SMTP time reveals nothing useful. Unknown recipients are refused by the Worker from the recipient list and never reach Penny. They are not logged with the local part |
| Junk flood on the catch-all | Uses up the Worker's request quota (or plan spend), so receipt mail is delayed or refused | Accepted risk, kept small: the subdomain serves only receipts, so nothing else is affected. Unknown recipients are refused before the body is read. List refreshes are rate-limited. Set a Cloudflare usage or billing alert. Per-address rules (no catch-all) were considered and rejected, because they would put a zone-wide mail-routing token in Penny |
| Recipient list leaks (Worker compromise, logs) | Attacker learns how many addresses exist | Only SHA-256 hashes of 100-bit tokens, with no user ids. The list is never logged. The endpoint needs the HMAC secret |
| Forged sender (`From` spoofing) | User trusts a fake receipt | Authentication results shown on the cover page and in the inbox ("Sender not verified"). Allowlist requires DMARC pass |
| Endpoint forgery or replay | Anyone can inject mail for any address | HMAC signature over timestamp, recipient and body, a 5-minute window, a replay cache, and a secret held only in Wrangler secrets and Penny's secret manager. The endpoint is reached through a Cloudflare Tunnel or behind Cloudflare Access, so it isn't public |
| Compromised Cloudflare account or Worker | Attacker can inject or read receipt mail | Separate API token scoped to the Worker and zone, 2FA on the account, and the Worker source reviewed in this repository. Even then, injected mail only reaches the inbox |
| Open relay (`smtp` mode) | Server abused to send spam | Receive-only listener: no `AUTH` and no relay. Accepts only `RCPT TO` in the configured domain. No outbound SMTP code at all |
| Malicious HTML (scripts, CSS exploits, renderer bugs) | Code execution in the renderer | Allowlist sanitizer, JavaScript off, a separate container with no network or credentials and a read-only filesystem, and time and memory limits |
| SSRF through remote resources (`<img src="http://169.254.169.254/…">`, CSS `url()`, `file://`) | Access to internal services or cloud metadata, or local files read into the PDF | Remote and `file:` URLs removed by the sanitizer. The renderer has no network route. Inline images only from `cid:` parts after re-encoding |
| Tracking pixels and link trackers | Sender learns when and where the receipt was processed | No remote fetch, ever. Links flattened to text |
| MIME or zip bombs, deep nesting, huge headers | Worker memory or CPU exhaustion | Ingress size cap. Parser limits on depth, parts, headers and decoded size. Archives never expanded. A per-message deadline. Parsing happens in the worker, not in the request path |
| Malicious attachments (a PDF with JavaScript or launch actions, polyglot files, wrong extensions) | Harm when the user opens the original in a desktop viewer | Signature check against the declared type, and only receipt types are kept. Web preview uses pdf.js with scripts off, and downloads keep `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff` (as today). Optional *flatten* mode (open question): rasterize attachment PDFs with `pdftoppm` and rebuild them, which removes active content |
| Parser vulnerabilities (MimeKit, libvips, poppler) | Code execution in the API worker | Pinned, patched versions tracked by Dependabot. libvips and poppler already run as separate processes for OCR. Moving parsing into `penny-render` is an option if the risk is judged too high |
| Storage exhaustion | Disk fills and every receipt write fails | Per-user pending caps, a global queue cap, retention for unhandled items and failed raw messages, and a disk-usage metric with an alert ([observability](../self-hosting/observability.md)) |
| Header or display injection (CRLF, bidi overrides, HTML in subject or filename) | Misleading UI, XSS in clients | Header values decoded and control and bidi characters removed. Everything shown as text. Cover page built from escaped values |
| Mail-loop or backscatter | Penny attacks third parties, or confirms that an address is live | Penny sends no mail of any kind: no bounces, auto-replies or confirmations. Rejections happen during the SMTP session (`setReject` in the Worker), never as a later bounce |
| Sensitive data in logs and telemetry | Personal or financial data in Loki or Tempo | Logs contain only ids, sizes, counts, status and reason codes. Never addresses, subjects, senders, bodies or filenames, matching the existing receipt logging rule. Traces carry no message content |
| Cloudflare sees mail | Privacy | Documented trade-off: Cloudflare handles each message in transit (as it already does for proxied traffic). The Worker stores nothing. Use `penny-mail` to avoid it. Penny itself stores the content only encrypted |
| Household leakage | A member sees another member's receipts | Inbox items and their receipts are owner-only. Sharing happens only through an explicit attach, under existing rules |
| Stale data | Raw messages kept longer than needed | Raw MIME is deleted as soon as processing succeeds. Failed or rejected raw messages are kept for at most 7 days for diagnosis, then deleted |

### No outbound mail

Penny never sends mail in reply to inbound mail. A bounce or "receipt received" reply would turn the address into a way to send spam to forged senders (backscatter). It would also confirm to whoever sent the message that the address works. The user learns the result from the inbox and push notifications.

## Data model (PostgreSQL)

| Table | Columns (main) |
| --- | --- |
| `receipt_mail_addresses` | `id`, `user_id`, `local_part_hash` (unique), `address_encrypted`, `created_at`, `expires_at`, `revoked_at`, `last_received_at`, `allowed_senders` (encrypted JSON) |
| `inbound_messages` | `id`, `address_id`, `user_id`, `received_at`, `size_bytes`, `sha256` (de-duplicates resends per user), `auth_results` (spf/dkim/dmarc enums), `status` (`pending`, `processing`, `done`, `rejected`, `failed`), `reason_code`, `lease_owner`, `lease_expires_at`, `attempts`, encryption fields for the raw file |
| `receipt_inbox_items` | `id`, `user_id`, `inbound_message_id`, `subject_encrypted`, `from_encrypted`, `received_at`, `status` (`to_attach`, `partly_attached`, `attached`, `discarded`, maintained by the server from receipt links), `attached_at`, `expires_at` |
| `receipt_inbox_receipts` | `inbox_item_id`, `receipt_id`, `kind` (`email`, `attachment`), `position` |

The runtime role gets only the grants it needs. A unique `(user_id, sha256)` index means the same message forwarded twice creates one item.

## API (all new, session required except ingress)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/receipt-email` | The current address, its expiry, the sender policy, and whether the feature is enabled on this server |
| POST | `/api/receipt-email` | Create, or rotate (revokes the old address) |
| PATCH | `/api/receipt-email` | Extend the expiry, or edit the allowed senders |
| DELETE | `/api/receipt-email` | Revoke |
| GET | `/api/inbound-mail/recipients` | For the Worker. HMAC-signed with the `recipients` purpose label, and no session. The hashes of live local parts, with `version` and `If-None-Match`/`304` support. Rate-limited, and not routed by the public `web` proxy |
| GET | `/api/receipt-inbox` | List items (newest first, paginated) with their receipt ids |
| DELETE | `/api/receipt-inbox/{id}` | Discard an item and its unlinked receipts |
| POST | `/api/inbound-mail` | Ingress from the Worker or `penny-mail`. HMAC-signed and no session. `202` accepted, `404` unknown address, `429` over a limit, `401` bad signature. Excluded from the browser origin check, and not routed by the public `web` proxy (see [deployment](#configuration-and-deployment)) |

Receipt bytes are still served by `GET /api/receipts/{id}`. The operations go into `contracts/` OpenAPI, and the iOS and web clients are generated from it as usual.

## Configuration and deployment

| Setting | Default | Notes |
| --- | --- | --- |
| `InboundMail__Enabled` | `false` | When this is false, the routes return 404 and no worker starts |
| `InboundMail__Domain` | — | For example `receipts.example.com`. Use a dedicated subdomain with its own MX, so the main domain's mail is unaffected |
| `InboundMail__WebhookSecret` | — | Base64 of 32 random bytes, from the secret manager. The same value is set as the Worker's `PENNY_WEBHOOK_SECRET` (and given to `penny-mail` if used) |
| `InboundMail__MaxMessageBytes` | `26214400` | 25 MiB |
| `InboundMail__AddressLifetimeDays` | `90` | |
| `InboundMail__InboxRetentionDays` | `30` | |
| `InboundMail__Worker` | `true` | Same pattern as the other workers |
| `InboundMail__RendererUrl` | `http://penny-render:3000` | Internal network only |

- **Compose:** `penny-render` runs under profile `email-receipts`, on a new `render` network with `internal: true`, shared only with `api`. The public `web` nginx does **not** forward `/api/inbound-mail`. The Worker reaches it through a `cloudflared` tunnel to a separate internal hostname, or through a proxy route behind Cloudflare Access. If the optional `penny-mail` is used, it runs under profile `email-receipts-smtp` and is the only new published port (25).
- **Cloudflare:** the receipt subdomain's DNS on Cloudflare with Email Routing enabled, a catch-all rule to the Worker, and the Worker deployed from `apps/email-worker/` with `wrangler deploy` and `wrangler secret put`. The self-hosting guide walks through it.
- **NixOS:** the `services.penny.inboundMail` options map one-to-one to these settings. The renderer runs as a hardened unit, as described above.
- **DNS:** Email Routing creates the `MX` records for the subdomain (or point them at `penny-mail`). No SPF or DKIM records are needed, because Penny sends nothing.
- **Metrics:** messages accepted, rejected (by reason), rendered and failed, the queue depth, render duration, and inbox size. Dashboards and alerts are added through `scripts/grafana-dashboards.mjs`.

## UX guidelines: attaching an emailed receipt

These rules apply to both web and iOS. They extend the current receipt behaviour ([browser receipts](../web/receipts.md), [native receipts](../ios/receipts.md)) and don't replace it: an emailed receipt is an ordinary receipt that arrived by another route.

### Principles

1. **The person attaches, Penny never does.** Nothing is linked automatically, not even to an obvious match. Penny may *suggest* entries, but every link takes an explicit tap or click.
2. **Always look before attaching.** Every place that attaches an emailed receipt shows it first: a thumbnail of the first page, and the full viewer one tap away. A person should never attach a file they haven't seen.
3. **Nothing is lost by mistake.** Attaching, replacing and removing are all reversible. Only **Discard** deletes, and it always asks first.
4. **Say who will see it.** Attaching to a shared expense makes the receipt visible to that household, and Penny says so before the link is saved.
5. **Same rules as uploads.** One receipt per expense. Expenses only, not income or investments. Ownership and household rules are unchanged.

### Where attaching starts

| Starting point | Flow |
| --- | --- |
| **Receipt inbox › item › Attach to…** | Opens the *attach sheet* (below). This is the main route. |
| **Receipt inbox › item › New expense** | Opens Add entry as an expense with the receipt already attached. The date is the day the email was received, in the person's time zone, and the title is the sender's display name (for example "Acme Store"). Both are editable, and the amount is left empty. |
| **Entry form › Receipt › From inbox** | A third source next to Photo and File or PDF, shown only when the server has the feature on and the inbox has items. It opens the inbox as a picker. Choosing a file attaches it to the form, the same way a finished upload does, with no upload step. |
| **Push notification** "New receipt from Acme Store" | Opens that inbox item. It never attaches anything by itself. |

### The receipt inbox

- **Entry point:** a **Receipts to attach** row with a count badge. On iOS it sits on the home screen when the count is above zero, and in Settings. On the web it's in the sidebar. With the feature off, or before an address exists, nothing is shown except the Settings row that sets it up.
- **Rows,** newest first: sender display name, subject (one line, truncated), received date, the number of files, and a **Sender not verified** badge when DMARC didn't pass. All text is shown as plain text.
- **Item detail:** the files in order. The rendered email comes first, labelled **Email**. Each attachment follows under its file name. Each file shows its kind and size, and opens in the existing viewer.
- **Filters:** *To attach* (the default) and *Attached* (the last 30 days, for finding something you just linked).
- **Swipe and keyboard:** on iOS, swipe a row for **Discard**. On the web, rows are focusable, Enter opens one, and Delete offers Discard (with the same confirmation).

### The attach sheet

1. **Which file.** When an item has several files, the sheet asks which one to attach. It preselects the first attachment if there is one, because a merchant's PDF invoice is usually the real receipt. Otherwise it preselects the rendered email. A one-file item skips this step.
2. **Which entry.** There are two lists:
   - **Suggested:** expenses without a receipt, dated up to 7 days either side of the received date, nearest date first, at most 5. Personal and shared expenses both appear, and shared ones show the household name. Suggestions come only from the date in the first version. Matching on the amount from OCR can come later, and even then it only reorders the list.
   - **Search:** the existing entry search across all expenses, including ones that already have a receipt.

   Income, investments, and shared expenses in households the person has left are not offered.
3. **Confirm.** One sheet shows the file thumbnail and the entry card (category icon, title, total, date), then **Attach**. It adds a line in these cases:
   - **Shared expense:** "Members of Flat 4B will be able to see this receipt."
   - **Entry already has a receipt:** "This replaces *invoice-0412.pdf*. The current receipt stays in Penny and can be attached again." Replacing an inbox receipt sends it back to the inbox. An uploaded receipt is unlinked, as happens today.
   - **Sender not verified:** "Penny couldn't verify who sent this email. Check the receipt before attaching it." This is a warning only and doesn't block attaching.
4. **Done.** A confirmation reads "Receipt attached to Coffee at Mill St." with **View entry** and **Undo**. It stays until dismissed, or for 8 seconds on the web. Undo removes the link and returns the file to the inbox. The sheet closes, and focus returns to the inbox row, or to the next row if the item left the list.

### Inbox states

| State | When | Shown in |
| --- | --- | --- |
| **To attach** | No file of the item is linked anywhere | *To attach* |
| **Partly attached** | Some files are linked, others aren't (for example an email with two invoices) | *To attach*, with "1 of 2 attached". The item detail marks each linked file with the entry it's on |
| **Attached** | Every file is linked, or the person chose **Done** on a partly attached item. Done discards the unlinked files, with the same confirmation as Discard | *Attached* for 30 days, then hidden. The receipts stay on their entries |
| **Discarded** | The person discarded it, or it expired | Nowhere. Its unlinked files are deleted |

The rendered email of a partly attached item counts as a file. People who attach only the invoice can tap **Done** to drop the email PDF.

### Removing and discarding

- **Removing** an emailed receipt from an entry (× in the form, or the viewer's trash) works as it does today. The file goes back to the inbox, and the form's hint says so: "The receipt goes back to your inbox."
- **Discard** asks "Discard this email? Its 2 files will be deleted. This can't be undone." Its buttons are **Discard** (destructive) and **Cancel**. Files already linked to an entry are never deleted, and the dialog says how many will be kept.
- **Expiry:** items that aren't attached show "Deleted in 3 days" for their last 3 days. Penny doesn't send a notification about expiry.

### Offline, errors and sessions

- The inbox and the attach sheet need a connection, like uploads. Offline, the inbox row and **From inbox** are disabled with the existing "connect to attach receipts" hint.
- **Attaching to a personal entry** is a ledger edit. It is saved locally and syncs like any other change, so it can finish later. Until the sync, the inbox shows the item as "Attaching…". If the sync is refused (for example the entry was deleted on another device), the item returns to *To attach* and the sync banner explains why.
- **Attaching to a shared expense** needs a connection, as all shared expense edits do. A revision conflict (409) reloads the expense and shows the confirm step again with the new values.
- **A file that's no longer available** (discarded on another device, or expired) shows the existing "This receipt isn't available" state, and the item disappears from the list on refresh.
- An ended session (401) behaves as it does elsewhere: sign in, and the draft or the open inbox item comes back.

### Settings › Receipt email

- Shows the address in a monospace field with **Copy**, plus **Share** on iOS (to send it to yourself or save it to Contacts), its expiry date, and **Extend**, **New address** and **Turn off**.
- **New address** says "Your current address stops working right away." **Turn off** says "Mail sent to this address will be refused. Receipts already in your inbox stay there."
- **Allowed senders** is a list editor with a short explanation: "Only email that passes sender verification from these addresses reaches your inbox. If you forward receipts, add the address you forward from."
- A short how-to: "Forward a receipt email to this address, or send a photo of a paper receipt to it. It shows up in Receipts to attach within a minute."

### Accessibility and copy

- Every new control has a spoken label. Examples: "Attach Email PDF to Coffee at Mill St., 4.50 dollars, 12 November". The not-verified badge reads as "Sender not verified". The inbox count reads as "3 receipts to attach".
- Thumbnails are decorative for VoiceOver and screen readers. The file name and kind carry the meaning.
- Dynamic Type and 44 pt targets on iOS. On the web, keyboard-only use with visible focus, and focus returns to the opener after every sheet, as the existing receipt dialogs already do.
- The copy avoids "email" jargon in buttons. Use **Attach**, **New expense**, **Discard** and **Done**. Use "receipt" for the file and "email" only for the inbox item.

### Design specimens

New cards are added to the design baseline ([visual acceptance](../design/visual-acceptance.md)) for iPhone, iPad and web, in light and dark: `receipt-inbox`, `receipt-inbox-item`, `receipt-attach-sheet` (the file step, the entry step and the confirm step, including the shared and replace notes), `receipt-attached-toast` and `receipt-email-settings`.

## Implementation tasks

| Task | Work | Done when |
| --- | --- | --- |
| **1. Threat model review** | Review this page, decide the [open questions](#open-questions), and record the decisions here | Signed off, with each mitigation linked to a task |
| **2. Schema and migration** | The four tables, indexes, grants, and an encryption `info` string for raw mail and inbox fields | Migration applies and rolls forward from a production copy. `receipts-verify` and `receipts-sweep` understand `inbound/` |
| **3. Addresses API** | Create, rotate, extend, revoke, hashing, expiry, rate-limited creation | Integration tests cover rotation revoking the old address, expiry, and one live address per user |
| **4. Ingress endpoint and Email Worker** | Signed endpoint (HMAC, replay window, size cap, recipient lookup, rate limits, encrypted raw write). The recipient list endpoint and the Worker's cached, fail-closed copy of it (TTL, refresh on miss at most every 10 s, last-good list for 1 h). The Worker in `apps/email-worker/` with Wrangler config, `setReject` mapping, and tests with Miniflare or `wrangler dev`. Confirm which authentication-result headers Email Routing adds | Forged, replayed, oversized, unknown-address and over-limit requests store nothing. Unknown recipients are refused without a call to Penny's message endpoint. A new address works within seconds, a revoked one is refused even from a stale list, and the Worker refuses mail when Penny has been unreachable for over an hour. A real message forwarded from Gmail and iCloud reaches the inbox in a staging zone |
| **5. Parser and sanitizer** | MimeKit limits, body choice, attachment filtering, HTML allowlist, `cid:` re-encode, cover header | A malicious-mail corpus (script, CSS `url()`, `file://`, metadata IP, nested bombs, polyglots, bidi filenames) produces safe output or a recorded rejection |
| **6. Renderer container** | `penny-render` image, internal network, hardening, timeouts, page and size caps | A test proves the renderer cannot open an outbound connection. Rendering the corpus never fetches a URL |
| **7. Worker and storage** | Leased worker, `ReceiptService` storage, OCR queueing, de-duplication, raw deletion, retention sweeps | Crash mid-message is retried once the lease expires, with no duplicate items. Raw MIME is gone after success |
| **8. Inbox API and discard** | List, discard (unlinked-only delete), **Done**, expiry, push notification, and item-state updates from ledger and shared expense saves (link, unlink, replace, entry deleted) | Discarding a receipt that is linked anywhere keeps it. Unlinking returns the item to *To attach*. Household members never see another member's inbox |
| **9. SMTP ingress (optional)** | `penny-mail` receive-only listener, STARTTLS, `SIZE`, domain-only `RCPT` | An open-relay test suite passes. Unknown recipients get `550` |
| **10. Design specimens** | The cards listed under [design specimens](#design-specimens) | The cards are in the baseline and reviewed for both appearances |
| **11. Web and iOS clients** | Settings, the inbox, the attach sheet, the "From inbox" source, Undo, offline and error states, accessibility, all as in the [UX guidelines](#ux-guidelines-attaching-an-emailed-receipt) | Acceptance journeys: forward a receipt and attach it to a suggested personal expense, attach to a shared expense (with the household note), replace an existing receipt and see it return to the inbox, Undo, discard, attach offline and sync, and rotate the address |
| **12. Ops and docs** | Compose profiles, NixOS options, dashboards, alerts, runbook entries, user help | `node scripts/grafana-dashboards.mjs --check` passes. [Deployment](../self-hosting/deployment.md) and [operations](../self-hosting/operations.md) are updated |

## Open questions

1. **What "temporary" means.** The proposal is a 90-day expiry that the user can extend, plus rotation on demand. Alternatives are single-use addresses (one message, then revoked), or addresses that never expire unless rotated.
2. **Default sender policy.** Open (any sender, inbox-only) or allowlist-on by default. Open is easier to adopt. Allowlist is safer, but breaks some forwarding setups.
3. **Flatten attachment PDFs.** Rasterizing removes active content and polyglots, but loses selectable text (OCR recovers most of it) and makes files larger. This could be on by default, opt-in, or left out.
4. **Renderer engine.** Chromium (best fidelity for marketing-style receipts, larger attack surface) or WeasyPrint (no JavaScript engine, weaker CSS support).
5. **Separate attachments from the email PDF.** The proposal stores each attachment as its own receipt, next to the rendered email. The alternative is merging everything into one PDF, which is simpler to attach but larger and loses the original files.
6. **Tunnel or Access.** Whether the guide recommends a Cloudflare Tunnel (no public origin) or Cloudflare Access in front of an existing public hostname.
7. **Suggestion window.** Whether 7 days either side of the received date is right. Online orders can be charged days after the confirmation email arrives.

## Decisions

| Decision | Why |
| --- | --- |
| **Ingress through a Cloudflare Email Worker** (2026-11-15) | No port 25 or MTA to run. Rejects happen during the SMTP session. Cloudflare checks sender authentication. Penny's endpoint stays behind a Tunnel or Access. The Worker stays thin |
| **Catch-all on a receipts-only subdomain, filtered by a recipient list the Worker pulls from Penny** (2026-11-15) | Unknown recipients never reach Penny, and Penny holds no Cloudflare credentials. Per-address routing rules would have refused unknown mail at Cloudflare, but they need a zone-wide mail-routing token in Penny and have a per-zone rule limit. The remaining risk is a junk flood using up the Worker's quota (see the [threat model](#threat-model)) |
| **Parsing and rendering stay in Penny, not Cloudflare Browser Rendering** (2026-11-15) | The sanitizer and renderer limits stay in this repository's tests. The renderer has no network at all, while Browser Rendering would fetch remote resources from Cloudflare's network. It also avoids extra cost and plan limits |
| **Emailed receipts are never attached automatically** (2026-11-15) | The address is a public drop box, so a person confirms every link (see [UX guidelines](#ux-guidelines-attaching-an-emailed-receipt)) |
| **Open questions 1, 2, 3, 5 and 7 take the proposals** (2026-11-16) | 90-day expiry the user can extend, plus rotation. Open sender policy with an optional DMARC-backed allowlist. No PDF flattening in the first version. Attachments stored as separate receipts next to the email PDF. Suggestions 7 days either side of the received date |
| **Renderer: Gotenberg (headless Chromium, JavaScript off)** (2026-11-16) | Best fidelity for marketing-style receipts. The larger attack surface is contained by the sanitizer and the no-network, read-only container (open question 4) |
| **Tunnel recommended, Access supported** (2026-11-16) | The guide recommends a Cloudflare Tunnel to an internal hostname, so `/api/inbound-mail` has no public origin. The Worker also sends Access service-token headers when they are set (open question 6) |
| **The Worker lives in `apps/email-worker`, in TypeScript** (2026-11-16) | It is deployed code with its own lockfile, lint, types, tests and CI job, like the other apps. Its signature tests pin the same vectors as the API tests |
| **Signature format** (2026-11-16) | HMAC-SHA256, lowercase hex, over `penny/inbound-mail/v1`, the purpose, the timestamp, the subject (recipient or path) and the SHA-256 of the body, joined by newlines. Hashing the body keeps the signed string small for 25 MiB messages |
| **Authentication results are read at parse time** (2026-11-16) | Ingress does no parsing, so `inbound_messages.auth_*` are filled by the inbound mail worker from the topmost authentication header added by the ingress. Which header Email Routing adds must still be confirmed in a staging zone |
| **`GET /api/receipt-email` answers while the feature is off** (2026-11-16) | It reports `enabled: false`, so clients know to hide the feature. The other address operations and both ingress routes answer 404 |
| **An attachment over 10 MiB is skipped, not a rejection** (2026-11-16) | The message-wide limits (depth, parts, headers, 40 MiB decoded, 2 MiB HTML) still reject. One oversized scan shouldn't lose the rest of the email; it is listed on the cover page as not imported |
| **`application/octet-stream` attachments take the type their extension names** (2026-11-16) | Many billing systems send PDFs that way. The bytes must still match that type's signature, so a renamed executable is still dropped |
| **Sender verification trusts only the highest-instance ARC set from the ingress** (2026-11-16) | `ARC-Authentication-Results` with the greatest `i=` and authserv-id `InboundMail__AuthServId` (default `mx.cloudflare.net`). An ARC sealer numbers its set above every set already present, so a sender can't outrank it. Still to confirm in a staging zone |
| **Renderer outages are retried; document problems are rejected** (2026-11-16) | Connection failures and 5xx from penny-render retry with backoff (30 s, 2 min, 8 min), then fail as `render_unavailable`. 4xx, a non-PDF, over 10 MiB or over 50 pages reject. Raw mail of rejected and failed messages is deleted after 7 days |
| **The rendered document also carries a CSP** (2026-11-16) | `default-src 'none'; img-src data:; style-src 'unsafe-inline'`, a third layer after the sanitizer and the renderer's URL deny-list and internal network |
| **Inbox states are refreshed where receipt links change** (2026-11-16) | Every write that links or releases receipts already goes through `ReceiptTextIndex.ApplyAsync` (personal saves, shared expenses and rules, search rebuilds), so the inbox refresh runs there, in the same transaction. A file counts as linked while a personal entry, a live shared expense or a shared rule references it |
| **Expiry restarts from `returned_at`** (2026-11-16) | An unhandled item expires `InboxRetentionDays` after the later of its arrival and the last time it went back to To attach. The refresh records `returned_at` and `attached_at` with the database clock |
| **Done is `POST /api/receipt-inbox/{id}/done`** (2026-11-16) | Task 8 names Done but the API table had no route for it |
| **The new-receipt push names no sender, and ships with the iOS client** (2026-11-16) | Existing push text never names people, merchants or amounts, because it shows on the lock screen; the notification reads "New receipt" instead of "New receipt from Acme Store". The push payload is a household deep link today, so the inbox notification lands together with the iOS handling of its deep link |
