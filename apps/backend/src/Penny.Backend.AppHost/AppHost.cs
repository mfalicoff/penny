// Local development orchestration for the v2 stack (MAZ-138): PostgreSQL, the migration
// step, the search model download, the .NET API, the Vite web app and a Grafana stack
// (Alloy, Loki, Tempo, Prometheus, Grafana). Start it with
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
var migrationPassword = builder.AddParameter(
    "postgres-migration-password",
    new GenerateParameterDefault { MinLength = 32, Special = false },
    secret: true,
    persist: true
);
var runtimePassword = builder.AddParameter(
    "postgres-runtime-password",
    new GenerateParameterDefault { MinLength = 32, Special = false },
    secret: true,
    persist: true
);
var receiptMasterKey = builder.AddParameter(
    "receipt-master-key",
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
// Same image and role layout as deploy/compose.yaml: `migrate --bootstrap` creates the
// restricted migration and runtime roles, the penny schema and the extensions as administrator.

var postgresImage = PinnedImage.Parse(DatabaseSchema.Image);
var postgres = postgresImage
    .ApplyTo(builder.AddPostgres("postgres"))
    .WithEnvironment("POSTGRES_DB", "penny")
    // PostgreSQL 18 images keep their data under /var/lib/postgresql.
    .WithVolume("penny-aspire-postgres", "/var/lib/postgresql")
    .WithLifetime(ContainerLifetime.Persistent);

var endpoint = postgres.Resource.PrimaryEndpoint;
var host = endpoint.Property(EndpointProperty.Host);
var port = endpoint.Property(EndpointProperty.Port);
var runtimeConnection = ReferenceExpression.Create(
    $"Host={host};Port={port};Database=penny;Username=penny_runtime;Password={runtimePassword};SSL Mode=Disable"
);
var migrationConnection = ReferenceExpression.Create(
    $"Host={host};Port={port};Database=penny;Username=penny_migrator;Password={migrationPassword};SSL Mode=Disable"
);
var adminConnection = ReferenceExpression.Create(
    $"Host={host};Port={port};Database=penny;Username=postgres;Password={postgres.Resource.PasswordParameter};SSL Mode=Disable"
);

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

var migrate = builder
    .AddProject<Projects.Penny_Backend_Api>("migrate")
    .WithArgs("migrate", "--bootstrap", "--grant-runtime")
    .WithEnvironment("ConnectionStrings__Admin", adminConnection)
    .WithEnvironment("ConnectionStrings__Migration", migrationConnection)
    .WithEnvironment("ConnectionStrings__Postgres", runtimeConnection)
    .WithEnvironment("DOTNET_ENVIRONMENT", "Development")
    .WithoutAspireTelemetry()
    .WaitFor(postgres)
    .WithIconName("DatabaseArrowUp");

var api = builder
    .AddProject<Projects.Penny_Backend_Api>("api")
    .WithHttpEndpoint(port: 5001, name: "http")
    .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Development")
    .WithEnvironment("ConnectionStrings__Postgres", runtimeConnection)
    .WithEnvironment("Receipts__Root", receiptRoot)
    .WithEnvironment("Receipts__MasterKey", receiptMasterKey)
    .WithEnvironment("Search__ModelDirectory", modelDirectory)
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
    .WaitForCompletion(migrate)
    .WaitForCompletion(searchModel);

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
    ReferenceExpression.Create(
        $"{web.GetEndpoint("http")},http://127.0.0.1:4173,http://localhost:8081,http://localhost:3001"
    )
);

builder.Build().Run();
