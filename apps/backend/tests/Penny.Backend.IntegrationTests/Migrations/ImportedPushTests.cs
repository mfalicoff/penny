using System.Globalization;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Push;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Import;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// Imported SQLite push state (LegacyDatabase plus a live session, an Expo device and a
// pending household message) coexists with a native APNs registration made after
// the import: the imported Expo token keeps the legacy transport and both devices
// receive the next message. Stale imported messages expire. All data is synthetic.
public sealed class ImportedPushTests(ApiFixture fixture) : PushTestBase(fixture)
{
    private const long SessionExpiry = 1893456000000; // 2030-01-01T00:00:00Z
    private static readonly string SessionToken = new('c', 64);

    [Fact]
    public async Task whenLegacyExpoDeviceImported_RunUntilIdle_ShouldDeliverAlongsideNewApnsDevice()
    {
        At(Noon);
        using (var legacy = new LegacyDatabase())
        {
            legacy.Execute(
                string.Create(
                    CultureInfo.InvariantCulture,
                    $$"""
                    INSERT INTO sessions VALUES('{{SessionTokens.Hash(
                        SessionToken
                    )}}','legacy:user-01',{{SessionExpiry}});
                    INSERT INTO push_devices VALUES('ExponentPushToken[imported]','legacy:user-01','{{SessionTokens.Hash(
                        SessionToken
                    )}}','ios',{{Millis(Noon) - 1000}});
                    INSERT INTO push_outbox VALUES('fresh','legacy:user-01','h','reimbursement.created','payment','{"householdId":"h","month":"2024-02","eventId":"audit-1"}',{{Millis(
                        Noon
                    ) - 1000}},NULL,0,{{Millis(Noon) - 1000}},NULL);
                    """
                )
            );
            legacy.Seal();
            await SqliteImporter.RunAsync(
                Fixture.Admin,
                Fixture.Receipts,
                legacy.SnapshotPath,
                legacy.Sha256,
                ImportMode.Import,
                null,
                Ct
            );
        }
        (
            await ScalarAsync(
                "SELECT string_agg(provider || '/' || coalesce(environment, '-'), ',') FROM penny.push_devices"
            )
        ).ShouldBe("expo/-,expo/-");
        (
            await CountAsync("SELECT count(*) FROM penny.push_deliveries WHERE provider = 'expo'")
        ).ShouldBe(1);

        await RegisterApnsAsync(SessionToken, ApnsToken(9), "production");
        await Runner().RunUntilIdleAsync(Ct);

        var expo = (await Expo.SentToAsync("ExponentPushToken[imported]")).Single();
        var apns = (await Apns.SentToAsync(ApnsToken(9))).Single();
        expo.Payload.ShouldBe(new PushPayload("h", "2024-02", null, "audit-1"));
        apns.Payload.ShouldBe(expo.Payload);
        expo.Title.ShouldBe("Reimbursement recorded");
        // The fixture's own device also has a live session, so it gets the new message;
        // the imported 2023 message expired instead of sending.
        Expo.Sent.Count.ShouldBe(2);
        Expo.Sent.ShouldAllBe(message => message.OutboxId == "fresh");
        (await ScalarAsync("SELECT last_error FROM penny.push_outbox WHERE id = 'event'")).ShouldBe(
            "expired"
        );
        (await UnsentMessagesAsync()).ShouldBe(0);
    }
}
