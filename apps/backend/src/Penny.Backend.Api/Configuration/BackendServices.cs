using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Errors;
using Penny.Backend.Api.Households;
using Penny.Backend.Api.Middleware;
using Penny.Backend.Api.Push;
using Penny.Backend.Api.Search;
using Penny.Backend.Api.Testing;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Abstractions.Search;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Households;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.Application.Push;
using Penny.Backend.Application.Receipts;
using Penny.Backend.Application.Search;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Health;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Repositories;
using Penny.Backend.Persistence.Search;
using Penny.Backend.Persistence.Testing;

namespace Penny.Backend.Api.Configuration;

public static class BackendServices
{
    public static void AddBackendServices(this WebApplicationBuilder builder)
    {
        var configuration = builder.Configuration;
        var options = BackendOptions.Read(configuration);
        var database = DatabaseSettings.Create(
            configuration.GetConnectionString("Postgres"),
            BackendOptions.ReadBounded(configuration, "Database:MaxPoolSize", 20, 1, 100),
            BackendOptions.ReadBounded(configuration, "Database:ConnectTimeoutSeconds", 5, 1, 30),
            BackendOptions.ReadBounded(configuration, "Database:CommandTimeoutSeconds", 5, 1, 30)
        );
        builder.Services.AddSingleton(options);
        var controls = AddTestControls(builder);
        builder.Services.AddSingleton(_ => database.CreateDataSource());
        builder.Services.AddSingleton<IStorageReadiness, PostgresReadiness>();
        builder.Services.Configure<ApiBehaviorOptions>(api =>
            api.InvalidModelStateResponseFactory = _ => new BadRequestObjectResult(
                new ApiError("Invalid request.")
            )
        );
        builder.Services.Configure<HostOptions>(host =>
            host.ShutdownTimeout = TimeSpan.FromSeconds(options.ShutdownTimeoutSeconds)
        );
        builder.WebHost.ConfigureKestrel(server =>
            server.Limits.MaxRequestBodySize = options.MaxRequestBodyBytes
        );
        builder.Services.AddRequestTimeouts(timeouts =>
            timeouts.DefaultPolicy = new RequestTimeoutPolicy
            {
                Timeout = TimeSpan.FromSeconds(options.RequestTimeoutSeconds),
                TimeoutStatusCode = 503,
                WriteTimeoutResponse = context =>
                {
                    context.Response.Headers.RetryAfter = "5";
                    var clientCancellation = (CancellationToken)
                        context.Items[ApiBoundaryMiddleware.ClientCancellation]!;
                    return ApiErrors.WriteAsync(
                        context,
                        503,
                        "The request timed out. Please retry.",
                        clientCancellation
                    );
                },
            }
        );
        builder.Services.AddOpenApi();
        AddAuthServices(builder.Services, AuthOptions.Read(configuration), configuration);
        AddLedgerServices(builder.Services, configuration);
        builder.Services.AddSingleton<IHouseholdRepository, PostgresHouseholdRepository>();
        builder.Services.AddSingleton<HouseholdService>();
        // Shared expenses show receipt names, so they use the receipt store too.
        builder.Services.AddSingleton<ISharedExpenseRepository, PostgresSharedExpenseRepository>();
        builder.Services.AddSingleton<SharedExpenseService>();
        builder.Services.AddSingleton<SettlementService>();
        AddRecurrenceServices(builder.Services, RecurrenceOptions.Read(configuration));
        AddOidcServices(builder.Services, OidcOptions.Read(configuration), controls);
        AddSearchServices(builder.Services, SearchOptions.Read(configuration));
        AddPushServices(builder.Services, PushOptions.Read(configuration), controls);
    }

    // MAZ-62 full-stack test controls: a pinnable clock, injected faults, unique users
    // and data reset. Off by default; TestControlOptions refuses Production. When off,
    // the host keeps the system clock and has no `/api/test` controller.
    private static TestControlOptions AddTestControls(WebApplicationBuilder builder)
    {
        var controls = TestControlOptions.Read(builder.Configuration, builder.Environment);
        builder.Services.AddSingleton(controls);
        builder
            .Services.AddMvcCore()
            .ConfigureApplicationPartManager(parts =>
            {
                foreach (
                    var provider in parts
                        .FeatureProviders.OfType<ControllerFeatureProvider>()
                        .ToList()
                )
                    parts.FeatureProviders.Remove(provider);
                parts.FeatureProviders.Add(new TestControlsFeatureProvider(controls.Enabled));
            });
        if (!controls.Enabled)
        {
            builder.Services.AddSingleton(TimeProvider.System);
            return controls;
        }
        var clock = new ControllableClock();
        builder.Services.AddSingleton(clock);
        builder.Services.AddSingleton<TimeProvider>(clock);
        builder.Services.AddSingleton<FaultRegistry>();
        builder.Services.AddSingleton<TestDataReset>();
        return controls;
    }

    // Shared recurrence (MAZ-59): rule writes always; the occurrence worker unless
    // `Recurrence__Worker=false`.
    private static void AddRecurrenceServices(
        IServiceCollection services,
        RecurrenceOptions recurrence
    )
    {
        services.AddSingleton(recurrence);
        services.AddSingleton<SharedRecurrenceService>();
        services.AddSingleton<SharedRecurrenceRunner>();
        if (recurrence.Worker)
            services.AddHostedService<SharedRecurrenceWorker>();
    }

    // Push devices and delivery (MAZ-61): registration always; the outbox worker unless
    // `Push__Worker=false`. Expo stays until retired; APNs only when configured. In
    // full-stack test runs every provider call first consults the `push` faults.
    private static void AddPushServices(
        IServiceCollection services,
        PushOptions push,
        TestControlOptions controls
    )
    {
        services.AddSingleton(push);
        services.AddSingleton(new PushSettings(push.ExpoEnabled));
        services.AddSingleton<IPushRepository, PostgresPushRepository>();
        services.AddSingleton<PushDeviceService>();
        // Provider calls are bounded, follow no redirects and are not logged (they
        // carry device tokens and the APNs provider token).
        services
            .AddHttpClient(
                ExpoTransport.HttpClientName,
                client =>
                {
                    client.Timeout = TimeSpan.FromSeconds(10);
                    client.MaxResponseContentBufferSize = 1024 * 1024;
                }
            )
            .ConfigurePrimaryHttpMessageHandler(() =>
                new SocketsHttpHandler { AllowAutoRedirect = false }
            )
            .RemoveAllLoggers();
        services.AddSingleton(provider => new ExpoTransport(
            provider
                .GetRequiredService<IHttpClientFactory>()
                .CreateClient(ExpoTransport.HttpClientName)
        ));
        services.AddSingleton<IPushReceiptChecker>(provider =>
            provider.GetRequiredService<ExpoTransport>()
        );
        AddTransport<ExpoTransport>(services, controls);
        if (push.Apns is { } apns)
        {
            services.AddSingleton(apns);
            services.AddSingleton<ApnsProviderToken>();
            services
                .AddHttpClient(
                    ApnsTransport.HttpClientName,
                    client =>
                    {
                        client.Timeout = TimeSpan.FromSeconds(10);
                        client.MaxResponseContentBufferSize = 64 * 1024;
                        client.DefaultRequestVersion = System.Net.HttpVersion.Version20;
                        client.DefaultVersionPolicy = HttpVersionPolicy.RequestVersionExact;
                    }
                )
                .ConfigurePrimaryHttpMessageHandler(() =>
                    new SocketsHttpHandler
                    {
                        AllowAutoRedirect = false,
                        EnableMultipleHttp2Connections = true,
                        PooledConnectionIdleTimeout = TimeSpan.FromMinutes(30),
                    }
                )
                .RemoveAllLoggers();
            services.AddSingleton(provider => new ApnsTransport(
                provider
                    .GetRequiredService<IHttpClientFactory>()
                    .CreateClient(ApnsTransport.HttpClientName),
                apns,
                provider.GetRequiredService<ApnsProviderToken>(),
                provider.GetRequiredService<ILogger<ApnsTransport>>()
            ));
            AddTransport<ApnsTransport>(services, controls);
        }
        services.AddSingleton<PushDeliveryRunner>();
        if (push.Worker)
            services.AddHostedService<PushDeliveryWorker>();
    }

    private static void AddTransport<T>(IServiceCollection services, TestControlOptions controls)
        where T : class, IPushTransport =>
        services.AddSingleton<IPushTransport>(provider =>
            controls.Enabled
                ? new FaultInjectingPushTransport(
                    provider.GetRequiredService<T>(),
                    provider.GetRequiredService<FaultRegistry>()
                )
                : provider.GetRequiredService<T>()
        );

    // The model is loaded and verified here, so a missing or altered file stops the
    // host before it listens.
    private static void AddSearchServices(IServiceCollection services, SearchOptions search)
    {
        services.AddSingleton(search);
        services.AddSingleton<ITextEmbedder>(OnnxTextEmbedder.Load(search.ModelDirectory));
        services.AddSingleton<ISearchRepository, PostgresSearchRepository>();
        services.AddSingleton<SearchService>();
        services.AddSingleton<SearchEmbeddingService>();
        if (search.EmbeddingWorker)
            services.AddHostedService<SearchEmbeddingWorker>();
    }

    private static void AddLedgerServices(IServiceCollection services, IConfiguration configuration)
    {
        // Ledger reads open encrypted receipt names, so HTTP needs the receipt store.
        var receipts = ReceiptStoreSettings.Create(
            configuration["Receipts:Root"],
            configuration["Receipts:MasterKey"]
        );
        services.AddSingleton(new ReceiptFileStore(receipts));
        services.AddSingleton<IReceiptRepository, PostgresReceiptRepository>();
        services.AddSingleton<ReceiptService>();
        services.AddSingleton<ILedgerRepository, PostgresLedgerRepository>();
        services.AddSingleton<LedgerService>();
    }

    // OIDC services exist only when configured; the controller then answers 404.
    private static void AddOidcServices(
        IServiceCollection services,
        OidcOptions? oidc,
        TestControlOptions controls
    )
    {
        if (oidc is null)
            return;
        services.AddSingleton(oidc);
        services.AddSingleton(
            new OidcSettings(oidc.Issuer, oidc.Label, oidc.RedirectUris, oidc.AllowRegistration)
        );
        // Provider calls follow no redirects, are bounded like the legacy 10-second
        // timeout and are not logged (they carry codes, tokens and the client secret).
        services
            .AddHttpClient(
                OidcProviderClient.HttpClientName,
                client =>
                {
                    client.Timeout = TimeSpan.FromSeconds(10);
                    client.MaxResponseContentBufferSize = 1024 * 1024;
                }
            )
            .ConfigurePrimaryHttpMessageHandler(() =>
                new SocketsHttpHandler
                {
                    AllowAutoRedirect = false,
                    // Full-stack test runs only: also trust the local provider's
                    // throwaway certificate, pinned by its SHA-256 (MAZ-62).
                    SslOptions = controls.OidcCertificateHash is { } pinned
                        ? new System.Net.Security.SslClientAuthenticationOptions
                        {
                            RemoteCertificateValidationCallback = (_, certificate, _, errors) =>
                                errors == System.Net.Security.SslPolicyErrors.None
                                || (
                                    certificate is not null
                                    && string.Equals(
                                        certificate.GetCertHashString(
                                            System.Security.Cryptography.HashAlgorithmName.SHA256
                                        ),
                                        pinned,
                                        StringComparison.OrdinalIgnoreCase
                                    )
                                ),
                        }
                        : new System.Net.Security.SslClientAuthenticationOptions(),
                }
            )
            .RemoveAllLoggers();
        services.AddSingleton<IOidcProvider, OidcProviderClient>();
        services.AddSingleton<IOidcAttemptRepository, PostgresOidcAttemptRepository>();
        services.AddSingleton<OidcService>();
    }

    // Shared by the HTTP host and the `reset-password` maintenance command.
    public static PasswordResetPolicy PasswordResetPolicyFor(AuthOptions auth) =>
        new(TimeSpan.FromHours(auth.PasswordResetHours));

    private static void AddAuthServices(
        IServiceCollection services,
        AuthOptions auth,
        IConfiguration configuration
    )
    {
        services.AddSingleton(auth);
        services.AddSingleton(new RegistrationPolicy(auth.AllowRegistration));
        services.AddSingleton<IPasswordHasher>(_ => new IdentityPasswordHasher());
        services.AddSingleton<IAccountRepository, PostgresAccountRepository>();
        services.AddSingleton<ISessionRepository, PostgresSessionRepository>();
        services.AddSingleton<AuthService>();
        services.AddSingleton(PasswordResetPolicyFor(auth));
        services.AddSingleton<IPasswordResetRepository, PostgresPasswordResetRepository>();
        services.AddSingleton<PasswordResetService>();
        services
            .AddAuthentication()
            .AddScheme<AuthenticationSchemeOptions, SessionAuthenticationHandler>(
                SessionAuthentication.Scheme,
                null
            );
        // Secure by default: every endpoint, and every unknown route, needs a session
        // unless it opts out with [AllowAnonymous], matching the legacy middleware order.
        var session = new AuthorizationPolicyBuilder(SessionAuthentication.Scheme)
            .RequireAuthenticatedUser()
            .Build();
        services.AddAuthorizationBuilder().SetDefaultPolicy(session).SetFallbackPolicy(session);
        services.AddCors(cors =>
            cors.AddDefaultPolicy(policy =>
                policy
                    .WithOrigins([.. auth.AllowedOrigins])
                    .AllowCredentials()
                    .AllowAnyHeader()
                    .WithMethods("GET", "HEAD", "PUT", "PATCH", "POST", "DELETE")
            )
        );
        services.AddRateLimiter(limits =>
        {
            AuthRateLimit.Configure(limits, auth.RateLimitPermits);
            InviteRateLimit.Configure(limits, auth.InviteRateLimitPermits);
            SearchRateLimit.Configure(limits, SearchOptions.Read(configuration).RateLimitPermits);
        });
        services.Configure<ForwardedHeadersOptions>(forwarded =>
        {
            // Trust no proxy (not even loopback) unless configured, as the legacy server did.
            forwarded.KnownIPNetworks.Clear();
            forwarded.KnownProxies.Clear();
            if (auth.TrustedProxies.Count == 0)
                return;
            forwarded.ForwardedHeaders = ForwardedHeaders.XForwardedFor;
            foreach (var network in auth.TrustedProxies)
                forwarded.KnownIPNetworks.Add(network);
        });
    }
}
