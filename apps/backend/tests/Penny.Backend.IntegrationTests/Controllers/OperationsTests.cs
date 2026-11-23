using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;
using Penny.Backend.Api.Contracts;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

public sealed class OperationsTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Theory]
    [InlineData("Backend:MaxRequestBodyBytes", "0")]
    [InlineData("Backend:RequestTimeoutSeconds", "infinite")]
    [InlineData("Backend:ShutdownTimeoutSeconds", "301")]
    [InlineData("Database:MaxPoolSize", "101")]
    [InlineData("Receipts:MinFreeMegabytes", "-1")]
    public async Task whenHostConfigurationInvalid_CreateHost_ShouldFailBeforeAcceptingRequests(
        string key,
        string value
    )
    {
        await using var factory = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting(key, value)
        );
        var error = Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        error.Message.ShouldContain(key);
    }

    [Fact]
    public async Task whenDatabaseConfigurationMissing_CreateHost_ShouldIdentifyRequiredSetting()
    {
        await using var factory = new TestApiFactory("");
        var error = Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        error.Message.ShouldContain("ConnectionStrings__Postgres");
    }

    [Theory]
    [InlineData("Receipts:Root", "relative/receipts", "Receipts__Root")]
    [InlineData("Receipts:MasterKey", "c2hvcnQ=", "Receipts__MasterKey")]
    public async Task whenReceiptStoreConfigurationInvalid_CreateHost_ShouldIdentifyRequiredSetting(
        string key,
        string value,
        string setting
    )
    {
        await using var factory = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting(key, value)
        );
        var error = Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        error.Message.ShouldContain(setting);
    }

    [Fact]
    public async Task whenDatabaseCompatible_OperationsFlow_ShouldReturnHealthyResponses()
    {
        using var health = await Client.GetAsync("/api/health", Ct);
        health.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await health.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("ok")
            .GetBoolean()
            .ShouldBeTrue();
        health.Headers.CacheControl!.NoStore.ShouldBeTrue();
        health.Headers.GetValues("X-Content-Type-Options").Single().ShouldBe("nosniff");
        using var info = await Client.GetAsync("/api/info", Ct);
        var identity = await info.Content.ReadFromJsonAsync<JsonElement>(Ct);
        identity.GetProperty("name").GetString().ShouldBe("penny");
        identity.GetProperty("version").GetString().ShouldBe(ServerInfo.CurrentVersion);
        identity.GetProperty("privacyPolicyUrl").ValueKind.ShouldBe(JsonValueKind.Null);
        identity.GetProperty("emailEnabled").GetBoolean().ShouldBeFalse();
        using var ready = await Client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenPrivacyPolicyConfigured_Info_ShouldPublishOperatorUrl()
    {
        await using var factory = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting("Legal:PrivacyPolicyUrl", "https://penny.example.com/privacy")
        );
        using var client = factory.CreateClient();
        using var info = await client.GetAsync("/api/info", Ct);
        info.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await info.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("privacyPolicyUrl")
            .GetString()
            .ShouldBe("https://penny.example.com/privacy");
    }

    [Fact]
    public async Task whenPrivacyPolicyUrlInvalid_CreateHost_ShouldIdentifySetting()
    {
        await using var factory = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting("Legal:PrivacyPolicyUrl", "javascript:alert(1)")
        );
        var error = Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        error.Message.ShouldContain("Legal__PrivacyPolicyUrl");
    }

    [Theory]
    [InlineData("DELETE FROM penny.\"__EFMigrationsHistory\"", "schema")]
    [InlineData(
        """INSERT INTO penny."__EFMigrationsHistory" VALUES ('29990101000000_Future', '10.0.14')""",
        "schema"
    )]
    [InlineData("""REVOKE SELECT ON penny."__EFMigrationsHistory" FROM penny_app""", "privileges")]
    public async Task whenDatabaseIncompatible_Readiness_ShouldFailWhileLivenessSurvives(
        string mutation,
        string errorFragment
    )
    {
        await Fixture.SqlAsync(mutation, Ct);
        using var ready = await Client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        ready.Headers.RetryAfter!.Delta.ShouldBe(TimeSpan.FromSeconds(5));
        var error = await ready.Content.ReadFromJsonAsync<ApiError>(Ct);
        error!.Error.ShouldContain(errorFragment, Case.Insensitive);
        using var live = await Client.GetAsync("/api/health", Ct);
        live.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenDatabaseUnavailable_Readiness_ShouldReturnServiceUnavailableWithoutPrivateDetails()
    {
        // Port 1 is deliberately closed on loopback, not an external service.
        var password = Guid.NewGuid().ToString("N");
        await using var factory = new TestApiFactory(
            new NpgsqlConnectionStringBuilder
            {
                Host = "127.0.0.1",
                Port = 1,
                Database = "synthetic",
                Username = "synthetic",
                Password = password,
            }.ConnectionString
        );
        using var client = factory.CreateClient();
        using var health = await client.GetAsync("/api/health", Ct);
        health.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var ready = await client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        var body = await ready.Content.ReadAsStringAsync(Ct);
        body.ShouldContain("unavailable");
        body.ShouldNotContain(password);
        body.ShouldNotContain("127.0.0.1");
    }

    [Fact]
    public async Task whenReceiptStorageWritable_Readiness_ShouldPassWithoutLeavingProbeFiles()
    {
        var root = Path.Combine(Path.GetTempPath(), "penny-ready-" + Guid.NewGuid().ToString("N"));
        try
        {
            await using var factory = ReceiptHost(root);
            using var client = CreateClient(factory);
            using var ready = await client.GetAsync("/api/ready", Ct);
            ready.StatusCode.ShouldBe(HttpStatusCode.OK);
            Directory.Exists(root).ShouldBeTrue();
            Directory.EnumerateFileSystemEntries(root).ShouldBeEmpty();
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task whenReceiptStorageNotWritable_Readiness_ShouldFailWhileLivenessSurvives()
    {
        // A regular file where the receipt root's parent should be: no permission
        // tricks, so this also fails when tests run as root.
        var blocker = Path.GetTempFileName();
        try
        {
            await using var factory = ReceiptHost(Path.Combine(blocker, "receipts"));
            using var client = CreateClient(factory);
            using var ready = await client.GetAsync("/api/ready", Ct);
            ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
            ready.Headers.RetryAfter!.Delta.ShouldBe(TimeSpan.FromSeconds(5));
            var body = await ready.Content.ReadAsStringAsync(Ct);
            body.ShouldContain("Receipts__Root");
            body.ShouldNotContain(blocker);
            using var live = await client.GetAsync("/api/health", Ct);
            live.StatusCode.ShouldBe(HttpStatusCode.OK);
        }
        finally
        {
            File.Delete(blocker);
        }
    }

    [Fact]
    public async Task whenReceiptDiskBelowMinimum_Readiness_ShouldReturnServiceUnavailable()
    {
        var root = Path.Combine(Path.GetTempPath(), "penny-ready-" + Guid.NewGuid().ToString("N"));
        try
        {
            // More than the volume's free space, whatever its size (a workstation may have
            // more than a terabyte free).
            var free = new DriveInfo(Path.GetTempPath()).AvailableFreeSpace / (1024 * 1024);
            await using var factory = ReceiptHost(
                root,
                minFreeMegabytes: (free + 1024).ToString(
                    System.Globalization.CultureInfo.InvariantCulture
                )
            );
            using var client = CreateClient(factory);
            using var ready = await client.GetAsync("/api/ready", Ct);
            ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
            (await ready.Content.ReadFromJsonAsync<ApiError>(Ct))!.Error.ShouldContain(
                "disk space"
            );
            Directory.EnumerateFileSystemEntries(root).ShouldBeEmpty();
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private TestApiFactory ReceiptHost(string root, string minFreeMegabytes = "0") =>
        new(
            Fixture.Connection,
            new Dictionary<string, string>
            {
                ["Receipts:Root"] = root,
                ["Receipts:MinFreeMegabytes"] = minFreeMegabytes,
            }
        );

    [Fact]
    public async Task whenMigrateOnStartupOff_StartupAndReadinessFlow_ShouldNotRunMigrations()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        await using var factory = new TestApiFactory(Fixture.Connection);
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/api/ready", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
        await using var check = Fixture.Admin.CreateCommand(
            """SELECT to_regclass('penny."__EFMigrationsHistory"') IS NULL"""
        );
        (await check.ExecuteScalarAsync(Ct)).ShouldBe(true);
    }

    [Fact]
    public async Task whenSchemaMissing_Startup_ShouldMigrateBeforeServing()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        await using var factory = new TestApiFactory(
            Fixture.Connection,
            new Dictionary<string, string> { ["Database:MigrateOnStartup"] = "true" }
        );
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/api/ready", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenPasswordWrong_Startup_ShouldLogSqlStateWithoutPasswordAndStop()
    {
        var wrong = Guid.NewGuid().ToString("N");
        var connection = new NpgsqlConnectionStringBuilder(Fixture.Connection)
        {
            Password = wrong,
        }.ConnectionString;
        var logs = new CapturingLoggerProvider();
        await using var factory = StartupFactory(connection, logs);
        Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        logs.Messages.ShouldContain(message =>
            message.Contains(
                "Database migration failed on startup: PostgresException: SQLSTATE 28P01 (invalid_password)",
                StringComparison.Ordinal
            )
        );
        logs.Messages.ShouldAllBe(message =>
            !message.Contains(wrong, StringComparison.Ordinal)
            && !message.Contains("Password=", StringComparison.Ordinal)
        );
    }

    [Fact]
    public async Task whenSchemaNewer_Startup_ShouldLogReasonAndStop()
    {
        await Fixture.SqlAsync(
            """INSERT INTO penny."__EFMigrationsHistory" VALUES ('29990101000000_Future', '10.0.14')""",
            Ct
        );
        try
        {
            var logs = new CapturingLoggerProvider();
            await using var factory = StartupFactory(Fixture.Connection, logs);
            Should.Throw<InvalidOperationException>(() => factory.CreateClient());
            logs.Messages.ShouldContain(message =>
                message.Contains(
                    "Database migration failed on startup: DatabaseSetupException: Database schema is newer than this build.",
                    StringComparison.Ordinal
                )
            );
        }
        finally
        {
            await Fixture.SqlAsync(
                """DELETE FROM penny."__EFMigrationsHistory" WHERE "MigrationId" = '29990101000000_Future'""",
                Ct
            );
        }
    }

    [Fact]
    public async Task whenAnotherMigrationHoldsLock_Startup_ShouldLogWaitingThenMigrate()
    {
        await using var holder = await Fixture.Admin.OpenConnectionAsync(Ct);
        await using (var take = new NpgsqlCommand("SELECT pg_advisory_lock($1)", holder))
        {
            take.Parameters.Add(
                new NpgsqlParameter<long>
                {
                    TypedValue = Penny.Backend.Persistence.Schema.DatabaseSchema.MigrationLock,
                }
            );
            await take.ExecuteNonQueryAsync(Ct);
        }
        var logs = new CapturingLoggerProvider();
        await using var factory = StartupFactory(Fixture.Connection, logs);
        Task<HttpClient> starting;
        try
        {
            starting = Task.Run(factory.CreateClient, Ct);
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (
                !logs.Messages.Any(message =>
                    message.Contains(
                        "Waiting to migrate the database (migration-lock): MigrationLockedException: Another database migration holds the lock.",
                        StringComparison.Ordinal
                    )
                )
            )
            {
                DateTime.UtcNow.ShouldBeLessThan(deadline, "the startup migration never waited");
                await Task.Delay(100, Ct);
            }
            starting.IsCompleted.ShouldBeFalse();
        }
        finally
        {
            await using var release = new NpgsqlCommand("SELECT pg_advisory_unlock_all()", holder);
            await release.ExecuteNonQueryAsync(CancellationToken.None);
        }
        using var client = await starting.WaitAsync(TimeSpan.FromSeconds(30), Ct);
        using var response = await client.GetAsync("/api/ready", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        logs.Messages.ShouldContain(message =>
            message.Contains("Database migrated.", StringComparison.Ordinal)
        );
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task whenClientConnectionChecksOff_Startup_ShouldWarn(bool off)
    {
        // The test server checks every second; a session option turns it off for the API.
        var connection = off
            ? new NpgsqlConnectionStringBuilder(Fixture.Connection)
            {
                Options = "-c client_connection_check_interval=0",
            }.ConnectionString
            : Fixture.Connection;
        var logs = new CapturingLoggerProvider();
        await using var factory = StartupFactory(connection, logs);
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/api/ready", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        logs.Messages.Any(message =>
                message.Contains(
                    "PostgreSQL has client_connection_check_interval off",
                    StringComparison.Ordinal
                )
            )
            .ShouldBe(off);
    }

    private static TestApiFactory StartupFactory(string connection, CapturingLoggerProvider logs) =>
        new(
            connection,
            new Dictionary<string, string>
            {
                ["Database:MigrateOnStartup"] = "true",
                ["Logging:LogLevel:Default"] = "Information",
            },
            services =>
            {
                services.RemoveAll<ILoggerProvider>();
                services.AddSingleton<ILoggerProvider>(logs);
            }
        );

    [Fact]
    public async Task whenMigrateOnStartupInvalid_CreateHost_ShouldIdentifySetting()
    {
        await using var factory = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting("Database:MigrateOnStartup", "sometimes")
        );
        var error = Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        error.Message.ShouldContain("Database:MigrateOnStartup");
    }
}
