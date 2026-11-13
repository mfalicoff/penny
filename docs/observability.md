# Observability with Grafana

[Back to the documentation index](README.md)

MAZ-128. A reference stack that collects Penny's telemetry and shows it in Grafana: the API's traces, metrics and logs ([what each signal contains](operations.md#telemetry-opentelemetry)) and, once the apps send it (MAZ-129), errors and crashes from the web and iOS apps. It ships with dashboards and example alerts, and is sized for a small home server (example: i7-4790K, 32 GB).

Everything is optional. Penny runs the same without it, and telemetry stays off until you set `OTEL_EXPORTER_OTLP_ENDPOINT`.

- [Grafana Cloud](#grafana-cloud) instead of running the stack
- [Web app telemetry](#web-app-telemetry)
- [What runs](#what-runs)
- [Start the stack](#start-the-stack)
- [Connect the API](#connect-the-api)
- [Client ingest](#client-ingest) and the [client telemetry contract](#client-telemetry)
- [Configuration](#configuration)
- [Retention and disk use](#retention-and-disk-use)
- [Securing Grafana and the ingest endpoint](#securing-grafana-and-the-ingest-endpoint)
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

**Web app.** See [Web app telemetry](#web-app-telemetry): Cloud's Frontend Observability gives the browser its own collector URL, so no token goes into the app.

**Dashboards.** Import each file from `apps/backend/development/observability/grafana/dashboards/` (Dashboards → New → Import) and pick your `grafanacloud-…-prom`, `-logs` and `-traces` data sources. They have not been checked against Cloud yet. If the Environment or Instance filter empties panels, leave it on All. Frontend Observability has its own web dashboards; **Penny clients** is built for the self-hosted pipeline.

**Alerts.** `grafana/provisioning/alerting/penny.yaml` is a file Grafana reads at startup and refers to local data source ids, so it does not load into Cloud. Recreate the rules in Alerting → Alert rules using the queries from that file.

## Web app telemetry

MAZ-129. The web app can send its errors, web vitals, page and request timings, and traces of its `/api/` calls to a [Grafana Faro](https://grafana.com/oss/faro/) collector. It is **off** unless the server sets a collector, and it never sends anything in the demo.

**Turn it on with Grafana Cloud:**

1. In Grafana Cloud, open **Frontend Observability** and create an app named `penny-web`. Allow your Penny origin (for example `https://penny.example.com`) as a CORS origin.
2. Copy the collector URL it shows, of the form `https://faro-collector-prod-<region>.grafana.net/collect/<key>`. The key identifies the app; it is not a secret, and every browser sees it.
3. Set it in `deploy/.env` and recreate `web`:

   ```dotenv
   PENNY_WEB_TELEMETRY_URL=https://faro-collector-prod-<region>.grafana.net/collect/<key>
   ```

   `docker compose up -d web`. On NixOS, set `services.penny.webTelemetryUrl`.
4. Open Penny, then Frontend Observability in Grafana: sessions, errors and web vitals appear within a minute. To follow a browser request into the API, the API must send its traces to the same Cloud stack ([Grafana Cloud](#grafana-cloud)).

**Self-hosted:** set `PENNY_WEB_TELEMETRY_URL` to your Alloy's Faro endpoint behind TLS (`https://telemetry.penny.example.com/collect`, see [Client ingest](#client-ingest)), with the Penny origin in `PENNY_TELEMETRY_ORIGINS`.

How it works:

- The web container serves the URL as `/telemetry.json` and adds exactly that URL to the page's `connect-src`; it is the only cross-origin request the app makes. `web` refuses to start if the value is not a plain `https://` URL (no query, quotes, spaces or semicolons). Nothing is compiled into the app: the same image serves servers with and without telemetry.
- The Faro SDK is a separate download, fetched only when telemetry is on.
- Before anything is sent (`apps/web/src/telemetry/scrub.ts`), URLs lose their query strings and fragments (search text, the OIDC code) and every path segment that is not a plain word becomes `:id`. Error and log messages lose emails, quoted text and numbers: `Save failed for <email> amount <n> note <text>`. Console output is not captured, no user is attached, and geolocation is off. The session id is random per tab.
- Requests to `/api/` carry `traceparent`, and the API continues that trace, so one trace shows the browser request, the API handler and its SQL.
- An unreachable collector never affects the app: Faro drops what it cannot send and logs nothing itself (the browser's developer tools still show the failed requests).

To try it before deploying: `PENNY_WEB_TELEMETRY_URL=<collector> npm run dev` in `apps/web`, with `http://localhost:4173` allowed in the Frontend Observability app.

## What runs

```text
API ──OTLP gRPC :4317──▶ ┌───────┐ ──traces──▶ Tempo ─┐
         (penny network) │ Alloy │ ──logs────▶ Loki  ─┼──▶ Grafana :3000 (loopback)
web/iOS ──▶ your proxy ─▶│       │ ──metrics─▶ Prometheus
      OTLP/HTTP :4319    └───────┘
      Faro      :12347   (loopback)
```

| Service | Image (pinned by digest) | Role | Default memory limit |
| --- | --- | --- | --- |
| `alloy` | `grafana/alloy` v1.21.1 | One collector for every signal: internal OTLP for the API, client ingest for the apps | 512 MiB |
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
# set GRAFANA_ADMIN_PASSWORD (openssl rand -base64 24) and PENNY_TELEMETRY_ORIGINS
docker compose up -d --wait
```

Open `http://127.0.0.1:3000` (through an SSH tunnel, or [behind your proxy](#securing-grafana-and-the-ingest-endpoint)) and sign in as `admin`. The **Penny** folder holds the dashboards and the alert rules.

If Penny's Compose project is not called `penny`, set `PENNY_NETWORK` to its network (`<project>_penny`; `docker network ls` lists it).

## Connect the API

Add to `deploy/api.env` and restart the API (`docker compose up -d api` in `deploy/`):

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4317
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=home
```

`alloy` resolves on the `penny` network. Within a minute, **Penny API** shows the instance under Instances. The [telemetry settings](operations.md#telemetry-opentelemetry) list the other variables (sampling, export intervals, headers for a remote collector). Name the environment so you can tell servers apart if several report to one Grafana.

The NixOS module runs no containers; point `OTEL_EXPORTER_OTLP_ENDPOINT` at an Alloy or OpenTelemetry Collector you run (the `config.alloy` here works as a starting point).

## Client ingest

The web and iOS apps send telemetry from users' devices, so they need an endpoint on the internet. Alloy has a separate receiver for them that is safe to publish behind your reverse proxy:

| Endpoint | Port (loopback) | For |
| --- | --- | --- |
| `POST /v1/traces`, `/v1/logs`, `/v1/metrics` (OTLP/HTTP, protobuf or JSON) | `PENNY_OTLP_CLIENT_PORT`, default 4319 | iOS (OpenTelemetry Swift) and web OpenTelemetry |
| `POST /collect` (Grafana Faro) | `PENNY_FARO_PORT`, default 12347 | Web, if it uses the Faro Web SDK |

What the receiver enforces:

- **Origins.** Browsers may post only from `PENNY_TELEMETRY_ORIGINS` (your Penny origin). Native apps send no `Origin` and are not affected.
- **Service names.** Records must claim `service.name` `penny-web` or `penny-ios` (`PENNY_CLIENT_SERVICES`); anything else is dropped. Nobody can write records that look like the API's into its dashboards or alerts through this endpoint.
- **Size.** Request bodies over 1 MiB are refused. Faro is also rate-limited (50 requests/s, burst 100).
- The API's own OTLP ports (4317, 4318) are never published.

Publish both on one hostname in your proxy, with only those paths and methods. nginx example (TLS terminated here; add your certificate lines):

```nginx
limit_req_zone $binary_remote_addr zone=telemetry:10m rate=5r/s;

server {
    listen 443 ssl;
    server_name telemetry.penny.example.com;
    client_max_body_size 1m;

    location ~ ^/v1/(traces|logs|metrics)$ {
        limit_except POST OPTIONS { deny all; }
        limit_req zone=telemetry burst=20 nodelay;
        proxy_pass http://127.0.0.1:4319;
    }
    location = /collect {
        limit_except POST OPTIONS { deny all; }
        limit_req zone=telemetry burst=20 nodelay;
        proxy_pass http://127.0.0.1:12347;
    }
    location / { return 404; }
}
```

The endpoint takes no credentials, because any credential shipped in an app is public. The limits above are what keep it cheap to run. Leave client ingest unpublished until you turn client telemetry on.

### Client telemetry

The contract the apps follow (MAZ-129; the web app follows it through Faro, and iOS is still to come), and that the **Penny clients** dashboard and the crash alert read:

- `service.name` is `penny-web` or `penny-ios`; `service.version` is the app version.
- An **error** is a log record with severity ERROR (17–20) and `exception.type`. Faro exceptions (`kind=exception`) count too.
- A **crash** is a log record with severity FATAL (21 or more), sent on the next launch.
- Client spans for API calls send `traceparent`, so the API continues the same trace.
- Telemetry is opt-in per server and off in demo mode. It carries no credentials, emails, search text, ledger contents or amounts.

## Configuration

`apps/backend/development/observability/.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `GRAFANA_ADMIN_PASSWORD` | required | Password of the Grafana `admin` user, set on first start. Later changes go through Grafana (`grafana cli admin reset-admin-password`) |
| `GRAFANA_ADMIN_USER` | `admin` | |
| `GRAFANA_BIND`, `GRAFANA_PORT` | `127.0.0.1`, `3000` | Where Grafana is published |
| `GRAFANA_ROOT_URL` | `http://localhost:3000/` | The public address when a proxy serves Grafana; links in alerts use it |
| `GRAFANA_SECURE_COOKIES` | `false` | `true` when Grafana is served over HTTPS |
| `PENNY_TELEMETRY_ORIGINS` | local Vite origins | Comma-separated browser origins allowed to send client telemetry |
| `PENNY_CLIENT_SERVICES` | `penny-web\|penny-ios` | Regular expression of accepted client `service.name` values |
| `PENNY_INGEST_BIND`, `PENNY_OTLP_CLIENT_PORT`, `PENNY_FARO_PORT` | `127.0.0.1`, `4319`, `12347` | Where client ingest is published |
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

## Securing Grafana and the ingest endpoint

- Grafana is published on loopback only, requires sign-in, and has anonymous access and sign-up turned off. Reach it through an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 server`) or a TLS proxy (then set `GRAFANA_ROOT_URL` and `GRAFANA_SECURE_COOKIES=true`). Grafana is an administration tool: don't publish it to the internet without single sign-on or a VPN in front.
- Loki, Tempo and Prometheus are not published at all. Query them through Grafana.
- Telemetry contains no user content ([privacy guarantees](operations.md#privacy-guarantees)): ids, routes, status codes, exception types and parameterized SQL. It still shows when and how Penny is used, so give Grafana access to operators only.
- Client ingest is covered in [Client ingest](#client-ingest). Publish only its paths, with a body limit and a rate limit.
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

Provisioned dashboards are read-only. To change one, edit `scripts/grafana-dashboards.mjs`, run `npm run dashboards:generate` and restart Grafana. `npm run dashboards:check` (also part of `npm test`) fails when the JSON and the script disagree. To experiment, use **Save as** in Grafana for your own copy.

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
- **Client telemetry refused.** A browser shows a CORS error when its origin is not in `PENNY_TELEMETRY_ORIGINS`. Records with another `service.name` are dropped without an error.
- **Alloy restarts with "permission denied".** It must run as the `alloy` user (`user: alloy` in `compose.yaml`); its data directory belongs to that user.
- **A dashboard change does not show.** Grafana reads provisioned files at startup: `docker compose restart grafana`.
- **Panels say "No data".** Panels for things that have not happened (no 5xx, no job failures, no clients) stay empty; check the time range first.

## Local development

The Aspire AppHost (`apps/backend/README.md`) starts the same Alloy, Loki, Tempo, Prometheus and Grafana from these files, with the dashboards and alert rules, anonymous admin access and 3-day retention. Client ingest is fixed at `http://localhost:4319` (OTLP/HTTP) and `http://localhost:12347/collect` (Faro) and allows the Vite origin `http://localhost:4173`.

## Tests

- `npm test` runs `tests/core/observability.test.ts`: dashboards match their generator, panels use data source variables and the standard filters, alert rules use provisioned data sources, only client ingest and Grafana are published, and images match the AppHost pins.
- `scripts/observability-smoke.mjs` (CI, after the deploy smoke test) starts Penny with telemetry on and this stack beside it. It then checks that API metrics, logs and traces (including SQL spans) for a request id reach Prometheus, Loki and Tempo through Grafana. It also checks that client errors and crashes arrive, and that foreign origins, oversized bodies and records impersonating the API are refused. Finally it checks that Grafana provisioned every data source, dashboard and alert rule, that every rule evaluates, and that the crash alert fires.

```sh
PENNY_SMOKE_API_IMAGE=localhost/penny-api:dev PENNY_SMOKE_WEB_IMAGE=localhost/penny-web:dev \
  node scripts/observability-smoke.mjs
```
