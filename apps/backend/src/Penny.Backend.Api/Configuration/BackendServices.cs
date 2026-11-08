using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Errors;
using Penny.Backend.Api.Middleware;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Health;
using Penny.Backend.Persistence.Repositories;

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
        builder.Services.AddSingleton(TimeProvider.System);
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
        AddAuthServices(builder.Services, AuthOptions.Read(configuration));
    }

    private static void AddAuthServices(IServiceCollection services, AuthOptions auth)
    {
        services.AddSingleton(auth);
        services.AddSingleton(new RegistrationPolicy(auth.AllowRegistration));
        services.AddSingleton<LegacyPasswordHasher>();
        services.AddSingleton<IAccountRepository, PostgresAccountRepository>();
        services.AddSingleton<ISessionRepository, PostgresSessionRepository>();
        services.AddSingleton<AuthService>();
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
        services.AddRateLimiter(limits => AuthRateLimit.Configure(limits, auth.RateLimitPermits));
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
