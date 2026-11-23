# Email delivery (optional)

Penny can send two kinds of email through any SMTP server or provider: **password reset links** and **household and trip invitations**. Email is off by default. A server without email settings works exactly as before: resets use an operator-issued code ([password reset](../reference/authentication.md#password-reset-maz-123)) and people share invite codes themselves.

`GET /api/info` tells the apps which flow to show (`emailEnabled`). With email on, the sign-in screen's "Forgot password?" asks for an email, and a household's Invite can send an email. With it off, the apps offer the reset-code and shared-code flows.

## What Penny sends

| Email | Sent when | Contains |
| --- | --- | --- |
| Reset your password | Someone asks on the sign-in screen and the address has an account | A link to `<Email__AppUrl>/reset-password#code=<code>`. The code works once, for `Auth__PasswordResetHours` (24 by default), and replaces any earlier code, including one from the `reset-password` command |
| Invitation | The creator of a household or trip invites an address, or resends | The household or trip name, the inviter's display name, a link to `<Email__AppUrl>/join#code=<code>` and the code itself. It works once, for `Email__InviteHours` (72 by default). The invitee still accepts it in the app |

Emails are plain text, in English or French (the requester's browser or app language). They contain no amounts, entries or other financial data. Links only point to `Email__AppUrl`, which must be one of `Auth__AllowedOrigins`. Codes are in the URL fragment (after `#`), which browsers never send to a server, so they don't end up in proxy access logs.

Sending happens outside the request. The request stores a row in the `mail_outbox` table, and a background worker sends it, so a slow or failing mail server never blocks or rolls back anything. The outbox row holds no address, link or code: the worker reads the address when it sends and issues the code at that moment. Only a SHA-256 of each code is stored.

## Configure SMTP

Set these in `deploy/api.env` (Compose), in your NixOS module's environment file, or in your platform's secret manager. Keep the password out of the repository and command lines.

| Setting | Default | Notes |
| --- | --- | --- |
| `Email__Smtp__Host` | unset (email off) | Your provider's SMTP host. Setting it turns email on |
| `Email__Smtp__Security` | `starttls` | `starttls` (submission, port 587): the connection must upgrade to TLS or nothing is sent. `tls` (port 465): TLS from the first byte. `none`: plain text, only allowed to a loopback host such as a local relay |
| `Email__Smtp__Port` | 587, 465 or 25 by security | 1–65535 |
| `Email__Smtp__Username`, `Email__Smtp__Password` | unset | Both or neither. The password is a secret: it is never logged, and startup errors never echo it |
| `Email__Smtp__TimeoutSeconds` | 30 | 5–300, per SMTP operation |
| `Email__From` | required | The sender address, for example `penny@example.com`. Use an address on a domain you control (see SPF and DKIM) |
| `Email__FromName` | `Penny` | Display name of the sender |
| `Email__AppUrl` | required | The web app's origin, exactly as listed in `Auth__AllowedOrigins`, for example `https://penny.example.com` |
| `Email__InviteHours` | 72 | 1–336. How long an emailed invitation's code works |
| `Email__RecipientMessagesPerDay` | 5 | 1–1000. Emails one address can receive in 24 hours |
| `Email__AccountMessagesPerDay` | 20 | 1–10,000. Emails one account can cause in 24 hours (invitations it sends, resets for it) |
| `Email__Worker` | `true` | `false` stops this process from sending. Any number of processes may send (leases keep them apart); at least one must |
| `Email__PollSeconds` | 10 | 1–3600. Idle delay between sending passes |

TLS certificates are checked against the system's trusted certificates. A server with a self-signed certificate fails with `smtp:tls`; use a certificate from a public authority, or a local relay on loopback with `Email__Smtp__Security=none` that forwards with TLS.

Invalid settings stop the API before it listens, with a message naming the setting. Email settings without `Email__Smtp__Host` also stop it, so a half-done setup is never silently ignored.

Penny speaks plain SMTP and has no provider-specific code, so any SMTP relay works through these settings alone.

### Example: Cloudflare Email Service

Hosted Penny sends through Cloudflare Email Service. Its SMTP sending is in **beta**, and sending to any recipient (not only your own verified addresses) needs the Workers Paid plan. Follow Cloudflare's [Send emails](https://developers.cloudflare.com/email-service/get-started/send-emails/) guide; in short:

1. The sending domain must use Cloudflare DNS.
2. In the Cloudflare dashboard, open **Compute › Email Service › Email Sending** and **Onboard Domain**. Cloudflare adds the DNS records itself: an MX record for bounces and SPF under `cf-bounce`, DKIM, and DMARC under `_dmarc`. DNS can take up to 24 hours, usually minutes.
3. Create an API token with the **Email Sending: Edit** permission, in the same account that onboarded the domain.
4. Configure Penny with implicit TLS on port 465, the literal username `api_token`, and the token as the password:

```sh
# deploy/api.env (mode 0600)
Email__Smtp__Host=smtp.mx.cloudflare.net
Email__Smtp__Security=tls
Email__Smtp__Port=465
Email__Smtp__Username=api_token
Email__Smtp__Password=…your Cloudflare API token…
Email__From=penny@example.com
Email__AppUrl=https://penny.example.com
```

`Email__From` must be an address on the onboarded domain. Cloudflare also offers a REST API and a Workers binding for sending; Penny uses neither.

### Example: Resend

[Resend](https://resend.com/docs/send-with-smtp) works the same way once its domain verification records are in your DNS: host `smtp.resend.com`, `Email__Smtp__Security=tls` on port 465 (or `starttls` on 587), the username `resend` and a Resend API key as the password.

### Your own mail server

Point `Email__Smtp__Host` at it with `starttls` on 587 (or `tls` on 465) and a mailbox's credentials. A relay on the same machine can be used without TLS: `Email__Smtp__Host=127.0.0.1` and `Email__Smtp__Security=none`.

## SPF, DKIM and DMARC

Mail from your domain is far more likely to arrive if receiving servers can check it came from you. With Cloudflare Email Service, onboarding the domain adds all three records for you (above); check them under the domain's DNS records. With another provider:

- **SPF:** your domain's SPF record (a TXT record) must include your provider's sending servers, as your provider documents (for example `v=spf1 include:_spf.example-provider.com ~all`).
- **DKIM:** turn on DKIM signing at your provider for the `Email__From` domain and publish the key record it gives you. Penny doesn't sign mail itself; the provider does.
- **DMARC:** publish a DMARC record (`_dmarc.example.com`), starting with `p=none` and a reporting address, then tighten it once reports show SPF and DKIM pass.

Use a sender address on the domain these records cover. Free-mail addresses (a personal Gmail address, say) as `Email__From` through another provider usually fail DMARC.

## Rate limits and abuse

- A reset request always answers the same, whether or not the address has an account, and whether or not an email is sent. Requests share the sign-in rate limit per client (`Auth__RateLimitPermits`).
- While a reset email for an account is waiting to be sent, more requests for it send nothing extra.
- Past `Email__RecipientMessagesPerDay` or `Email__AccountMessagesPerDay`, reset requests still answer the same but send nothing; invitations answer `429 Too many invitation emails today…`.
- Requests from two different accounts at the same moment can each pass the recipient check once, so a burst can exceed the recipient limit by a message or two.

## Delivery, retries and failures

The worker sends up to 10 emails per pass over one connection. A temporary failure (the server is unreachable, TLS or sign-in fails, or it answers 4xx) is retried after 30 seconds, doubling up to an hour. An email still unsent after 8 attempts or 24 hours fails for good. A permanent refusal (5xx, for example an unknown mailbox) fails at once; for an invitation, the creator sees **Failed** and can fix the address. Every retry issues a fresh code, and only the latest code works, so an email delayed past a retry carries a code that no longer works.

Delivery is at least once: if the API stops between sending and recording, the email is sent again on restart with a new code.

Finished outbox rows are deleted after 7 days.

## Troubleshooting

The worker logs counts and reason codes, never addresses, links, codes or the server's replies:

```text
Mail pass: 0 sent, 1 retrying, 0 failed, 0 no longer needed
Mail delivery problems: smtp:auth. See docs/self-hosting/email.md#troubleshooting
```

| Reason | Meaning and fix |
| --- | --- |
| `smtp:connect` | The host didn't answer or closed the connection. Check `Email__Smtp__Host`, the port, the firewall (many hosts block outgoing port 25; use 587 or 465) and the provider's status |
| `smtp:tls` | The TLS handshake failed: wrong `Email__Smtp__Security` for the port (`tls` on 587 or `starttls` on 465), or a certificate the system doesn't trust |
| `smtp:auth` | The server refused the username and password, or requires authentication you didn't configure |
| `smtp:4xx` (`smtp:421`, `smtp:451`…) | The server asked to try later (greylisting, a rate limit at the provider). Penny retries |
| `smtp:5xx` (`smtp:550`, `smtp:553`…) | The server refused the message for good: an unknown recipient, or a sender (`Email__From`) the provider doesn't allow you to use |
| `smtp:connection-lost` | The connection dropped mid-batch; the rest of the batch is retried |
| `expired` | Out of attempts or older than 24 hours |
| `account-gone`, `invite-withdrawn` | Nothing to send any more: the account no longer exists, or the invitation was revoked, used or its household archived |

To see what is waiting, as the database user:

```sql
SELECT kind, attempts, last_error, next_attempt_at, created_at
FROM penny.mail_outbox WHERE finished_at IS NULL ORDER BY created_at;
```

If email is misconfigured and users are waiting, the operator command still works: `reset-password EMAIL` prints a code to deliver by hand ([runbook](../reference/authentication.md#operator-runbook)), and household creators can share a code instead of sending an email.

To turn email off, remove the `Email__*` settings and restart. Unsent rows stay in the outbox and are sent if you turn it back on within 24 hours; after that they fail as `expired`.
