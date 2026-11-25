# Observability with Grafana

[Back to the documentation index](../README.md)

MAZ-128. A reference stack that collects Penny's telemetry and shows it in Grafana: the API's traces, metrics and logs ([what each signal contains](operations.md#telemetry-opentelemetry)) and, once the apps send it (MAZ-129), errors and crashes from the web and iOS apps. It ships with dashboards and example alerts, and is sized for a small home server (example: i7-4790K, 32 GB).

Everything is optional. Penny runs the same without it, and telemetry stays off until you set `OTEL_EXPORTER_OTLP_ENDPOINT`.

- [Grafana Cloud](#grafana-cloud) instead of running the stack
- [Client telemetry](#client-telemetry) from the web and iOS apps, through the API
- [What runs](#what-runs)
- [Start the stack](#start-the-stack)
- [Connect the API](#connect-the-api)
- [Configuration](#configuration)
- [Retention and disk use](#retention-and-disk-use)
- [Securing Grafana](#securing-grafana)
- [Dashboards](#dashboards)
- [Alerts](#alerts)
- [Follow a user-reported error end to end](#follow-a-user-reported-error-end-to-end)
- [Upgrades](#upgrades), [Troubleshooting](#troubleshooting), [Local development](#local-development) and [Tests](#tests)

## Grafana Cloud

You can send everything to Grafana Cloud instead of running this stack.

**API.** In the Cloud portal open your stack, then **Connections → OpenTelemetry (OTLP)**: it shows the OTLP endpoint and instance ID and creates a token with write access to metrics, logs and traces. In `deploy/api.env` (keep it `chmod 600`, the header is a secret):

```dotenv
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64 of instanceID:token>
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=home
```

Make the value with `printf '%s:%s' <instanceID> <token> | base64`. Then restart the API.

**Web and iOS apps.** See [Client telemetry](#client-telemetry): the API forwards the apps' reports to Cloud with a URL or key only the server holds, so nothing secret goes into an app.

**Dashboards.** Import each file from `apps/backend/development/observability/grafana/dashboards/` (Dashboards → New → Import) and pick your `grafanacloud-…-prom`, `-logs` and `-traces` data sources. They have not been checked against Cloud yet. If the Environment or Instance filter empties panels, leave it on All. Frontend Observability has its own web dashboards; **Penny clients** is built for the self-hosted pipeline.

**Alerts.** `grafana/provisioning/alerting/penny.yaml` is a file Grafana reads at startup and refers to local data source ids, so it does not load into Cloud. Recreate the rules in Alerting → Alert rules using the queries from that file.

## Client telemetry

MAZ-129. The web and iOS apps can report errors, crashes and performance, and the web app can record Session Replay (the iOS app has no replay). Everything is **opt-in twice**: off on the server until you configure it, and then off in each browser or on each device until the person agrees.

Clients are untrusted, so they never talk to your collector. They post to the Penny API with their session (`POST /api/telemetry/faro` for the web app's Grafana Faro reports, `POST /api/telemetry/otlp/v1/traces` and `/v1/logs` for the iOS app's OTLP/HTTP JSON). The API:

- requires the person's session cookie or bearer token (401 without one), and answers 404 while client telemetry is off;
- limits each session to `ClientTelemetry__RateLimitPermits` requests a minute (429 with `Retry-After`, which Faro and the OpenTelemetry exporters honour) and each request to `ClientTelemetry__MaxPayloadBytes` (413), and accepts uncompressed JSON only (415);
- checks the shape (400 otherwise): a Faro body with `meta.app.name` `penny-web` and only Faro's own sections, or OTLP whose every resource has `service.name` `penny-ios`, so nothing a client sends can look like the API's own telemetry;
- scrubs again, whatever the client did: URLs keep their origin and the shape of their path (ids become `:id`, query strings and fragments go), and error and log messages lose emails, quoted text and numbers. Faro's `meta.user`, `meta.geo` and free-form error context are dropped;
- re-masks Session Replay (below), or drops replay events when the server doesn't offer replay;
- drops a request whose `Idempotency-Key` the same person sent in the last ten minutes (Faro retries with the same key), still answering 202;
- forwards from a bounded background queue, so a slow or unreachable collector never slows the app; reports that can't be delivered are dropped. Outgoing calls aren't traced, so the collector URL never appears in spans.

The collector stays private: your Alloy on the `penny` network, or Grafana Cloud with a key only the server holds. Nothing reaches Alloy from outside the API.

### Turn it on

In `deploy/api.env` (or `services.penny.settings.ClientTelemetry` on NixOS), then restart the API:

| Setting | Default | Meaning |
| --- | --- | --- |
| `ClientTelemetry__FaroUrl` | unset (web off) | Where web reports go: your Alloy's Faro receiver (`http://alloy:12347/collect` with this stack) or a Grafana Cloud Frontend Observability collector URL |
| `ClientTelemetry__OtlpEndpoint` | unset (iOS off) | OTLP/HTTP base URL for the iOS app's traces and logs (`/v1/traces` and `/v1/logs` are appended): `http://alloy:4319` with this stack, or Grafana Cloud's OTLP gateway |
| `ClientTelemetry__OtlpHeaders` | none | `key=value` pairs sent with OTLP, for example `Authorization=Basic%20<base64 of instanceID:token>` for Grafana Cloud. A secret: keep `api.env` `chmod 600` |
| `ClientTelemetry__SessionReplay` | `false` | Let the web app offer Session Replay. Needs `FaroUrl` and a Grafana Cloud stack with Session Replay enabled |
| `ClientTelemetry__RateLimitPermits` | `120` | Requests per session per minute (1 to 10000) |
| `ClientTelemetry__MaxPayloadBytes` | `1048576` | Largest accepted request body (16 KiB to 8 MiB). Keep it at or below your collector's limit (Alloy's Faro receiver: 1 MiB) |

The API refuses to start with a malformed URL (not http or https, with credentials, a query or a fragment), with replay but no Faro URL, or with headers but no OTLP endpoint. `GET /api/info` then reports `telemetry: { web, sessionReplay, native }`, which is how the apps know whether to ask.

**With Grafana Cloud:** in **Frontend Observability**, create an app named `penny-web` and copy its collector URL (`https://faro-collector-prod-<region>.grafana.net/collect/<key>`) into `ClientTelemetry__FaroUrl`. No CORS origin is needed: the server posts, not the browser. Sessions, errors and web vitals appear within a minute of someone agreeing to share. To follow a browser request into the API, send the API's own traces to the same stack ([Grafana Cloud](#grafana-cloud)).

**Self-hosted:** with this stack, `ClientTelemetry__FaroUrl=http://alloy:12347/collect` and `ClientTelemetry__OtlpEndpoint=http://alloy:4319`. Web reports become Loki lines labelled `service_name="penny-web"` and Faro traces join Tempo; the **Penny clients** dashboard reads both. Alloy's Faro receiver also limits everyone together to 50 requests a second (burst 100).

### What people see

When the server offers reports, the web app asks once per browser, after sign-in: **Help fix problems faster?** with **Share reports** (errors and performance) and **Don't share**. **Settings › Privacy** then has a switch for each kind: error reports, performance data and, when the server offers it, **Record sessions**. Choices are saved in the browser, not the account. Nothing is sent before sign-in, in the demo, or for a kind that is switched off; errors before sign-in are not reported.

What the web app sends when allowed (`apps/web/src/telemetry/`):

- **Errors:** unhandled errors and rejections, with the browser and app version. Console output is never captured.
- **Performance:** web vitals, page loads and navigation, request timings, and traces of its `/api/` calls. Those calls carry `traceparent`, so a slow page links to the API's spans. The API continues the trace but samples by its own rule (`OTEL_TRACES_SAMPLER`): a client's `sampled` flag never decides.
- **Session Replay:** a recording of clicks, scrolling and page changes. Every text and every field is masked by the recorder (`maskTextSelector: "*"`, `maskAllInputs`), images, video and canvases are blocked, and both the browser and the API mask every attribute that can carry content (`aria-label`, `title`, `alt`, `placeholder`, ids, data attributes) and inline images. What remains is the page's layout and styles. Grafana Cloud keeps replays for 30 days. Self-hosted Alloy has no replay viewer, so leave replay off there.
- No user id, email or name, no geolocation, and a random session id per tab.

The iOS app (when `ClientTelemetry__OtlpEndpoint` is set) asks the same question once per install, after sign-in, and has **Settings › Privacy** with **Share crash reports** and **Share performance data**. When allowed it sends crashes and hangs (from Apple's MetricKit, on the launch after them, with frames to symbolicate with the build's dSYMs), server errors on its API calls, and spans for its API calls and cold launch, with `traceparent` on those calls. Crashes that happen before sign-in wait on the device and are sent after it. Details, scrubbing and symbolication: [native crash and performance reports](../ios/monitoring.md).

### What the apps send

The contract the **Penny clients** dashboard and the crash alert read (the web app follows it through Faro, the iOS app through OTLP/HTTP JSON):

- `service.name` is `penny-web` or `penny-ios`; `service.version` is the app version.
- An **error** is a log record with severity ERROR (17–20) and `exception.type`. Faro exceptions (`kind=exception`) count too.
- A **crash** is a log record with severity FATAL (21 or more), sent on the next launch.
- Client spans for API calls send `traceparent`, so the API continues the same trace.
- Telemetry is opt-in per server and per person, and off in demo mode. It carries no credentials, emails, search text, ledger contents or amounts.

## What runs

```text
API ──OTLP gRPC :4317──▶ ┌───────┐ ──traces──▶ Tempo ─┐
         (penny network) │ Alloy │ ──logs────▶ Loki  ─┼──▶ Grafana :3000 (loopback)
web/iOS ──▶ API ──────▶│       │ ──metrics─▶ Prometheus
  /api/telemetry ──▶ Faro :12347, OTLP/HTTP :4319 (penny network only)
                         └───────┘
```

| Service | Image (pinned by digest) | Role | Default memory limit |
| --- | --- | --- | --- |
| `alloy` | `grafana/alloy` v1.21.1 | One collector for every signal: OTLP from the API, and client telemetry the API forwards | 512 MiB |
| `loki` | `grafana/loki` 3.6.19, single binary | Logs, filesystem storage | 1 GiB |
| `tempo` | `grafana/tempo` 2.10.10, single binary | Traces, local storage | 1 GiB |
| `prometheus` | `prom/prometheus` v3.15.1 | Metrics through its native OTLP receiver (nothing is scraped) | 768 MiB |
| `grafana` | `grafana/grafana` 13.2.5 | Data sources, dashboards and alert rules provisioned from files | 512 MiB |

The files live in `apps/backend/development/observability/`: `compose.yaml`, `.env.example`, the Alloy, Loki, Tempo and Prometheus configs, and `grafana/` (provisioning and dashboards). Local development uses the same files ([Local development](#local-development)), so there is one copy of each.

The data sources are linked: a log line opens its trace, and a span opens its logs and its service's metrics.

## Start the stack

You need a checkout, or a copy of `apps/backend/development/observability/`, on the server that runs [Penny's Compose stack](deployment.md). Start Penny first, because the observability stack joins its network.

```sh
cd apps/backend/development/observability
cp .env.example .env && chmod 600 .env
# set GRAFANA_ADMIN_PASSWORD (openssl rand -base64 24)
docker compose up -d --wait
```

Open `http://127.0.0.1:3000` (through an SSH tunnel, or [behind your proxy](#securing-grafana)) and sign in as `admin`. The **Penny** folder holds the dashboards and the alert rules.

If Penny's Compose project is not called `penny`, set `PENNY_NETWORK` to its network (`<project>_penny`; `docker network ls` lists it).

## Connect the API

Add to `deploy/api.env` and restart the API (`docker compose up -d api` in `deploy/`):

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4317
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=home
```

`alloy` resolves on the `penny` network. Within a minute, **Penny API** shows the instance under Instances. The [telemetry settings](operations.md#telemetry-opentelemetry) list the other variables (sampling, export intervals, headers for a remote collector). Name the environment so you can tell servers apart if several report to one Grafana.

The NixOS module runs no containers; point `OTEL_EXPORTER_OTLP_ENDPOINT` at an Alloy or OpenTelemetry Collector you run (the `config.alloy` here works as a starting point).

## Configuration

`apps/backend/development/observability/.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `GRAFANA_ADMIN_PASSWORD` | required | Password of the Grafana `admin` user, set on first start. Later changes go through Grafana (`grafana cli admin reset-admin-password`) |
| `GRAFANA_ADMIN_USER` | `admin` | |
| `GRAFANA_BIND`, `GRAFANA_PORT` | `127.0.0.1`, `3000` | Where Grafana is published |
| `GRAFANA_ROOT_URL` | `http://localhost:3000/` | The public address when a proxy serves Grafana; links in alerts use it |
| `GRAFANA_SECURE_COOKIES` | `false` | `true` when Grafana is served over HTTPS |
| `PENNY_CLIENT_SERVICES` | `penny-web\|penny-ios` | Regular expression of accepted client `service.name` values |
| `PENNY_LOGS_RETENTION` | `168h` | Loki deletes logs older than this |
| `PENNY_TRACES_RETENTION` | `72h` | Tempo deletes traces older than this |
| `PENNY_METRICS_RETENTION`, `PENNY_METRICS_MAX_SIZE` | `15d`, `5GB` | Prometheus deletes the oldest metrics past either limit |
| `PENNY_NETWORK` | `penny_penny` | Penny's Compose network, which Alloy joins |
| `PENNY_{LOKI,TEMPO,PROMETHEUS,ALLOY,GRAFANA}_MEMORY` | see [What runs](#what-runs) | Container memory limits |

## Retention and disk use

Data lives in five named volumes (`penny-observability_loki`, `_tempo`, `_prometheus`, `_alloy`, `_grafana`). Check their size with `docker system df -v | grep penny-observability`.

- **Metrics** are bounded by time and by `PENNY_METRICS_MAX_SIZE`, whichever is reached first. Penny exports a fixed set of series per instance; routes, jobs and status codes are the only labels that vary.
- **Logs and traces** grow with traffic. They are deleted by age only, so lower `PENNY_LOGS_RETENTION` or `PENNY_TRACES_RETENTION` if the volumes grow too much. To cut trace volume at the source, sample in the API (`OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.25`).
- Logs follow the API's log levels (`Logging__LogLevel__*` in `api.env`); raising a level cuts log volume at the source.
- A collector outage leaves a gap in the data. Nothing is queued on disk, on either side.

Deleting a volume (`docker compose down -v`) deletes that history and, for `_grafana`, any dashboards or contact points you made in the UI.

## Securing Grafana

- Grafana is published on loopback only, requires sign-in, and has anonymous access and sign-up turned off. Reach it through an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 server`) or a TLS proxy (then set `GRAFANA_ROOT_URL` and `GRAFANA_SECURE_COOKIES=true`). Grafana is an administration tool: don't publish it to the internet without single sign-on or a VPN in front.
- Loki, Tempo and Prometheus are not published at all. Query them through Grafana.
- Telemetry contains no user content ([privacy guarantees](operations.md#privacy-guarantees)): ids, routes, status codes, exception types and parameterized SQL. It still shows when and how Penny is used, so give Grafana access to operators only.
- Alloy publishes no port. The API reaches it on the `penny` network, and clients send telemetry to the API ([Client telemetry](#client-telemetry)).
- Every container drops all capabilities and runs with `no-new-privileges`.

## Dashboards

All are in the **Penny** folder and linked from each other's **Penny dashboards** menu. They filter by service, environment and instance, and pick Prometheus, Loki and Tempo from variables, so they also import into a Grafana whose data sources have other names (Dashboards → New → Import, then choose the data sources at the top).

| Dashboard | What it answers |
| --- | --- |
| **Penny API** | Is it up and healthy? Request rate, 5xx ratio, latency (p50/p95/p99) overall and by route, readiness failures, unhandled exceptions, a per-route table, warning and error logs, log search, failed and slow traces, and the trace for a request id |
| **Penny database** | Npgsql pool use against its limit, connection time, query latency and throughput, bytes, and slow PostgreSQL spans with their parameterized SQL |
| **Penny auth and rate limits** | Sign-ins by method and outcome, failure kinds, rejections per rate-limit policy, session and authorization results, 401/403/429 by route, ledger save conflicts, household joins |
| **Penny background jobs** | Items and failures per job, lag from due to claimed (p50/p95), receipt text results and time, provider calls (OIDC, APNs), and worker-pass traces |
| **Penny .NET runtime** | CPU, memory (working set and GC heap), garbage collection, allocation, thread pool, lock contention, exceptions by type, Kestrel connections |
| **Penny clients** | Errors and crashes from the web and iOS apps, top exceptions, errors and crashes by app version, recent error lines, failed client operations and slow API calls seen from the client |

Vertical purple markers show API starts.

Provisioned dashboards are read-only. To change one, edit `scripts/grafana-dashboards.mjs`, run `node scripts/grafana-dashboards.mjs` and restart Grafana. `node scripts/grafana-dashboards.mjs --check` (also part of `npm test`) fails when the JSON and the script disagree. To experiment, use **Save as** in Grafana for your own copy.

## Alerts

Grafana evaluates the rules in `grafana/provisioning/alerting/penny.yaml`:

| Rule | Fires when | Severity |
| --- | --- | --- |
| Penny API not reporting | No telemetry from the API for 5 minutes (down, crash-looping, or cannot reach Alloy) | critical |
| Penny API readiness failing | `/api/ready` (the container health check) answered non-200 for 2 minutes | critical |
| Penny API 5xx error ratio high | More than 5% of requests failed with 5xx over 10 minutes, with at least 20 requests | critical |
| Penny API p95 latency high | p95 above 2 s for 15 minutes, with at least 20 requests | warning |
| Penny background job lagging | A job's p95 lag (due → claimed) above 15 minutes for 15 minutes; recurrence excluded | warning |
| Penny recurrences a day late | Recurrence p95 lag of a day or more, for an hour | warning |
| Penny background job failures | More than 5 failures of one job in 15 minutes | warning |
| Penny emailed receipt ingress refusing signatures | More than 10 unsigned or badly signed requests to `/api/inbound-mail` in 15 minutes: the Email Worker's secret differs from the API's, or something else reaches the endpoint ([emailed receipts](operations.md#emailed-receipts)) | warning |
| Penny emailed receipts not converting | More than 3 emailed receipts waiting for `penny-render` in 30 minutes, for 15 minutes ([penny-render is down](operations.md#penny-render-is-down)) | warning |
| Penny app crashes | A web or iOS crash reported in the last hour | warning |

**No contact point is provisioned.** Until you add one, alerts show only under Alerting → Alert rules. Add a contact point (email needs Grafana's `GF_SMTP_*` settings; ntfy, Telegram, Slack and webhooks need none) and set it on the default notification policy. These alerts complement the [suggested checks](operations.md) that telemetry cannot see: disk space, backups and the `*-verify` commands.

The thresholds are starting points. Provisioned rules are read-only in the UI: edit the file and restart Grafana, or duplicate a rule in the UI and pause the provisioned one.

## Follow a user-reported error end to end

1. **Get an id.** Every API response carries `X-Request-Id`, and 500 errors log `request <RequestId>, trace <TraceId>`. A client error or crash line carries a trace id.
2. **Find the trace.** In **Penny API**, paste the request id into **Request id**; the **Trace by request id** panel lists it. From a client error, expand the line in **Penny clients → Recent errors and crashes** and follow its trace id, or pick it from **Failed client operations**.
3. **Read the trace.** It shows the client span (when the app sent one), the API request named by its route, each PostgreSQL command with its parameterized statement, and calls to the OIDC provider or APNs. A failed span carries `error.type`, the status code or exception type.
4. **Read the logs.** From any span, **Logs for this span** opens the API's log lines for that request in Loki, including the exception type of a 500.
5. **Check the scope.** **Penny API → 4xx and 5xx by route** and **Penny clients → Errors by app version** show whether it was one request or a pattern.

## Upgrades

Images are pinned by tag and digest in `compose.yaml` and in `apps/backend/src/Penny.Backend.AppHost/ObservabilityImages.cs`; a core test keeps the two identical. To upgrade, change both, read the release notes for config changes, then run `docker compose pull && docker compose up -d --wait`. Data volumes carry over. Loki and Tempo document breaking storage changes in their upgrade guides.

## Troubleshooting

- **No API data.** Check `OTEL_EXPORTER_OTLP_ENDPOINT` in `deploy/api.env` and that the API was restarted after setting it, that Alloy is on Penny's network (`docker network inspect penny_penny` lists `alloy`), and `docker compose logs alloy` for export errors.
- **No client telemetry.** Check `GET /api/info` reports `telemetry.web` (or `native`) true, that the person agreed in the prompt or **Settings › Privacy**, and the API's log for "The telemetry collector refused" or "could not be reached" warnings. The `penny.client_telemetry.reports` metric counts reports by outcome (accepted, duplicate, invalid, dropped, forwarded, refused, failed).
- **Alloy restarts with "permission denied".** It must run as the `alloy` user (`user: alloy` in `compose.yaml`); its data directory belongs to that user.
- **A dashboard change does not show.** Grafana reads provisioned files at startup: `docker compose restart grafana`.
- **Panels say "No data".** Panels for things that have not happened (no 5xx, no job failures, no clients) stay empty; check the time range first.

## Local development

The Aspire AppHost (`apps/backend/README.md`) starts the same Alloy, Loki, Tempo, Prometheus and Grafana from these files, with the dashboards and alert rules, anonymous admin access and 3-day retention. The API runs with `ClientTelemetry__FaroUrl` and `ClientTelemetry__OtlpEndpoint` pointing at that Alloy, so the web app asks for consent and, once you agree, its reports reach the **Penny clients** dashboard.

## Tests

- `npm test` runs `scripts/tests/observability.test.ts`: dashboards match their generator, panels use data source variables and the standard filters, alert rules use provisioned data sources, only Grafana is published and Alloy allows no browser origin, and images match the AppHost pins.
- `scripts/observability-smoke.mjs` (CI, after the deploy smoke test) starts Penny with telemetry on and this stack beside it. It then checks that API metrics, logs and traces (including SQL spans) for a request id reach Prometheus, Loki and Tempo through Grafana. It also checks that client errors and crashes sent to the API's telemetry endpoint arrive, and that the endpoint refuses callers without a session, oversized bodies and records impersonating the API. Finally it checks that Grafana provisioned every data source, dashboard and alert rule, that every rule evaluates, and that the crash alert fires.

```sh
PENNY_SMOKE_API_IMAGE=localhost/penny-api:dev PENNY_SMOKE_WEB_IMAGE=localhost/penny-web:dev \
  node scripts/observability-smoke.mjs
```
