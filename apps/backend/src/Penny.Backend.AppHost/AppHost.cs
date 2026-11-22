// Local development orchestration (MAZ-138): PostgreSQL, the search model
// download, the .NET API (it migrates on startup), the Vite web app, emailed receipts
// (penny-render and the Cloudflare Email Worker under wrangler dev, MAZ-184) and a Grafana
// stack (Alloy, Loki, Tempo, Prometheus, Grafana). Start it with
// `bash apps/backend/dotnet.sh run --project src/Penny.Backend.AppHost`.
using Penny.Backend.AppHost;
using Penny.Backend.Persistence.Schema;

ContainerRuntime.SelectPodmanWhenDockerIsMissing();
var builder = DistributedApplication.CreateBuilder(args);

var repository = Path.GetFullPath(Path.Combine(builder.AppHostDirectory, "../../../.."));
var backend = Path.Combine(repository, "apps/backend");
var observability = Path.Combine(backend, "development/observability");
var cache = Path.Combine(repository, ".cache/backend");
var receiptRoot = Path.Combine(cache, "aspire/receipts");
var modelDirectory = Path.Combine(cache, "models/multilingual-e5-small");
Directory.CreateDirectory(receiptRoot);

// Secrets are generated on first run and kept in this project's user secrets, so the
// persistent database volume keeps matching them. Never reset them while the volume exists.
var receiptMasterKey = builder.AddParameter(
    "receipt-master-key",
    new Base64KeyParameterDefault(32),
    secret: true,
    persist: true
);

// Shared by the API (InboundMail__WebhookSecret) and the local Email Worker.
var inboundMailSecret = builder.AddParameter(
    "inbound-mail-secret",
    new Base64KeyParameterDefault(32),
    secret: true,
    persist: true
);

// --- Grafana stack ------------------------------------------------------------------------
// Containers reach each other by resource name on Aspire's container network; the configs
// in development/observability use those names.

var loki = ObservabilityImages
    .Loki.ApplyTo(builder.AddContainer("loki", ObservabilityImages.Loki.Image))
    .WithBindMount(Path.Combine(observability, "loki.yaml"), "/etc/loki/config.yaml", true)
    .WithVolume("penny-aspire-loki", "/loki")
    .WithArgs("-config.file=/etc/loki/config.yaml")
    .WithHttpEndpoint(targetPort: 3100, name: "http")
    .WithHttpHealthCheck("/ready", endpointName: "http")
    .WithLifetime(ContainerLifetime.Persistent);

var tempo = ObservabilityImages
    .Tempo.ApplyTo(builder.AddContainer("tempo", ObservabilityImages.Tempo.Image))
    .WithBindMount(Path.Combine(observability, "tempo.yaml"), "/etc/tempo.yaml", true)
    .WithVolume("penny-aspire-tempo", "/var/tempo")
    .WithArgs("-config.file=/etc/tempo.yaml")
    .WithHttpEndpoint(targetPort: 3200, name: "http")
    .WithHttpHealthCheck("/ready", endpointName: "http")
    .WithLifetime(ContainerLifetime.Persistent);

var prometheus = ObservabilityImages
    .Prometheus.ApplyTo(builder.AddContainer("prometheus", ObservabilityImages.Prometheus.Image))
    .WithBindMount(
        Path.Combine(observability, "prometheus.yaml"),
        "/etc/prometheus/prometheus.yml",
        true
    )
    .WithVolume("penny-aspire-prometheus", "/prometheus")
    .WithArgs(
        "--config.file=/etc/prometheus/prometheus.yml",
        "--storage.tsdb.path=/prometheus",
        "--storage.tsdb.retention.time=3d",
        "--web.enable-otlp-receiver"
    )
    .WithHttpEndpoint(targetPort: 9090, name: "http")
    .WithHttpHealthCheck("/-/ready", endpointName: "http")
    .WithLifetime(ContainerLifetime.Persistent);

var alloy = ObservabilityImages
    .Alloy.ApplyTo(builder.AddContainer("alloy", ObservabilityImages.Alloy.Image))
    .WithBindMount(Path.Combine(observability, "config.alloy"), "/etc/alloy/config.alloy", true)
    .WithArgs(
        "run",
        "--server.http.listen-addr=0.0.0.0:12345",
        "--storage.path=/var/lib/alloy/data",
        "/etc/alloy/config.alloy"
    )
    .WithHttpEndpoint(targetPort: 12345, name: "http")
    .WithEndpoint(targetPort: 4317, scheme: "http", name: "otlp-grpc")
    .WithHttpEndpoint(targetPort: 4318, name: "otlp-http")
    // Client ingest (MAZ-128), fixed so the web app (MAZ-129) has stable addresses:
    // OTLP/HTTP for client services and the Grafana Faro receiver, both allowing the
    // local Vite origin by default (config.alloy).
    .WithHttpEndpoint(port: 4319, targetPort: 4319, name: "otlp-clients")
    .WithHttpEndpoint(port: 12347, targetPort: 12347, name: "faro")
    .WithHttpHealthCheck("/-/ready", endpointName: "http")
    .WaitFor(loki)
    .WaitFor(tempo)
    .WaitFor(prometheus)
    .WithLifetime(ContainerLifetime.Persistent);

ObservabilityImages
    .Grafana.ApplyTo(builder.AddContainer("grafana", ObservabilityImages.Grafana.Image))
    .WithBindMount(
        Path.Combine(observability, "grafana/provisioning"),
        "/etc/grafana/provisioning",
        true
    )
    .WithBindMount(
        Path.Combine(observability, "grafana/dashboards"),
        "/var/lib/grafana/dashboards",
        true
    )
    // Local only: anyone who can reach the loopback port is an administrator.
    .WithEnvironment("GF_AUTH_ANONYMOUS_ENABLED", "true")
    .WithEnvironment("GF_AUTH_ANONYMOUS_ORG_ROLE", "Admin")
    .WithEnvironment("GF_AUTH_DISABLE_LOGIN_FORM", "true")
    .WithEnvironment("GF_ANALYTICS_REPORTING_ENABLED", "false")
    .WithEnvironment("GF_ANALYTICS_CHECK_FOR_UPDATES", "false")
    .WithEnvironment("GF_NEWS_NEWS_FEED_ENABLED", "false")
    .WithHttpEndpoint(port: 3000, targetPort: 3000, name: "http")
    .WithHttpHealthCheck("/api/health", endpointName: "http")
    .WaitFor(loki)
    .WaitFor(tempo)
    .WaitFor(prometheus);

// --- PostgreSQL -----------------------------------------------------------------------------
// Same image as deploy/compose.yaml. The API connects as the container's own user and
// migrates on startup (the schema and the search extensions included).

var postgresImage = PinnedImage.Parse(DatabaseSchema.Image);
var postgres = postgresImage
    .ApplyTo(builder.AddPostgres("postgres"))
    .WithEnvironment("POSTGRES_DB", "penny")
    // As in deploy/compose.yaml: a statement whose client gave up stops within a second
    // instead of running on and holding its locks.
    .WithArgs("-c", "client_connection_check_interval=1s")
    // PostgreSQL 18 images keep their data under /var/lib/postgresql.
    .WithVolume("penny-aspire-postgres", "/var/lib/postgresql")
    .WithLifetime(ContainerLifetime.Persistent);

var endpoint = postgres.Resource.PrimaryEndpoint;
var host = endpoint.Property(EndpointProperty.Host);
var port = endpoint.Property(EndpointProperty.Port);
var connection = ReferenceExpression.Create(
    $"Host={host};Port={port};Database=penny;Username=postgres;Password={postgres.Resource.PasswordParameter};SSL Mode=Disable"
);

// --- Emailed receipts (MAZ-184) ------------------------------------------------------------
// penny-render: the pinned Gotenberg and flags from deploy/compose.yaml, read-only and without
// capabilities. In Compose it also sits on an internal-only network; here the API runs on the
// host, so the renderer's own URL deny-list and private-IP denial are what keep it offline.

var render = RenderService.Read(repository);
var renderer = render
    .Image.ApplyTo(builder.AddContainer("penny-render", render.Image.Image))
    .WithArgs([.. render.Command])
    .WithContainerRuntimeArgs(
        "--read-only",
        "--tmpfs",
        "/tmp:size=256m",
        "--tmpfs",
        "/home/gotenberg:size=64m",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges"
    )
    .WithHttpEndpoint(targetPort: 3000, name: "http")
    .WithHttpHealthCheck("/health", endpointName: "http")
    .WithIconName("DocumentPdf");

// --- API ------------------------------------------------------------------------------------

var searchModel = builder
    .AddExecutable(
        "search-model",
        "node",
        repository,
        "apps/backend/development/download-model.mjs",
        modelDirectory
    )
    .WithIconName("ArrowDownload");

var api = builder
    .AddProject<Projects.Penny_Backend_Api>("api")
    .WithHttpEndpoint(port: 5001, name: "http")
    .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Development")
    .WithEnvironment("ConnectionStrings__Postgres", connection)
    .WithEnvironment("Receipts__Root", receiptRoot)
    .WithEnvironment("Receipts__MasterKey", receiptMasterKey)
    .WithEnvironment("Search__ModelDirectory", modelDirectory)
    // Emailed receipts: mail to r-…@receipts.penny.test arrives through the local Worker.
    .WithEnvironment("InboundMail__Enabled", "true")
    .WithEnvironment("InboundMail__Domain", EmailWorker.Domain)
    .WithEnvironment("InboundMail__WebhookSecret", inboundMailSecret)
    .WithEnvironment("InboundMail__RendererUrl", renderer.GetEndpoint("http"))
    .WithEnvironment("InboundMail__PollSeconds", "2")
    .WithoutAspireTelemetry()
    .WithEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT", alloy.GetEndpoint("otlp-grpc"))
    .WithEnvironment("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc")
    .WithEnvironment("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment.name=development")
    // Short export intervals so a request shows up in Grafana within seconds.
    .WithEnvironment("OTEL_METRIC_EXPORT_INTERVAL", "5000")
    .WithEnvironment("OTEL_BSP_SCHEDULE_DELAY", "1000")
    .WithEnvironment("OTEL_BLRP_SCHEDULE_DELAY", "1000")
    .WithUrlForEndpoint("http", url => url.DisplayText = "API")
    .WithUrl("/scalar/v1", "Scalar")
    .WithHttpHealthCheck("/api/ready", endpointName: "http")
    .WaitFor(postgres)
    .WaitFor(alloy)
    .WaitFor(renderer)
    .WaitForCompletion(searchModel);

// The Cloudflare Email Worker (apps/email-worker) under wrangler dev (workerd), pointed at the
// API. Its local email handler takes a raw message the way Email Routing hands one over:
//   curl -X POST "http://127.0.0.1:8788/cdn-cgi/handler/email?from=a@shop.example.test&to=r-…@receipts.penny.test" --data-binary @mail.eml
// (the message needs a Message-ID header). See docs/reference/test-environment.md.
var workerDirectory = Path.Combine(repository, "apps/email-worker");
var workerInstall = builder
    .AddExecutable("email-worker-install", "npm", workerDirectory, "ci", "--no-audit", "--no-fund")
    .WithIconName("ArrowDownload");
builder
    .AddExecutable(
        "email-worker",
        Path.Combine(workerDirectory, "node_modules/.bin/wrangler"),
        workerDirectory
    )
    .WithHttpEndpoint(port: EmailWorker.Port, isProxied: false, name: "http")
    .WithArgs(context =>
    {
        context.Args.Add("dev");
        context.Args.Add("--ip");
        context.Args.Add("127.0.0.1");
        context.Args.Add("--port");
        context.Args.Add(
            EmailWorker.Port.ToString(System.Globalization.CultureInfo.InvariantCulture)
        );
        context.Args.Add("--show-interactive-dev-session=false");
        context.Args.Add("--var");
        context.Args.Add(ReferenceExpression.Create($"PENNY_ORIGIN:{api.GetEndpoint("http")}"));
        context.Args.Add("--var");
        context.Args.Add($"RECEIPT_DOMAIN:{EmailWorker.Domain}");
        context.Args.Add("--var");
        context.Args.Add("RECIPIENT_LIST_TTL_SECONDS:5");
        context.Args.Add("--var");
        context.Args.Add(ReferenceExpression.Create($"PENNY_WEBHOOK_SECRET:{inboundMailSecret}"));
    })
    .WithEnvironment("WRANGLER_SEND_METRICS", "false")
    .WithIconName("Mail")
    .WaitFor(api)
    .WaitForCompletion(workerInstall);

// --- Web ------------------------------------------------------------------------------------
// Vite forwards /api/ to PENNY_API_URL (see apps/web/vite.config.ts), so the browser keeps a
// same-origin API and the API sees the web origin, which it must allow.

var web = builder
    .AddViteApp("web", Path.Combine(repository, "apps/web"))
    .WithNpm(installCommand: "ci")
    .WithEndpoint("http", http => http.Port = 4173)
    .WithEnvironment("PENNY_API_URL", api.GetEndpoint("http"))
    .WaitFor(api);

api.WithEnvironment(
    "Auth__AllowedOrigins",
    ReferenceExpression.Create($"{web.GetEndpoint("http")},http://127.0.0.1:4173")
);

builder.Build().Run();
