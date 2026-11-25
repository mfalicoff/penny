# Native crash and performance reports

MAZ-129. The iPhone and iPad app can report crashes, hangs, errors and performance to the person's own Penny server, which forwards them to the operator's Grafana stack. It's **opt-in twice**: the server offers it only when its operator turns client telemetry on ([client telemetry](../self-hosting/observability.md#client-telemetry)), and then the app sends nothing until the person agrees. There is no Session Replay on iOS (owner decision, 2026-11-25).

The code is in `PennyData/Telemetry/` (rules, encoding, recorder, MetricKit) and `PennyUI/Monitoring/` (the sheet, Settings › Privacy and the shell wiring).

## What people see

- **Help fix problems faster?** (card `iphone-monitoring-prompt`). Asked once per install, over Home after sign-in, when `GET /api/info` reports `telemetry.native` and after "What should people call you?". **Share reports** turns on crash reports and performance data; **Don't share** keeps both off. Only the buttons answer: the sheet can't be swiped away.
- **Settings › Privacy** (card `iphone-privacy`), a Preferences row shown while the account's server takes reports: **Share crash reports** (crashes and errors) and **Share performance data** (how long screens and requests take), the "Reports never include…" footnote, and the server's **Privacy Policy**, which opens in Safari.

Choices belong to the install, not the account (`penny.telemetry` in the app's preferences), like Appearance. Signing out keeps them. Turning crash reports off drops any crash still waiting to be sent.

## What the app sends

Everything goes to the signed-in account's own server, with its session: OTLP/HTTP JSON to `POST /api/telemetry/otlp/v1/logs` and `/v1/traces`. Nothing ever goes to a collector, to Apple's or anyone else's service, or to a server the account doesn't belong to.

| Kind | Switch | What | OTLP |
| --- | --- | --- | --- |
| Crash | Crash reports | MetricKit's crash diagnostic, delivered on the launch after the crash: the exception and signal (`EXC_BAD_ACCESS (SIGSEGV)`), the version and build that crashed, and the crashed thread's frames | Log record, severity FATAL (21), `exception.type`, `exception.stacktrace` |
| Hang | Crash reports | MetricKit's hang diagnostic and its duration | Log record, severity WARN (13), `exception.type` `hang` |
| Error | Crash reports | A server error (5xx) answering one of the app's API calls: the method and the scrubbed path | Log record, severity ERROR (17), `exception.type` `http.server_error` |
| API call | Performance data | Method, scrubbed path, status and duration of each call to the Penny API | Client span (`GET /api/households/:id`) |
| Launch | Performance data | A cold launch, from process start to the signed-in shell's first frame | Internal span `app.launch` |

Every report's resource has `service.name` `penny-ios`, `service.version` and `service.build`, `os.version`, `device.model.identifier` (`iPhone18,1`, never the device's name) and a `session.id` that is random per launch. There is no user, account, email or device id.

When performance data is shared, each API call also carries a W3C `traceparent`, so a slow screen links to the API's spans. The API continues the trace but samples by its own rule; the app's flag never decides.

### What it never sends

No ledger contents, titles, notes, amounts, names, emails or search text, and nothing from the demo. The app scrubs before sending (`TelemetryScrubber`, the same rules as the web app and the API, which scrubs again):

- Paths keep their shape: a segment survives only as a lowercase word or an API version, so ids become `:id`. Query strings, fragments and the server's host are dropped.
- Free text (a termination reason, a hang's duration) loses emails, quoted text and numbers.
- A crash keeps only its exception, signal, versions, architecture and frames. MetricKit's region format, memory region details and Objective-C exception messages are dropped, because a message can quote what was on screen. Binary names lose any path.

Frames are written without frame numbers and with UUIDs without dashes, because the scrubbers redact bare numbers; hex addresses and offsets survive.

## When it sends

- Reports are gathered for 20 seconds, then sent; the app also sends what's waiting when it goes to the background. Nothing waits on the main thread, and a failure never reaches the screens.
- **Before sign-in, offline, or rate limited:** crash, hang and error records wait on disk (`Application Support/Telemetry/pending-reports.json`, excluded from backups) and go out once someone signs in to a server that takes them ("buffer until sign-in"). At most 50 records younger than 14 days are kept. Spans are kept in memory only (at most 500) and dropped if they can't be sent.
- **429:** the app waits for `Retry-After` (1 second to an hour). **404:** the server turned client telemetry off, so the app stops sending until the next launch. A report the server refuses (400, 413) is dropped. Each request has a random `Idempotency-Key`.
- Batches are at most 200 records and 512 KiB, half the API's default limit; a bigger batch is split.
- **Demo:** nothing is recorded or sent, and crashes that arrive while the demo is open are dropped.

## Why no SDK

The owner left the choice between the Embrace Apple SDK and OpenTelemetry Swift open, without replay. The app uses neither, and keeps PennyKit free of third-party packages:

- The API accepts OTLP **JSON** only (415 otherwise), and the OTLP exporters of OpenTelemetry Swift, which Embrace also uses, send protobuf. Either would still need a custom JSON exporter.
- Embrace instruments `URLSession` and view controllers by swizzling and records full request URLs by default, so it would need scrubbing hooks around code we don't own, and it is built around Embrace's own backend.
- Without replay, what the issue asks for is crashes, hangs, errors, API timings and launch time. Apple's MetricKit delivers symbolicatable crash and hang diagnostics without a signal handler of our own, and the rest is a few spans and log records.

The data model is still OpenTelemetry's (`OTLPJSON`: resources, scopes, spans and log records with the semantic convention names), so switching to an SDK later changes the sender, not the dashboards.

## Symbolication

MetricKit reports frames as a binary name, an address, the binary's UUID and the offset into its text segment: `Penny 0x0000000102a4c4f4 1f0c3a5bd2e94c7f8a6b0c1d2e3f4a5b + 0x248f4`. They are symbolicated with the build's dSYMs, which never ship to devices:

- Every TestFlight build's archive keeps its dSYMs (`Penny.xcarchive/dSYMs/`). The TestFlight workflow keeps them as an Actions artifact for 30 days with the IPA, and the export uploads symbols to App Store Connect (`uploadSymbols`).
- Find the dSYM whose UUID matches the frame: `dwarfdump --uuid Penny.app.dSYM` (UUIDs print with dashes and in upper case).
- The load address is the address minus the offset. Then:

  ```sh
  atos -arch arm64 -o Penny.app.dSYM/Contents/Resources/DWARF/Penny -l 0x102a27c00 0x0000000102a4c4f4
  ```

System frames (`libswiftCore.dylib`, `UIKitCore`) need the device's OS symbols, which Xcode downloads for a connected device of that version.

Keeping dSYMs for longer than the artifact's 30 days (TestFlight builds last 90) needs a change to the release workflow, which only a person makes; it's recorded as a follow-up on MAZ-129.

## Tests

- `PennyDataTests/TelemetryTests.swift`: the scrubber with synthetic financial text, the OTLP JSON shapes the API checks, the choices (off by default, malformed reads as off), opt-in (nothing recorded or sent while a kind is off), the demo and a server that doesn't offer reports staying silent, the bearer token and `Idempotency-Key`, crashes buffered until sign-in, 404, 429 and an unreachable server, batch splitting, pending reports on disk, MetricKit crash and hang parsing, `traceparent` and scrubbed spans, server errors without content, and `/api/info`'s `telemetry.native`.
- The cards: `PENNY_STACK_TELEMETRY=1 PENNY_UI_DEVICES=iphone apps/ios/scripts/ios.sh ui-test cards` runs the stack with `penny-env --telemetry`, which offers reports and forwards them to a closed loopback port. Without it, both cards are recorded as blocked. The stack never offers reports otherwise, so no other UI test sees the sheet.
- MetricKit delivers nothing on the simulator. To check a crash end to end, install a Debug build on a device, crash it, launch it again (delivery can take a minute after the launch) and look for the FATAL record in Grafana.
