# Ledger sync baseline (MAZ-186)

What whole-document personal ledger sync costs ([ledger](ledger.md)): payload sizes and times for a save, a read and the web client's sync pass, for a typical ledger (2,000 entries) and a large one (50,000). Measured on 2026-11-25, first as it was ([before](#before)), then with the two fixes the owner chose instead of a change-based sync ([after](#after-linear-merge-and-compressed-responses)): a linear web merge and compressed ledger responses. The change-based sync is recorded and deferred in [ADR 005](architecture.md#adr-005-change-based-personal-ledger-sync-deferred).

## Summary

| Median | 2,000 before | 2,000 after | 50,000 before | 50,000 after |
| --- | --- | --- | --- | --- |
| Each ledger response on the wire | 352 KiB | 57 KiB (br) | 8.52 MiB | 1.34 MiB (br) |
| `GET`, server time | 27 ms | 39 ms | 546 ms | 625 ms |
| `PUT` of one changed entry, server time | 142 ms | 125 ms | 3.1 s | 2.7 s |
| Web sync pass, nothing changed | 0.20 s | 0.21 s | 5.5 s | 4.2 s |
| Web sync pass that merges and saves a local change | 0.46 s | 0.39 s | 43 s | 11 s |

Request bodies are the same in both runs (352 KiB and 8.52 MiB per `PUT`): clients don't compress them. Server times move by tens of milliseconds between runs on this shared two-CPU machine. Compression itself adds roughly 10 ms per response at 2,000 entries and 0.1–0.3 s at 50,000 (Brotli at quality 4 on 8.5 MiB). The 50,000-entry passes stay at several seconds of client time, mostly parsing, normalizing and comparing the whole document; only a change-based sync would remove that.

## Before

Sizes are raw / gzip / Brotli. **Nothing was compressed as served**: the API registers no response compression, and the `penny-web` nginx (`deploy/web/default.conf.template`) proxies `/api/` without `gzip` (nginx's default is off). Every response came back `identity` although the client asked for `gzip, br`, and browsers and `URLSession` never compress request bodies. The gzip and Brotli columns show what on-the-fly compression would give (gzip level 6, Brotli quality 4); they are not what the wire carried before.

Times are in milliseconds, median (p90) over the runs, after warm-up. **Server** is the API's own request time (its `HTTP … responded … in … ms` log line). **Round trip** is the client's request until the whole body was read (and decoded, after), on loopback, so it has no real network in it. **Web parse** is `JSON.parse` plus the offline store's ledger check (`parseLedger`). **Web engine** is the rest of the pass in the web sync engine: merge, materialize, normalize, compare and the store write. **Web pass** is the whole `sync()` call.

### Before: 2,000 entries (20 runs)

| Scenario | Requests | Request bytes | Response bytes | Server ms | Round trip ms | Web parse ms | Web engine ms | Web pass ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/ledger` | GET | 0 | 352 KiB / 54 KiB / 56 KiB | 26.5 (41.2) | 34.7 (47.6) | – | – | – |
| `PUT /api/ledger`, one entry changed | PUT | 352 KiB / 56 KiB / 58 KiB | 352 KiB / 56 KiB / 58 KiB | 142.3 (171.5) | 147.1 (177.2) | – | – | – |
| Web sync pass, no change | GET | 0 | 352 KiB / 54 KiB / 56 KiB | 27.6 (39.3) | 29.7 (41.4) | 23.7 (29.0) | 142.8 (185.8) | 201.5 (258.1) |
| Web sync pass, one remote change | GET | 0 | 352 KiB / 54 KiB / 56 KiB | 27.6 (37.0) | 32.0 (39.6) | 24.1 (27.1) | 153.7 (176.5) | 206.3 (244.9) |
| Web sync pass, one remote and one local change | GET + PUT | 352 KiB / 55 KiB / 56 KiB | 704 KiB / 109 KiB / 112 KiB | 156.1 (190.4) | 164.8 (199.2) | 43.0 (56.2) | 255.6 (298.1) | 457.2 (524.8) |

### Before: 50,000 entries (10 runs)

| Scenario | Requests | Request bytes | Response bytes | Server ms | Round trip ms | Web parse ms | Web engine ms | Web pass ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/ledger` | GET | 0 | 8.52 MiB / 1.26 MiB / 1.26 MiB | 546.0 (653.0) | 578.0 (667.1) | – | – | – |
| `PUT /api/ledger`, one entry changed | PUT | 8.52 MiB / 1.33 MiB / 1.32 MiB | 8.52 MiB / 1.33 MiB / 1.32 MiB | 3,149.8 (3,537.4) | 3,233.9 (3,653.5) | – | – | – |
| Web sync pass, no change | GET | 0 | 8.52 MiB / 1.26 MiB / 1.26 MiB | 456.7 (598.1) | 470.9 (634.9) | 644.1 (768.2) | 4,030.7 (5,222.2) | 5,514.3 (6,625.3) |
| Web sync pass, one remote change | GET | 0 | 8.52 MiB / 1.26 MiB / 1.26 MiB | 385.2 (508.0) | 394.9 (518.5) | 466.7 (572.9) | 2,922.9 (3,406.6) | 3,881.5 (4,291.8) |
| Web sync pass, one remote and one local change | GET + PUT | 8.52 MiB / 1.26 MiB / 1.26 MiB | 17.04 MiB / 2.52 MiB / 2.51 MiB | 2,912.8 (3,168.9) | 2,941.9 (3,214.1) | 1,215.3 (1,294.3) | 38,756.4 (41,078.1) | 43,046.4 (44,979.3) |

The two passes without a merge differ by about a second of engine time: the API, PostgreSQL and the client share two CPUs, so the search worker's embedding after each remote save competes with the client. Read them as "3 to 5 s".

### What stood out

- **Every pass downloads the whole ledger, even when nothing changed**: 352 KiB at 2,000 entries and 8.5 MiB at 50,000, for what a change feed would answer in well under 1 KiB. A save of one changed entry sends and receives the whole document again (2 × 352 KiB, or 2 × 8.5 MiB).
- **Size grows linearly**, about 180 bytes per entry raw and about 27 bytes per entry with gzip or Brotli. Brotli at an on-the-fly level does no better than gzip on this JSON.
- **Compression alone would cut the bytes about 6.5 times** on every response (done, [after](#after-linear-merge-and-compressed-responses)), without a contract change. It doesn't help request bodies (the whole-document `PUT`), and it doesn't reduce the server's or the client's work.
- **Server time on a save grows with the ledger**, because the server re-parses and re-validates the whole document and diffs every row: about 140 ms at 2,000 entries and about 3.1 s at 50,000.
- **The web client's merge is quadratic.** A pass that merges a pending local change spends about 39 s in the browser at 50,000 entries, almost all of it in `mergeItems` (`apps/web/src/domain/merge.ts`), which finds removed records with `Array.some` inside `Array.filter`. In isolation the merge takes 56 ms at 2,000 entries, 1.4 s at 10,000 and 42 s at 50,000; with a `Set` of ids, as the Swift `LedgerMerge` already has, it takes 20 ms, 104 ms and 0.44 s with the same result. Fixed ([after](#after-linear-merge-and-compressed-responses)): the change-based sync would keep this merge, so it was needed either way.
- **Even with no change, the web pass costs** about 0.2 s of client time at 2,000 entries and 4 to 5.5 s at 50,000 (parse, normalize, compare), all on the main thread.

## After: linear merge and compressed responses

Same method, machine and runs, after two changes:

- **Linear merge.** `mergeItems` in `apps/web/src/domain/merge.ts` checks removed records against a `Set` of the local ids instead of searching the list for each one. The results are identical: the golden merge fixtures are unchanged. `tests/domain/merge-scale.test.ts` merges 50,000 entries within 5 s, far above the linear merge's half a second and far below the quadratic merge's 40 s.
- **Compressed ledger responses.** The API compresses `GET` and `PUT /api/ledger` responses with Brotli or gzip (`CompressionLevel.Optimal`: Brotli quality 4, gzip level 6) when the client sends `Accept-Encoding` (`Api/Middleware/LedgerResponseCompression`). No other route is compressed, because of BREACH. The API does it, rather than nginx, so every client and every proxy setup gets it. `Fastest` served 98 KiB instead of 57 KiB at 2,000 entries, for no measurable server time saved.

"Served response" is the body as it came over the wire.

### After: 2,000 entries (20 runs)

| Scenario | Requests | Request bytes | Served response | Server ms | Round trip ms | Web parse ms | Web engine ms | Web pass ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/ledger` | GET | 0 | 57 KiB (br) | 39.0 (50.7) | 43.8 (54.6) | – | – | – |
| `PUT /api/ledger`, one entry changed | PUT | 352 KiB | 59 KiB (br) | 124.7 (156.4) | 128.0 (159.9) | – | – | – |
| Web sync pass, no change | GET | 0 | 57 KiB (br) | 35.5 (39.6) | 38.3 (45.8) | 23.0 (25.5) | 152.5 (177.0) | 212.7 (239.8) |
| Web sync pass, one remote change | GET | 0 | 57 KiB (br) | 32.2 (40.2) | 36.3 (43.9) | 23.4 (26.4) | 155.3 (166.9) | 212.8 (239.3) |
| Web sync pass, one remote and one local change | GET + PUT | 352 KiB | 114 KiB (br) | 163.9 (210.4) | 171.8 (216.5) | 46.0 (51.0) | 169.5 (205.7) | 387.0 (459.3) |

### After: 50,000 entries (10 runs)

| Scenario | Requests | Request bytes | Served response | Server ms | Round trip ms | Web parse ms | Web engine ms | Web pass ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/ledger` | GET | 0 | 1.34 MiB (br) | 625.4 (750.4) | 656.1 (797.8) | – | – | – |
| `PUT /api/ledger`, one entry changed | PUT | 8.52 MiB | 1.42 MiB (br) | 2,686.5 (2,840.7) | 2,726.6 (2,901.1) | – | – | – |
| Web sync pass, no change | GET | 0 | 1.34 MiB (br) | 543.3 (747.2) | 586.0 (768.6) | 543.1 (616.5) | 3,369.5 (3,977.0) | 4,238.0 (5,351.4) |
| Web sync pass, one remote change | GET | 0 | 1.34 MiB (br) | 711.4 (891.1) | 770.7 (913.4) | 496.2 (804.8) | 3,229.6 (4,192.8) | 4,633.4 (5,602.5) |
| Web sync pass, one remote and one local change | GET + PUT | 8.52 MiB | 2.68 MiB (br) | 4,196.9 (4,812.4) | 4,315.1 (4,887.1) | 1,475.5 (1,697.7) | 5,615.7 (6,449.9) | 11,176.0 (12,444.2) |

The merge pass's `PUT` took longer than in the before run (4.2 s against 2.9 s of server time). The one-entry `PUT` alone got faster (2.7 s against 3.1 s), so most of the difference is contention on the shared CPUs, plus about 0.3 s of Brotli on the 8.5 MiB answer.

## iOS

iOS wasn't measured: this machine (Linux) can't run the simulator. The iOS sync engine (`PennyData/Offline/LedgerSyncEngine.swift`) makes the same calls in the same order (a `GET /api/ledger` at the start of every pass, then a whole-document `PUT` when the merge differs), and `URLSession` sends `Accept-Encoding: gzip, deflate, br` and decodes the answer itself, so **the request and response sizes and the server times above (before and after) apply to iOS unchanged**. iOS parse and merge times are not known; its merge uses sets, so it doesn't have the web's quadratic step.

## Method

Script: `apps/web/scripts/ledger-sync-bench.ts` (helpers in `apps/web/scripts/ledger-bench/`, tests in `apps/web/tests/ledger-bench.test.ts`). Re-run it from the repository root:

```sh
node scripts/test-env/penny-env.mjs up
npm --prefix apps/web run bench:ledger-sync -- --sizes 2000 --runs 20
npm --prefix apps/web run bench:ledger-sync -- --sizes 50000 --runs 10   # about 8 minutes (15 before the merge fix)
node scripts/test-env/penny-env.mjs down
```

`--json <file>` also writes every sample. The script uses the environment this checkout started last (or `PENNY_TEST_RUN`), trusts only its certificate and reads the API's log for server times.

1. **Environment.** The full-stack test environment ([test environment](test-environment.md)): the real .NET API (Release build, `Testing` environment, search and recurrence workers on) over HTTPS on loopback, and PostgreSQL 18 in a Podman container on tmpfs. Calls go straight to the API, not through nginx, which passes the API's encoding through unchanged. They use `node:https`, not `fetch`, so the script sees the bytes as served.
2. **Warm-up.** A fresh API is still compiling: its first saves took 300–870 ms at 2,000 entries, against 60–170 ms later. The script first makes 30 saves and reads on a separate account, and each scenario has 2 more warm-up rounds that aren't counted.
3. **Ledgers.** `syntheticLedger` builds a deterministic v4 ledger (seed 186): 4 accounts, 13 categories, 6 trips, 3 rules, and N entries over 2023-01-01 to 2026-11-24, 90% expenses, 15% of them split, 85% with an account, 3% on a trip, some with a note, no receipts. Ids look like the web's `uid()`. Rules are due after the run's "today", so nothing materializes during a run. No real data.
4. **One account per size**, created with `POST /api/test/users` and filled with one `PUT`. Another device's changes are made over plain HTTP with the same account.
5. **Scenarios.**
   - `GET`: one read.
   - `PUT`, one entry changed: the last answer with one entry's title and amount changed, sent with its revision.
   - Web sync pass: the real web sync engine (`apps/web/src/offline/engine.ts`, with the shared merge) runs in Node with an in-memory store instead of IndexedDB, against the same API. Before each measured `sync()`: nothing (no change); another device saves one changed entry (one remote change); or that, plus a local save of a different entry made while the engine is offline, so the pass merges and saves (one remote and one local change).
6. **Machine.** The `worker` machine: Intel Core i5-4690 at 3.5 GHz, 2 CPUs, 7 GiB, NixOS, Node 24.21, .NET SDK 10.0.403, Podman 6.1. The API, PostgreSQL and the client share those 2 CPUs, so absolute times are pessimistic. Compare runs on the same machine.

What this leaves out: real network latency and bandwidth (multiply the bytes by the link), IndexedDB (the web store write was in memory), a real browser's JavaScript engine (Node uses the same V8, without rendering on the same thread) and iOS timings.
