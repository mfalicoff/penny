# Exchange rates

Contract 2.4.0 (MAZ-151). An entry may be paid in another currency than the ledger's home currency ([entries in several currencies](ledger.md#entries-in-several-currencies)). To suggest the rate, the API caches the European Central Bank's daily euro foreign exchange reference rates and answers `GET /api/rates`. Since contract 2.5.0 (MAZ-151 phase 2) the server also uses the cache to show each member a shared expense in their own currency (`home` on shared expenses and projection rows, [shared expenses](shared-expenses.md#several-currencies)), with the same publication and cross-rate rules as `GET /api/rates`. This page is for people who run a Penny server.

## What the server fetches

| | |
| --- | --- |
| Source | The European Central Bank's euro foreign exchange reference rates: units of about 30 currencies per euro, published once per TARGET business day around 16:00 CET (none on weekends and TARGET holidays). |
| First fetch | `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip`, the full history since 1999 (a zipped CSV of about 600 KB), when the cache is empty or its latest publication is more than 60 days old (the server was off for a while). Rows before 2000-01-01, the first date a ledger may hold, are skipped. |
| Every refresh after that | `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml`, the last 90 days (about 100 KB), which also picks up the ECB's rare corrections. |
| When | Once when the API starts, then every `ExchangeRates__RefreshMinutes` (default 240, so a new publication is in the cache within four hours of its release). A failed fetch (network, HTTP error, unreadable file) changes nothing, is logged as a warning with the exception type only, and is retried at the next interval. |
| Requests | Two plain `GET`s of public files: no cookies, no redirects followed, a 60-second timeout, downloads above 16 MiB refused. |
| Kept | Only currencies an entry may use (the history also quotes retired ones such as CYP), only valid rates (`N/A` and blanks are skipped), stored canonically (`158.4500` becomes `158.45`). |

Every API process may fetch: the cache is an idempotent upsert of public data, so there is no lease. When two processes store the same new publication at once, one wins and the other rolls back and changes nothing. `ExchangeRates__Worker=false` stops a process from fetching while it still answers from the cache, for example on HTTP replicas next to a worker container.

### Cache

The table `penny.exchange_rates` holds one row per publication and currency:

| Column | Type | |
| --- | --- | --- |
| `rate_date` | `date` | The publication date; primary key with `currency` |
| `currency` | `text` | ISO 4217 code, `^[A-Z]{3}$` |
| `per_euro` | `text` | Units of the currency per euro, a canonical decimal string (at most 9 integer and 8 fraction digits, no trailing fraction zeros, greater than zero) |

The full history is about 200,000 rows (roughly 15 MB). It holds nothing personal and is rebuilt by the next fetch if lost, so restoring it is optional; it is part of the normal PostgreSQL backup.

## Privacy

The server only downloads the two public ECB files above. It sends the ECB no account, ledger, entry, amount, currency choice or IP address of a person; the request comes from the server, carries no cookies or credentials, and is the same for every Penny server. People's apps never contact the ECB: they ask your server. Logs carry counts only (quotes read, rows changed), never rates or amounts.

## Turning it off

```sh
ExchangeRates__Enabled=false
```

Nothing is fetched and `GET /api/rates` answers `enabled: false`, `source: null`, `rateDate: null`, `latestDate: null`, `provisional: false` and no rates; the cached rows stay and are used again when it is turned back on. The apps then show "Turned off on this server" in Settings › Currency, ask the person to type the rate for an entry in another currency (suggesting the last one they used for that currency), and keep Save disabled until there is one. Entries keep the rate they were saved with. Shared expenses lose their `home` amounts, except those paid in the member's own currency, which need no rate.

| Setting | Default | |
| --- | --- | --- |
| `ExchangeRates__Enabled` | `true` | `false`: no fetching, and `GET /api/rates` reports `enabled: false` |
| `ExchangeRates__Worker` | `true` | `false`: this process doesn't fetch (another may); it still answers from the cache |
| `ExchangeRates__RefreshMinutes` | `240` | Delay between fetches, also after a failure; 15–10,080 |
| `ExchangeRates__HistoryUrl` | the ECB's `eurofxref-hist.zip` | A mirror of the full history ZIP (same format) |
| `ExchangeRates__RecentUrl` | the ECB's `eurofxref-hist-90d.xml` | A mirror of the 90-day XML (same format) |

The full-stack test environment (`scripts/test-env`) runs with `ExchangeRates__Enabled=false`, or with synthetic cached rates and no fetching with `penny-env up --rates` ([test environment](test-environment.md#exchange-rates)), and the .NET tests never fetch (`ExchangeRates__Worker=false`; they seed the cache or use a fake source).

## GET /api/rates

`GET /api/rates?base=CAD&date=2026-11-08` (session required; schema `ExchangeRates` in `contracts/openapi.json`):

```json
{
  "enabled": true,
  "source": "European Central Bank",
  "base": "CAD",
  "date": "2026-11-08",
  "rateDate": "2026-11-06",
  "provisional": false,
  "latestDate": "2026-11-09",
  "rates": { "EUR": "1.46", "JPY": "0.00909657", "USD": "1.35185" }
}
```

- `base` is any listed ISO 4217 code (the home currency, in practice); `date` is a ledger date, 2000-01-01 through 2100-12-31. Anything else is `400 Invalid exchange rate request.` (`rates.invalid_request`).
- **Which publication.** The latest on or before `date`, so weekends and holidays use the last business day. A date after the latest publication (today before 16:00 CET, or a future date) takes the latest, with `provisional: true`; the apps mark such an entry's rate provisional and replace it with the published rate for its date on a later sync, unless the person edited it. A date before the first stored publication, or an empty cache, has `rateDate: null` and no rates. Without `date`, the answer is the latest publication itself.
- **Rates** are base units per one unit of each other currency the ECB quotes, euro included and the base itself left out: `rates[X] = crossRate(X per euro, base per euro)`, rounded half up to 6 significant digits and at most 8 fraction digits (a rate that rounds to zero is left out). A base the ECB doesn't quote gets no rates, and neither does a currency it doesn't quote: the apps ask the person for those.
- **Rounding of entries** happens in the apps: the home amount is `originalAmount × rate`, rounded once, half up, to the home currency's minor units, and the server rejects a ledger whose `total` differs.
- `Cache-Control: private, max-age=3600`. The apps cache the last answer for offline entries.

The rules (`crossRate`, `publishedRateDate`, `convertAmount`) are `apps/web/src/domain/currency.ts`, with golden cases in `contracts/fixtures/currency.json` checked by TypeScript, C# (`CurrencyFixtureTests`) and Swift.
