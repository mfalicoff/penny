using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.Application.Push;
using Penny.Backend.Persistence.Repositories;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// HTTP and runner helpers for the push suites (MAZ-61). The shared host runs no push
// worker: tests build runners over the real PostgreSQL outbox with fake providers and
// the pinned clock, or independent runners (own data source) to act as separate
// worker processes. Tokens and data are synthetic.
public abstract class PushTestBase(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    protected const string DevicesPath = "/api/push/devices";

    protected FakePushTransport Apns { get; } = new(PushProviders.Apns);

    protected NpgsqlDataSource Source =>
        Fixture.Factory.Services.GetRequiredService<NpgsqlDataSource>();

    // A synthetic 32-byte APNs device token, distinct per seed.
    protected static string ApnsToken(int seed) =>
        Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData([(byte)seed]));

    protected PushDeliveryRunner Runner(
        NpgsqlDataSource? source = null,
        TimeProvider? clock = null,
        IPushTransport[]? transports = null
    ) =>
        new(
            new PostgresPushRepository(source ?? Source),
            transports ?? [Apns],
            clock ?? Fixture.Factory.Clock
        );

    protected Task RegisterApnsAsync(string bearer, string token, string environment) =>
        ExpectAsync(
            HttpMethod.Post,
            DevicesPath,
            bearer,
            HttpStatusCode.Created,
            new
            {
                token,
                platform = "ios",
                provider = "apns",
                environment,
            }
        );

    // Two members of one household, `alex` creating it; returns tokens and ids.
    protected async Task<(
        string HouseholdId,
        (string Token, string UserId) Alex,
        (string Token, string UserId) Sam
    )> HouseholdAsync()
    {
        At(Noon);
        var alex = await AccountAsync("alex@example.test");
        var sam = await AccountAsync("sam@example.test");
        var householdId = (await CreateHouseholdAsync(alex.Token)).GetProperty("id").GetString()!;
        await AdmitAsync(householdId, alex.Token, sam.Token);
        return (householdId, alex, sam);
    }

    protected Task<long> PendingAsync() =>
        CountAsync("SELECT count(*) FROM penny.push_deliveries WHERE sent_at IS NULL");

    protected Task<long> UnsentMessagesAsync() =>
        CountAsync("SELECT count(*) FROM penny.push_outbox WHERE sent_at IS NULL");
}
