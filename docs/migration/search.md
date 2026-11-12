# Search v1 specification (MAZ-121)

`POST /api/v1/search/transactions` adds full transaction search to the .NET API. It finds entries by exact text, by text with typos, and by meaning: searching "beverage" finds "Coffee beans". It covers personal entries and the shared expenses the viewer may see.

Node does not implement it. Legacy ledger routes and the clients' local substring search keep working. A client that gets 404 from this route falls back to local search. It must not infer search support from `/api/info`.

**Depends on:** MAZ-55 (ledger, done) and MAZ-56/57 (households and shared expenses). Shared expenses must be searchable, so MAZ-121 starts after MAZ-57. **Extended by:** MAZ-125 (receipt text, extracted on the server, is another searchable field; see [Receipt text](#receipt-text-maz-125)).

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
| Receipt text | text of the entry's receipt (embedded PDF text or local OCR, MAZ-125) | text of the expense's receipt (MAZ-125), **only for viewers who may read the receipt** |

Missing fields are empty. Joining the fields keeps legacy cross-field matches: "beans morning" matches title "Coffee beans" with note "Morning".

Receipt text (MAZ-125) is matched by tiers 2–4 (tier 1 is the title only), always under the receipt's visibility, never the entry's: the receipt download rule ([receipts](receipts.md#access)) is evaluated in the same SQL statement. It is a separate field: substring and typo matches run on the receipt's own normalized text (a query does not match across the title and the receipt), and a result matched through it reports `text`, `typo` or `meaning`. A viewer who may see a shared expense but not its receipt can never match the expense through that receipt, and neither the match tier nor the ranking may reveal it.

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
| 4 | Same meaning | Cosine similarity between the query embedding and the result's embedding at or above a per-query threshold: at least 0.82, and at least 0.015 above the query's **baseline**, its mean similarity to five neutral passages (see [Decisions to confirm](#decisions-to-confirm)). Limited to the 200 closest authorized results. Requires a query with at least one letter or digit. |

Substring matching is literal: the query is a bound parameter, and `%`, `_` and `\` are escaped. An empty query matches every result that passes the filters.

### Embeddings (match by meaning)

- **Model:** a small **multilingual** sentence-embedding model that runs on the server's CPU through ONNX Runtime, so English and French match by meaning, including across languages ("boisson" finds "coffee", "beverage" finds "café"). Use `intfloat/multilingual-e5-small` (384 dimensions, MIT licence, trained for retrieval). It requires the prefixes `query: ` for search text and `passage: ` for indexed text. The fallback, if e5 underperforms on the fixtures, is `paraphrase-multilingual-MiniLM-L12-v2` (384 dimensions, Apache 2.0). The model file is pinned by SHA-256 and loaded at startup; startup fails clearly if it is missing or does not match. No text is sent to external services. Shared fixtures include English, French and mixed-language meaning cases.
- **Embedded text:** title, note and category name for the entry's embedding; separately, each chunk of a receipt's text (MAZ-125, `receipt_text_chunks`). Receipt chunks are never mixed into the entry's embedding and are matched only through receipts the viewer may read, checked before ranking. Account names are **never** embedded: a shared expense's embedding is used for every member, and the payer's private account name must not influence other members' results. Account names match only through tiers 1–3, and only for the payer.
- **Receipt text (MAZ-125):** embedded **separately** from the entry, never mixed into the entry's embedding, because the entry's embedding is shared by everyone who may see the entry and a receipt can be more private than that. Long text is split into chunks that fit the model (at most 512 tokens each, with the `passage: ` prefix, counted with the model's own tokenizer). Each chunk keeps its receipt id, so the meaning query applies the receipt's visibility before ranking (an exact scan of the viewer's readable chunks, MAZ-125 measurements below). A result's meaning score is the best of its entry embedding and the chunks of receipts the viewer may see. The 200-result cap counts results, not chunks. Until a receipt's chunks are embedded, it matches by text and typo only.
- **Storage:** a `vector(384)` column in the search tables (`search_documents` and, for receipts, `receipt_text_chunks`), each with an HNSW index (`pgvector`, cosine distance). Queries filter by authorization inside the index scan (pgvector iterative scans), never after ranking.
- **Freshness:** normalized text and lexical indexes update in the same transaction as the write. Embeddings are computed by a background worker shortly after (target: under 10 seconds) through an outbox with retries. Until then, a new or edited result is found by tiers 1–3 only. Query embeddings are computed per request. Receipt text arrives later still: extraction runs after the upload commits (MAZ-125). Its normalized text is written in the extraction job's transaction, and its chunks go through the same embedding outbox and worker. Deleting or replacing a receipt (removing or replacing the last entry, expense or rule link to it, or deleting that entry or expense) removes its text and chunks in the same transaction as that write.
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
- MAZ-57 builds no search tables. `SharedExpenseService` marks seams in expense create, update/move and delete (with splits), and `HouseholdService` in join, leave/removal and archive: MAZ-121 updates its shared-expense documents and visibility at those points, inside the same transaction, before commit ([shared expenses](shared-expenses.md#search-maz-121)).
- Authorization filters run in SQL **before** matching, ranking, counting and pagination, so counts and ordering never reveal hidden results.
- The payer's account name is matched only when the viewer is the payer.

## Storage and maintenance

- Extensions: `pg_trgm` (included with PostgreSQL) and `vector` (pgvector). The pinned PostgreSQL 18 image changes to an official pgvector image for PostgreSQL 18, pinned by digest in Compose and `DatabaseSchema.Image`. An administrator creates the extensions once (`vector` is not a trusted extension). Migrations require them, and readiness checks their presence and versions.
- Schema changes go through EF Core migrations. Personal entries and shared expenses keep their own tables; MAZ-121 adds normalized-document and embedding columns or side tables with GIN (`gin_trgm_ops`) and HNSW indexes. Category and account renames rewrite affected documents in the same transaction as the rename.
- A `search-rebuild` maintenance command recomputes normalized text and embeddings for all users or one user: for backfill after import, model changes and normalization changes. A `search-verify` command reports rows whose stored text or model version is stale.
- MAZ-125 adds receipt texts (`receipt_texts`) and receipt embedding chunks (`receipt_text_chunks`), keyed by receipt, and `search_documents.receipt_id`. `search-rebuild` recomputes their normalized text and chunks and queues their embeddings; `search-verify` reports missing, stale and pending receipt text. Stored text is reused; re-running OCR is the `receipts-ocr` command ([operations](../operations.md#receipt-text-ocr)).

## Limits and performance

- Rate limit: 30 requests per minute per session. SQL statement timeout: 2 seconds, with cancellation passed through.
- Targets on the reference host with 100,000 personal entries per viewer plus shared expenses: p95 at most 300 ms for warm selective queries, and at most 1 s for broad queries and counts. MAZ-121 records `EXPLAIN (ANALYZE, BUFFERS)` evidence and p95 timings for short, common and selective queries, cold and warm, with concurrent writes.

## Implementation (MAZ-121)

Code: `Domain/Search` (`SearchText` normalization, `SearchReader`, `SearchDocumentText`), `Application/Search` (`SearchService`, `SearchCursor`, `SearchEmbeddingService`, `SearchTuning`, `MeaningThreshold`), `Persistence/Search` (`SearchIndexer`, `OnnxTextEmbedder`), `Persistence/Repositories/PostgresSearchRepository`, `Api/Controllers/SearchController`, `Api/Search` (rate limit, embedding worker), `Api/Commands/SearchCommand`. Tests: `UnitTests/Search`, and on real PostgreSQL with the real model `IntegrationTests/Controllers/Search*Tests`, `Http/SearchPolicyTests`, `Migrations/SearchMaintenanceTests`.

**Storage.** One derived table, `search_documents` (EF migration `AddSearchDocuments`), holds one row per personal entry (`user_id`, `entry_id`, foreign key to `ledger_entries`) and per live shared expense (`expense_id`, `household_id`, `payer_id`). Each row stores the result key, kind, date, the owner's share for personal rows, and the normalized texts: `title_text`, `document_text` (title, note, category) and `owner_text` (the same plus the account name). Personal rows match on `owner_text`; shared rows match on `owner_text` only when the viewer is the payer, otherwise on `document_text`. GIN `gin_trgm_ops` indexes cover both texts (LIKE and `<%`); an HNSW `vector_cosine_ops` index covers `embedding vector(384)`.

**Write path.** `PostgresLedgerRepository.TrySaveAsync` stages the personal rows with the entry diff and saves them in the same transaction; only changed columns are written, so a category or account rename rewrites exactly the affected rows. It then rewrites the payer's account text in their shared expenses. `SharedExpenseService` create, update/move and delete call `IndexExpenseAsync` before commit (a deleted expense loses its row). Visibility is not stored: every search applies the household-view rule to `household_member_periods` and `household_splits` in the same SQL statement, so join, leave, removal and archive need no write and take effect at their commit. A rejected or conflicting write rolls everything back.

**Embedding outbox.** A row whose embedded text (title, note, category; raw, whitespace-collapsed) changes gets `embedding = NULL` and `embedding_due_at` set, so a stale vector never matches. The hosted `SearchEmbeddingWorker` polls every second, leases up to 32 due rows (candidates first, then a conditional `UPDATE` that re-checks the lease after the row lock, so concurrent workers never share a row), embeds them and stores each vector only if the row is still leased and its text unchanged. Failures release the lease with backoff (2^attempts seconds, at most 10 minutes). Queries use only vectors made by the current model id.

**Model.** `intfloat/multilingual-e5-small` at Hugging Face revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`: `onnx/model.onnx` (fp32, 470 MB, SHA-256 `ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665`) and `onnx/sentencepiece.bpe.model` (SHA-256 `cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865`). `node apps/backend/development/download-model.mjs [DIR]` downloads them into the ignored `.cache/backend/models/multilingual-e5-small` and verifies the hashes; CI caches that directory. The host loads them from `Search__ModelDirectory` at startup and refuses to start when a file is missing or its hash differs. Tokenization uses Microsoft.ML.Tokenizers' SentencePiece tokenizer with the model's vocabulary layout (fairseq offset: piece *n* is id *n*+1, `<s>`=0, `</s>`=2, `<unk>`=3; verified against the Hugging Face tokenizer), inference ONNX Runtime 1.31.1 on the CPU, then the model card's mean pooling and L2 normalization (System.Numerics.Tensors). Queries are embedded as `query: ` + the normalized query, documents as `passage: ` + title, note and category. The int8 `model_qint8_avx512_vnni.onnx` was not used: it targets AVX-512 VNNI, which the reference i7-4790K lacks.

**Query.** One REPEATABLE READ snapshot with transaction-local settings (`statement_timeout` 2 s, `hnsw.iterative_scan = relaxed_order`, `hnsw.ef_search = 200`, `pg_trgm.word_similarity_threshold = 0.6`). The meaning tier first reads the 200 closest authorized, filtered documents (HNSW with the filter inside the iterative scan) and keeps those at or above the query's meaning threshold (`MeaningThreshold`, passed in `SearchCriteria.MeaningSimilarity`). Then each tier is a disjoint `UNION ALL` branch per source (title/text via LIKE, typo via `<%`, meaning via those ids), so each branch can use its index; `count(*)` and the keyset page run over the union. Scores are stored in millionths (`round(similarity × 10^6)`, an integer), which is the 6-decimal rounding of the spec in exact form.

### Decisions to confirm

- **Meaning threshold 0.82 (MAZ-121).** e5 cosine similarities are compressed (unrelated short texts score 0.77–0.83). On a labeled 18-query × 17-entry English/French set, the best fixed threshold for e5 was 0.84 (F1 0.78); the fallback `paraphrase-multilingual-MiniLM-L12-v2` did worse (best F1 0.73) and also failed "beverage" → "Coffee beans", so e5 stays. 0.82 is a little lower to keep "beverage" → "Coffee beans" and the cross-language fixtures; it lets some loosely related rows in at tier 4 (always ranked after text and typo matches, at most 200). The spec's example "boisson" → "coffee" scores about 0.80 and is **not** found; the fixtures use cross-language cases that are ("logement" → "Rent", "salaire" → "Pay"/Salary, "autobus" → "Bus pass", "medicine" → "Pharmacie", "apartment" → "Loyer … Appartement").
- **Per-query meaning baseline (MAZ-167).** A fixed 0.82 let unrelated queries match short entries: "something" returned "rent" (Home, 0.839) and "test" (Home, 0.835), "hello" scored 0.845 and 0.844 against them. Some queries sit close to *everything*, so the rule now also compares each query with itself: its **baseline** is the mean cosine similarity of the query to five neutral passages (`passage: ` + `""`, `a`, `x`, `item`, `entry`; embedded once per process, so a request does one dot product more). A meaning match needs `similarity ≥ max(0.82, baseline + 0.015)` (`SearchTuning.MeaningFloor`, `MeaningMargin`, `MeaningAnchors`; `MeaningThreshold` computes it per request and passes it in `SearchCriteria.MeaningSimilarity`, so receipt chunks in MAZ-125 use the same value). Both conditions only remove matches, so nothing that failed 0.82 can match now. Measured with the real model (similarity / the query's threshold):

  | Query | Baseline | Threshold | Fixture match | Unrelated best |
  | --- | --- | --- | --- | --- |
  | beverage | 0.801 | 0.820 | Coffee beans 0.822 (with note "Morning"), 0.831 | — |
  | logement | 0.825 | 0.840 | Rent 0.848 | — |
  | salaire | 0.808 | 0.823 | Pay 0.916 | — |
  | autobus | 0.806 | 0.821 | Bus pass 0.877 | — |
  | medicine | 0.821 | 0.836 | Pharmacie 0.866 | — |
  | apartment | 0.820 | 0.835 | Loyer novembre 0.864 | — |
  | rent appartement | 0.795 | 0.820 | Rent 0.861 | — |
  | something | 0.841 | 0.856 | — | rent 0.839, test 0.835 |
  | hello | 0.833 | 0.848 | — | rent 0.845, test 0.844 |
  | asdf | 0.785 | 0.820 | — | Misc 0.800 |

  The binding case is "beverage" → "Coffee beans / Morning" (0.822): the 0.82 floor has 0.002 to spare and the margin 0.006, so a larger margin (0.02 leaves 0.001) or floor would lose that fixture. The empty passage alone as a baseline did not separate anything ("beverage" → "Coffee beans" scored the same margin as "something" → "rent"), and a baseline subtracted on the document side too separated better but lost about half of the related matches below. On a wider probe (30 nonsense or unrelated queries, including French, against 43 short entries, and 50 hand-labeled related pairs such as "taxi" → "Uber", "vin" → "Wine", "paycheck" → "Pay"), the old rule accepted 282 of 1,290 unrelated pairs and 41 of 50 related ones; the new rule accepts 64 unrelated (27 without the query "n'importe quoi", which is close to everything) and 37 related. The remaining false matches are mostly vague or nonsense queries against vague or nonsense entries ("something" → "Thing", "nothing" → "Misc", "xyz" → "x"), some of which the text and typo tiers find first anyway. The probe is a one-off harness, not committed; the fixtures pin the cases above. New fixtures: `unrelatedLedger` / `unrelatedCases` (the MAZ-167 repro plus "asdf", "hello" and a "housing" → "rent" control) and "something" / "hello" against the server ledger.
- **The query is embedded after normalization** (lowercase, no accents), so the cursor hash of the normalized query binds the meaning tier too. Documents are embedded from their original text.
- **The 200-result meaning cap applies after the request filters** (date, kind, source), not to all authorized results, so a filtered search still gets up to 200 meaning candidates.
- **`match` is `null` for an empty query** (no tier applies); it is always present.
- **Shared visibility follows the household view** (`SharedExpenseService.CanSee`): a current member sees every live expense, including ones without a share (`shareCents` 0); a former member sees those with a split row. Nothing is written at membership seams.
- **Rate limit key.** The limiter runs before authentication, so it partitions by a hash of the presented session token; requests without a token are not limited by it and get 401.
- **Errors.** 503 adds `Retry-After: 1`. Request JSON `null` values and unknown fields are 400 (`Invalid search request.`); a foreign or malformed cursor is 400 `Invalid search cursor.`. The query length is checked after trimming, so the OpenAPI schema has no `maxLength` for it.
- **Maintenance commands** use the runtime connection with a 30-second statement bound and need the receipt settings (the repository serves search results too); `search-verify` exits 2 when anything is stale.

### Operations

- Extensions: the official pgvector image `pgvector/pgvector:0.8.7-pg18-trixie` (PostgreSQL 18.6, pgvector 0.8.7), digest `sha256:5895949dfcdf308eb0cd31c950c93c14895c77f33fbedfecf1fa511ab1d4bcd2`. `development/init-roles.sh` creates `pg_trgm` and `vector` in `public` for new volumes; for an existing database run `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;` as an administrator, then `migrate`. `migrate` refuses to run without pgvector 0.8+ and pg_trgm, and readiness answers 503 `search-extensions`. Managed hosts must offer pgvector 0.8 or later (iterative scans) on PostgreSQL 18; most major providers ship pgvector, but check the version.
- `search-rebuild [--user USER_ID]` recomputes documents for everyone or one user (their entries and the shared expenses of every household they joined) and the normalized text and chunks of stored receipt texts (the user's uploads and the receipts their documents link), queues embeddings that are missing or from another model, then embeds them in-process. It prints `{Written, Removed, Queued, ReceiptTexts, Embedded, Pending}`. Run it after `import-sqlite` (documents are derived and not imported), after a normalization change (fixture update) and after a model change.
- `search-verify [--user USER_ID]` is read-only and prints `{Documents, Missing, Orphaned, StaleText, PendingEmbeddings, StaleModel, ReceiptTexts, MissingReceiptText, StaleReceiptText, PendingReceiptText}`; exit 0 when all but `Documents` and `ReceiptTexts` are zero, 2 otherwise. Pending embeddings and pending receipt text are normal for a short while after writes and uploads. Receipt chunk embeddings count in `PendingEmbeddings` and `StaleModel`; chunks are checked for presence only (re-chunking needs the model, which `search-rebuild` loads).
- Settings: `Search__ModelDirectory` (required), `Search__EmbeddingWorker` (default `true`; set `false` on extra instances if only one should embed, though several may run), `Search__RateLimitPermits` (default 30 per minute per session).
- Resources: the fp32 model file is 470 MB and is loaded once per process (resident memory was not measured separately); a query embedding about 3 ms; for 102,000 documents the table and its indexes take 367 MB, of which the HNSW index 104 MB.

### Measured performance

Host: AMD Ryzen 7 5800X (8 cores, 16 threads), 31 GB RAM, rootless Podman; PostgreSQL in the pinned image with default settings (shared_buffers 128 MB); .NET Release build, Kestrel over loopback, timings end to end per HTTP request. Data: 100,000 synthetic personal entries for one viewer (40 title families, 10-year date range) plus 2,000 shared expenses in one household, seeded by the explicit `SearchBenchmarkTests` (`--filter-class *SearchBenchmarkTests --explicit on`; nothing committed). "Cold" is the first request on a fresh host process and connection pool (PostgreSQL's own caches were warm: the container could not be restarted inside the test). "Concurrent writes" runs the same query while another client creates shared expenses in a loop. 40 warm runs per query.

| Query | Results | Cold (ms) | Warm p50 (ms) | Warm p95 (ms) | p95 with concurrent writes (ms) |
| --- | --- | --- | --- | --- | --- |
| selective title ("espresso machine #5") | 2550 | 245 | 80 | 88 | 86 |
| selective typo ("esspresso") | 2577 | 87 | 66 | 72 | 73 |
| common word ("coffee") | 2550 | 49 | 42 | 50 | 56 |
| meaning ("beverage") | 200 | 38 | 27 | 29 | 43 |
| short ("a") | 87948 | 279 | 239 | 245 | 255 |
| broad: empty query, all time, count | 103254 | 206 | 194 | 199 | 202 |
| broad: empty query, amount-desc | 103960 | 204 | 191 | 196 | 201 |
| filtered: "lunch" in 2024, expense | 256 | 75 | 52 | 58 | 58 |

"Results" is `totalCount`: the selective title query also counts typo matches of the same title family (about 2,500 "Espresso machine #n" entries) and up to 200 meaning matches. All targets hold: warm selective p95 50–88 ms (target 300 ms), broad and count p95 196–245 ms (target 1 s); the worst cold request was 279 ms.

Backfill: text documents for 102,000 rows in 16.0 s; embeddings for 102,000 rows in 300 s on the CPU (about 3 ms per document, batches of 16 across all cores) — about 5 minutes, well inside the 15–30 minutes estimated for the reference host, which has half the cores. Targets (300 ms warm selective, 1 s broad and counts) are met on this host; the reference i7-4790K is slower and was not measured.

`EXPLAIN (ANALYZE, BUFFERS)` of the same repository code (auto_explain, warm, excerpts): server-side statement times for one search (meaning top-200 / count / page): selective "espresso machine #5" 8 / 39 / 39 ms, "coffee" 12 / 19 / 13 ms, "beverage" 4 / 13 / 8 ms, "a" 6 / 119 / 122 ms, empty query — / 102 / 117 ms. The remaining time per request is the query embedding (about 3 ms), loading the page's 51 rows, JSON and HTTP.

- Meaning: `Limit (rows=200) -> Index Scan using ix_search_documents_embedding (Order By: embedding <=> $1; Filter: authorization, model)`, 5.7 ms, `Buffers: shared hit=2155 read=1016` — the authorization filter runs inside the HNSW scan.
- Selective title/text and typo branches: `Bitmap Heap Scan on search_documents -> Bitmap Index Scan on ix_search_documents_owner_trgm` (275 and 2,550 candidate rows, 3–4 ms index time); shared branches `BitmapAnd(ix_search_documents_household, BitmapOr(owner_trgm, document_trgm))`; the meaning branch reads its 200 ids through `PK_search_documents`; the page is a `top-N heapsort` over the union.
- Broad (empty query, 104,775 rows incl. concurrent-write rows): `Limit -> Sort (top-N heapsort, 45 kB) -> Append(Seq Scan on search_documents [personal, 100,000 rows, 23 ms], Index Scan using ix_search_documents_household [shared, with the visibility SubPlans])`, 117 ms, `Buffers: shared hit=33808 read=34334`. The count is the same scan without the sort (102 ms). Broad queries are dominated by reading every visible row; they stay well under 1 s here, but grow linearly with the viewer's data.

The full auto_explain output (36 statements) is produced by the benchmark in `.cache/backend/search-benchmark.txt`.

## Receipt text (MAZ-125)

Search finds an entry or shared expense by the text on its receipt. Extraction runs on the server only; operators' setup, settings, backfill and troubleshooting are in [operations](../operations.md#receipt-text-ocr).

Code: `Application/Receipts` (`ReceiptTextService`, `ReceiptTextChunker`, `ReceiptTextCleaner`), `Persistence/Receipts` (`LocalReceiptTextExtractor`, `EngineProcess`, `ReceiptAccess`), `Persistence/Search` (`ReceiptTextIndex`, `ReceiptLinks`, `ReceiptMatch`), `Persistence/Repositories/PostgresReceiptTextRepository`, `Api/Receipts/ReceiptTextWorker`, `Api/Commands/ReceiptTextCommand`. Tests: `UnitTests/Receipts/ReceiptText*`, `IntegrationTests/Controllers/ReceiptText*Tests`, `Migrations/ReceiptTextMaintenanceTests`, and the `receiptCases` fixtures.

**Storage** (EF migration `AddReceiptTexts`). `receipt_texts` holds one row per receipt (`receipt_id` primary key and foreign key to `receipts`): `status` (`pending`, `done`, `failed`, `unsupported`), `method` (`text`, `ocr`, `mixed`), `engine` (engine versions and languages), the cleaned `content` and its normalized `search_text` (same normalization as titles, GIN `gin_trgm_ops`), `pages`, `failure` (a fixed code), `attempts`, `created_at`, `extracted_at`, and the outbox columns `due_at`, `lease_token`, `lease_expires_at`. `receipt_text_chunks` holds the embedding passages (`receipt_id`, `ordinal`, `passage`, `embedding vector(384)` with its own HNSW index, `embedding_model` and the embedding outbox columns); it cascades from `receipt_texts`. `search_documents.receipt_id` names the receipt of each entry and expense; the migration fills it for existing documents. The text is stored unencrypted; the file stays encrypted.

**Write path.** An upload inserts its `receipt_texts` row (`pending`) with the receipt row. The indexer collects receipt link changes of every document write (ledger save, shared expense create, update, move and delete, recurrence occurrences, `search-rebuild`), and shared rule create, update and delete record the rule's old and new receipt the same way (`PostgresSharedExpenseTransaction`); in the same transaction after the write, `ReceiptTextIndex` locks the receipt rows involved, deletes the text (and, by cascade, the chunks) of receipts no document and no shared rule references any more, and queues a `pending` row for newly linked receipts without one. The extraction job leases due rows and counts the attempt in the same update, decrypts the receipt in memory, extracts at most `Ocr__MaxPages` pages within `Ocr__TimeoutSeconds` with bounded memory ([operations](../operations.md#receipt-text-ocr): shrink-on-load decoding, rendering at most 2500 pixels wide, strips of at most 4000 rows, a 40-megapixel ceiling and per-process `prlimit` limits), and in one transaction stores the result (only if still leased, so an unlink in between wins) and its chunks: a chunk whose ordinal and passage are unchanged keeps its row and embedding, the others are replaced and queued for the embedding worker. A corrupt file is `failed` on its first attempt (it would fail the same way again); other failed attempts are retried with backoff (30 s × 2^(attempts − 1), at most an hour) until `Ocr__MaxAttempts`. A due row that already used `Ocr__MaxAttempts` (its last claim's lease expired without a result: the worker died, e.g. killed for memory) is failed as `lease-expired` by the next claim, never run again.

**Matching.** Per source, after the document's own branches: tier 2 adds documents whose receipt's `search_text` contains the query; tier 3 adds documents whose receipt text is `word_similarity`-close, scored by the best of the document and the receipt. Meaning reads the 200 closest entry embeddings (HNSW iterative scan) and, separately, the 200 receipts whose best chunk is closest, among the receipts the viewer may read that belong to an authorized, filtered result (an exact scan of those chunks, not the HNSW index; see the measurements below), applies the same similarity threshold to both (the receipt chunk check is in `PostgresSearchRepository.NearestReceiptsAsync`), keeps each result's best similarity and caps the union at 200 results. The tier 4 score is the best of the entry embedding and the viewer-readable chunks. Receipt readability is `ReceiptAccess.Readable`, the download rule: the uploader, or a current member of the household of a live expense that links it, or a former member with a share in that expense.

**Chunks.** Cleaned text (whitespace collapsed per line, empty lines and control characters dropped, at most 20,000 characters) is packed line by line into passages of at most 512 tokens including `passage: ` and the special tokens; an overlong line is split into words. At most 32 chunks per receipt.

**Receipt search cost (measured).** The explicit `ReceiptSearchBenchmarkTests` (`--filter-class *ReceiptSearchBenchmarkTests --explicit on`; report in `.cache/backend/receipt-search-benchmark.txt`, nothing committed) seeds one viewer with 1,000 long receipts (37,719 characters on average, at most 69,935; random 4–8 letter words over 16 letters, so every receipt holds most trigrams: the worst case for the trigram index) linked by 5,000 entries, and 30,000 other users' receipts. Each receipt has 3 chunks (93,000 in all); the other users' chunks are closer to the query (cosine ≈ 0.95) than the viewer's (≈ 0.85, all above the threshold used, 0.80). Same host as above; repository search, 10 runs each.

- *Typo matching is linear in the viewer's receipt text.* `word_similarity` over the viewer's 1,000 receipts takes 8,360 ms as stored (about 0.22 ms per 1,000 characters), 3,891 ms cut to 20,000 characters and 367 ms cut to 2,000 (a typical receipt is 0.5–3 kB); `LIKE '%hij%'` over the same text takes 23 / 16 / 2 ms. Every search with a query of 3 or more characters that the trigram index cannot rule out ran into the 2-second statement timeout (503) at 38,000 and at 20,000 characters, and took 433 ms ("hij", 254 results) and 223 ms ("abcdkgh") at 2,000; queries the index rules out ("zzqx", "qqqqzzzz") take 31–35 ms at every length. Stored text is therefore cut at 20,000 characters (was 100,000: about ten dense pages, the default `Ocr__MaxPages`), which bounds the cost per receipt to 5× less than before but not per viewer: a viewer with hundreds of maximum-length receipts can still exceed the timeout on typo queries. Matching per line or chunk with its own trigram index would bound it; not done.
- *Receipt meaning recall.* The previous query took the 200 closest *chunks*: with 3 similar chunks per receipt that is 67 receipts, not 200 (the cap counted chunks). A filtered HNSW scan is worse when other users' chunks are closer: forced onto the index it returned 30 receipts with pgvector's default `hnsw.max_scan_tuples` (20,000, 407 ms) and 57 with 200,000 (344 ms), so raising the scan limit does not fix it. `NearestReceiptsAsync` now ranks receipts by their best chunk over an exact scan of the viewer's readable, linked chunks: 200 of 200 receipts in 20 ms for 3,000 chunks (the search end to end: 85 ms). Its cost grows with the viewer's readable chunks (linearly), not with the table; the chunk HNSW index is kept for when that set grows large.

**Decisions to confirm.**

- *The receipt text is deleted when the receipt is no longer linked*, because there is no receipt delete endpoint: unlinking, replacing or deleting the last referencing entry, expense or shared rule is what "deleting or replacing a receipt" means for search. Re-linking queues a new extraction. A receipt uploaded after MAZ-125 and never linked keeps the text extracted at upload (kept as is: it is only searchable once linked, and an upload is usually linked right after). The `receipts-ocr` backfill queues only receipts linked now: an unlinked receipt without text may have had it deleted on purpose, and the backfill must not bring it back.
- *Command-line engines instead of a .NET wrapper.* The maintained Tesseract wrappers for .NET ship native Windows binaries and expect version-specific shared library names on Linux, and a native call cannot be cancelled. Running `tesseract`, `pdftotext`, `pdfinfo`, `pdftoppm`, `vipsheader` and `vipsthumbnail` as child processes over standard input and output (under `prlimit` memory and CPU limits) bounds time and memory hard (the process is killed or fails), isolates crashes in the image and PDF parsers, keeps plaintext off the disk and lets each platform's package manager provide the engine and language data.
- *Huge inputs are scaled, not rejected.* Every file is processed, with bounded memory: photos are shrunk while decoding and pages rendered at most 2500 pixels wide, long receipts OCRed in strips; only beyond 40 million pixels per photo or page is the bottom cut off (the row is `done` with `failure = truncated`), so the receipt still matches by what was read.
- *Scanned pages are detected per page*: a page with fewer than 40 letters or digits of embedded text is OCRed.
- *Meaning thresholds* are the entry's: the same per-query threshold (at least 0.82 and 0.015 above the query's baseline, MAZ-167) applies to every receipt chunk. e5 similarities of short queries to whole receipts are compressed and lower than to short entries (0.75–0.86). Measured against the fixture receipts: the French pharmacy receipt matches "medication" (0.844, threshold 0.824), "médicaments" (0.856 / 0.824), "pharmacy" (0.853 / 0.824) and "drugstore" (0.831 / 0.826). The English hardware receipt matches no natural query by meaning: "tools" 0.827 / 0.836, "hardware" 0.825 / 0.825, "power tools" 0.819 / 0.820, "hardware store" 0.818 / 0.820. It is still found by its text ("wood screws", "hammer"). Under the old fixed 0.82, "tools" matched it, but so did the unrelated "outils" → the pharmacy receipt (0.823 / 0.836); the fixtures now pin that rejection. A French query for an English receipt ("outils" → hardware, 0.796) stays below the threshold.

## Offline, pending edits and demo

- Clients keep their local search, using the same normalization with tiers 1–2 only (no typo or meaning matching offline).
- With pending local edits, or offline, clients search one complete local result set (durable local data plus cached shared projections) and label it "On this device". They never mix local rows into server pages.
- After sync, clients discard server pages and search again. Demo mode searches only its in-memory sample.
- MAZ-73/88 build the client screens. MAZ-71 provides the native rules: `LedgerSyncModel.localSearch` over durable pending work, and `reconcile` drops a server page when a save or sync landed after the search started, or while changes are pending or the device is offline ([native offline sync](../ios-offline-sync.md#local-search-and-server-results)). MAZ-87 does the same for the browser: Activity searches the durable local ledger ("on this device", personal entries only, since shared projections aren't cached offline yet) while changes are pending, while offline, when the server can't be reached, or when the server's results predate the latest local change, and server results are refetched after a sync that changed the server ledger ([browser offline sync](../web-offline-sync.md#search)).

## Contract changes (done in MAZ-121, contract 1.4.0)

- `SearchRequest` is the request above (`SearchPeriod`, `day` and `mode` are gone); `SearchItem` has `match`; `SearchResponse` no longer has `ledgerRevision`, `searchRevision` or `scope`.
- `contracts/fixtures/search-cases.json` has the new `foldCases` (21 normalization cases, checked by the TypeScript reference normalizer `tests/core/search-normalization.ts` and the .NET `SearchTextTests`), a server ledger with title/text/typo/filter/sort/pagination cases and English, French and mixed-language meaning cases (run by `SearchFixtureTests` on real PostgreSQL with the real model). The legacy `substringCases` and `pendingCases` still describe the current app's local search, which is unchanged.
- The operation is `x-implementation: backend`.
- MAZ-125 (no schema change to the contract): the description mentions receipt text, and `receiptCases` in `search-cases.json` holds a ledger, synthetic receipt lines and text, typo and English/French meaning cases run by `ReceiptTextSearchTests` with the real engine and model.

## Out of scope for v1

Snippets and highlighting, languages beyond what the multilingual model covers being tested (v1 tests English and French), external search services, and hosted embedding APIs.
