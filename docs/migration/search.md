# Search v1 specification (MAZ-121)

`POST /api/v1/search/transactions` adds full transaction search to the .NET API. It finds entries by exact text, by text with typos, and by meaning: searching "beverage" finds "Coffee beans". It covers personal entries and the shared expenses the viewer may see.

Node does not implement it. Legacy ledger routes and the clients' local substring search keep working. A client that gets 404 from this route falls back to local search. It must not infer search support from `/api/info`.

**Depends on:** MAZ-55 (ledger, done) and MAZ-56/57 (households and shared expenses). Shared expenses must be searchable, so MAZ-121 starts after MAZ-57. **Extended by:** MAZ-125 (receipt OCR text becomes another searchable field).

## What is searched

Each result is either a **personal entry** (a row in `ledger_entries`) or a **shared expense** (a row in `household_expenses`, shown to the viewer as a `ProjectedExpense` with their share from `household_splits`). Results never include:

- scheduled previews of recurring rules (personal or shared)
- reimbursements
- shared expenses that are deleted, or that the viewer is not allowed to see (see [Access](#access))

The searchable **document** of a result is its fields joined with single spaces:

| Field | Personal entry | Shared expense |
| --- | --- | --- |
| Title | entry title | expense title |
| Note | entry note | expense note |
| Category | category name | the expense's category name |
| Account | account name | the payer's account name, **for the payer only** |
| Receipt text | later (MAZ-125) | later (MAZ-125), only for viewers who may see the receipt |

Missing fields are empty. Joining the fields keeps legacy cross-field matches: "beans morning" matches title "Coffee beans" with note "Morning".

## Text normalization

Server, iOS and web apply the same function to documents and queries:

1. Unicode NFKD decomposition.
2. Remove every nonspacing mark (General Category `Mn`). This makes accents irrelevant: "cafe" matches "Café", and "İ" becomes "I".
3. Locale-independent Unicode lowercase (`ToLowerInvariant` in .NET, `toLowerCase()` in JavaScript, `lowercased()` in Swift).
4. Map final sigma `ς` to `σ` and `ß` to `ss`.
5. Replace each run of Unicode whitespace with one space, then trim.

Steps 1–2 remove the only character whose JavaScript and Swift lowercase differs from .NET's simple lowercase (`İ`), and step 4 removes the context-dependent final sigma. The three runtimes should then agree without custom case-folding tables; the fixtures verify it. Shared fixtures in `contracts/fixtures/search-cases.json` must cover at least: dotted I, Greek final sigma, composed and decomposed accents, `ß`, ligatures (`ﬁ`), full-width letters and emoji. A Unicode or runtime upgrade that changes a fixture requires a fixture review and the rebuild command.

The server computes normalized text in the application and stores it, rather than relying on PostgreSQL locale functions, `ILIKE` or `unaccent`.

## Matching

A result matches when **any** of these is true. Each match has a **tier** used for relevance.

| Tier | Match | Rule |
| --- | --- | --- |
| 1 | Title contains the query | Literal substring of the normalized title |
| 2 | Document contains the query | Literal substring of the normalized document |
| 3 | Typo-tolerant | `pg_trgm` `word_similarity(query, document)` at or above a fixed threshold (initially 0.6, tuned with fixtures). Requires a query of at least 3 characters. |
| 4 | Same meaning | Cosine similarity between the query embedding and the result's embedding at or above a fixed threshold, limited to the 200 closest authorized results. Requires a query with at least one letter or digit. |

Substring matching is literal: the query is a bound parameter, and `%`, `_` and `\` are escaped. An empty query matches every result that passes the filters.

### Embeddings (match by meaning)

- **Model:** a small **multilingual** sentence-embedding model that runs on the server's CPU through ONNX Runtime, so English and French match by meaning, including across languages ("boisson" finds "coffee", "beverage" finds "café"). Use `intfloat/multilingual-e5-small` (384 dimensions, MIT licence, trained for retrieval). It requires the prefixes `query: ` for search text and `passage: ` for indexed text. The fallback, if e5 underperforms on the fixtures, is `paraphrase-multilingual-MiniLM-L12-v2` (384 dimensions, Apache 2.0). The model file is pinned by SHA-256 and loaded at startup; startup fails clearly if it is missing or does not match. No text is sent to external services. Shared fixtures include English, French and mixed-language meaning cases.
- **Embedded text:** title, note and category name. Account names are **never** embedded: a shared expense's embedding is used for every member, and the payer's private account name must not influence other members' results. Account names match only through tiers 1–3, and only for the payer.
- **Storage:** a `vector(384)` column in the search tables, with an HNSW index (`pgvector`, cosine distance). Queries filter by authorization inside the index scan (pgvector iterative scans), never after ranking.
- **Freshness:** normalized text and lexical indexes update in the same transaction as the write. Embeddings are computed by a background worker shortly after (target: under 10 seconds) through an outbox with retries. Until then, a new or edited result is found by tiers 1–3 only. Query embeddings are computed per request.
- **Hardware target:** a modest self-hosted CPU (example: i7-4790K, 32 GB RAM). The multilingual model is larger than an English-only one (about 118M parameters, roughly 500 MB of RAM, less with an int8-quantized ONNX file). Expected costs: about 10–20 ms per query embedding, roughly 15–30 minutes to embed 100,000 entries on first backfill, and about 150 MB of vector index per 100,000 entries. Confirm with a timing test before release.

### Relevance

Relevance orders by: tier ascending, then similarity descending (substring tiers use 1.0, tier 3 its `word_similarity`, tier 4 its cosine similarity), then date descending, then key ascending (UTF-8 ordinal). Scores are stored rounded to 6 decimal places so cursors compare exactly. A result matching several tiers uses its best tier.

## Request

```json
{ "query": "beverage", "from": "2026-01-01", "to": "2026-11-30", "kind": "expense", "source": "all", "sort": "relevance", "pageSize": 50 }
```

| Field | Rules |
| --- | --- |
| `query` | Optional, default `""`. Trimmed; at most 200 UTF-16 code units. |
| `from`, `to` | Optional calendar dates (2000-01-01 to 2100-12-31), inclusive. Either may be omitted. Omitting both searches **all time**. `from` must not be after `to`. |
| `kind` | Optional: `expense`, `income` or `investment`. Default: all. |
| `source` | Optional: `personal`, `shared` or `all`. Default `all`. |
| `sort` | `relevance`, `date-desc`, `date-asc`, `amount-desc` or `amount-asc`. Default: `relevance` when the query is non-empty, otherwise `date-desc`. `relevance` with an empty query behaves as `date-desc`. Amount sorts use the viewer's share (`share` / `shareCents`). Every sort ends with date descending, then key ascending, as tie-breakers. |
| `pageSize` | 1–100, default 50. |
| `cursor` | Optional, opaque, at most 2048 characters. |

Unknown fields and invalid values return 400. Other errors: 401 without a session, 403 from a rejected origin, 413 for an oversized body, 429 when rate limited, 503 with `Retry-After` on timeout, 500 otherwise. All errors use `{error:string}`. A POST body keeps search text out of URL access logs; request bodies and SQL parameters are never logged.

## Response

```json
{
  "version": 1,
  "items": [{ "key": "personal:a", "source": "personal", "match": "meaning", "entry": { } }],
  "totalCount": 3,
  "nextCursor": null
}
```

- `key` is `personal:<entryId>` or `shared:<expenseId>`. Results are deduplicated by key, never by title.
- `entry` is the existing `Entry` (personal) or `ProjectedExpense` (shared) shape. Shared money stays `totalCents`/`shareCents`.
- `match` is the best tier: `title`, `text`, `typo` or `meaning`. It lets clients explain why a result appears. No snippets are returned.
- `totalCount` counts authorized matching results once; it is not a money total. Meaning matches count only within the 200-result cap.

## Pagination

Cursors are simple keyset positions, base64url-encoded: a format version, a hash of the normalized query and all filters and sort, and the last result's sort tuple (tier, score, date, key, or amount, date, key). There is no signature and no expiry.

- A cursor whose hash does not match the current request returns 400.
- Every page re-runs authorization, so a cursor can never restore access that was removed.
- If data changes between pages, results may shift slightly (an edited entry can appear twice or be skipped). This is accepted for v1. Clients refresh from the first page on pull-to-refresh or after their own writes.

## Access

- The viewer is always the authenticated session's user; requests never accept a user id.
- Personal entries: only the viewer's own ledger.
- Shared expenses: the expenses of households the viewer can see, under the same membership-period rules as the household views (MAZ-56/57), including history a former member may still see. Revoked access disappears on the next request.
- Authorization filters run in SQL **before** matching, ranking, counting and pagination, so counts and ordering never reveal hidden results.
- The payer's account name is matched only when the viewer is the payer.

## Storage and maintenance

- Extensions: `pg_trgm` (included with PostgreSQL) and `vector` (pgvector). The pinned PostgreSQL 18 image changes to an official pgvector image for PostgreSQL 18, pinned by digest in Compose and `DatabaseSchema.Image`. An administrator creates the extensions once (`vector` is not a trusted extension). Migrations require them, and readiness checks their presence and versions.
- Schema changes go through EF Core migrations. Personal entries and shared expenses keep their own tables; MAZ-121 adds normalized-document and embedding columns or side tables with GIN (`gin_trgm_ops`) and HNSW indexes. Category and account renames rewrite affected documents in the same transaction as the rename.
- A `search-rebuild` maintenance command recomputes normalized text and embeddings for all users or one user: for backfill after import, model changes and normalization changes. A `search-verify` command reports rows whose stored text or model version is stale.

## Limits and performance

- Rate limit: 30 requests per minute per session. SQL statement timeout: 2 seconds, with cancellation passed through.
- Targets on the reference host with 100,000 personal entries per viewer plus shared expenses: p95 at most 300 ms for warm selective queries, and at most 1 s for broad queries and counts. MAZ-121 records `EXPLAIN (ANALYZE, BUFFERS)` evidence and p95 timings for short, common and selective queries, cold and warm, with concurrent writes.

## Offline, pending edits and demo

- Clients keep their local search, using the same normalization with tiers 1–2 only (no typo or meaning matching offline).
- With pending local edits, or offline, clients search one complete local result set (durable local data plus cached shared projections) and label it "On this device". They never mix local rows into server pages.
- After sync, clients discard server pages and search again. Demo mode searches only its in-memory sample.
- MAZ-73/88 build the client screens; MAZ-71/87 verify pending create, edit and delete, then reconnect.

## Changes MAZ-121 must make to the contract

- Replace `SearchRequest` (`period`/`month`/`year`/`day`, `mode`) with the request above, and add `match` to `SearchItem`. Remove `ledgerRevision`, `searchRevision` and `scope` from `SearchResponse`.
- Update `contracts/fixtures/search-cases.json`, including `foldCases`, to the normalization above, and add typo, meaning and relevance-order cases. Update `tests/core/contracts.test.ts`, which currently checks folding with JavaScript `toLowerCase()` alone.
- Change the operation's `x-implementation` from `planned` to `backend` when implemented.

## Out of scope for v1

Snippets and highlighting, languages beyond what the multilingual model covers being tested (v1 tests English and French), external search services, and hosted embedding APIs.
