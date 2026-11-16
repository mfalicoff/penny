# Email Worker (emailed receipts)

The Cloudflare Email Worker for [emailed receipts](../../docs/plans/email-receipts.md) (MAZ-184). Cloudflare Email Routing sends every address on the receipts-only subdomain to this Worker (a catch-all rule). The Worker:

1. Refuses any recipient that isn't `r-<20 lowercase base32>@RECEIPT_DOMAIN` (`+tag` is ignored).
2. Refuses recipients that aren't on Penny's recipient list (SHA-256 hashes of live addresses), which it pulls from `GET /api/inbound-mail/recipients` and caches per isolate: 60 s TTL with `If-None-Match`, one refresh on a miss at most every 10 s, the last good list for up to 1 hour while Penny is unreachable. With no usable list it **fails closed**: it throws, so Email Routing reports a temporary failure and the sender retries.
3. Refuses messages over `MAX_MESSAGE_BYTES` from the declared size, before reading them.
4. Signs the raw MIME (HMAC-SHA256, see `src/signature.ts`) and posts it to `POST /api/inbound-mail`. Penny's `404`, `413` and `429` become SMTP rejects; anything else is a temporary failure.

All parsing, sanitizing and rendering happen in Penny. The Worker stores nothing and logs only outcome codes (`src/log.ts`), never addresses or content. Penny holds no Cloudflare credentials.

## Develop

```bash
npm --prefix apps/email-worker ci
npm --prefix apps/email-worker run lint
npm --prefix apps/email-worker run typecheck
npm --prefix apps/email-worker test
```

The tests run the handler on Node with fake messages and a fake Penny. The signature tests pin the same vectors as the .NET `InboundMailSignatureTests`, so the two sides can't drift. `wrangler dev` needs workerd's install script (`npm install-scripts approve workerd`); tests and `wrangler deploy --dry-run` don't.

## Deploy

1. Put the receipts subdomain (for example `receipts.example.com`) on Cloudflare, enable **Email Routing** for it and let it create the MX records. Use a subdomain that receives nothing else.
2. Make Penny's `/api/inbound-mail` reachable from the Worker without exposing it on the public web hostname. Recommended: a Cloudflare Tunnel (`cloudflared`) to a separate internal hostname that routes only to the API. Alternatively, a hostname protected by Cloudflare Access with a service token (set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`).
3. On Penny, set `InboundMail__Enabled=true`, `InboundMail__Domain` and `InboundMail__WebhookSecret` (`openssl rand -base64 32`).
4. Edit `wrangler.toml` (`PENNY_ORIGIN`, `RECEIPT_DOMAIN`), then:

   ```bash
   cd apps/email-worker
   npx wrangler secret put PENNY_WEBHOOK_SECRET   # the same value as InboundMail__WebhookSecret
   npx wrangler deploy
   ```

5. In Email Routing, add a **catch-all** rule that sends to the `penny-receipt-email` Worker.
6. Keep Workers observability off (it is off in `wrangler.toml`), use an API token scoped to this Worker and zone, turn on 2FA, and set a usage or billing alert for the Worker.

Rotating the secret: set the new value on Penny and the Worker at about the same time; mail in between is retried by the sender.
