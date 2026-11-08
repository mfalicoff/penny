using System.Net;
using System.Text.Json;
using Penny.Backend.Application.Households;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Concurrent membership operations against real PostgreSQL row locks. Each race is
// repeated, and its outcome is checked against the committed rows. All data is
// synthetic.
public sealed class HouseholdConcurrencyTests(ApiFixture fixture) : HouseholdTestBase(fixture)
{
    private const int Rounds = 4;

    [Fact]
    public async Task whenManyAccountsRedeemOneInvite_JoinHousehold_ShouldAdmitExactlyOne()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        var tokens = new List<string>();
        for (var index = 0; index < 8; index++)
            tokens.Add((await AccountAsync($"guest{index}@example.test")).Token);
        var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
        var code = await InviteAsync(home, alex);

        var results = await Task.WhenAll(
            tokens.Select(token => OutcomeAsync(JoinAsync(token, code)))
        );

        results.Count(result => result.Status == HttpStatusCode.OK).ShouldBe(1);
        results
            .Where(result => result.Status != HttpStatusCode.OK)
            .ShouldAllBe(result =>
                result.Status == HttpStatusCode.BadRequest
                && result.Error == HouseholdService.InvalidInvite
            );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_member_periods WHERE household_id = '{home}' AND left_at IS NULL"
            )
        ).ShouldBe(2L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND action = 'member.joined'"
            )
        ).ShouldBe(1L);
    }

    [Fact]
    public async Task whenSameAccountJoinsTwiceAtOnce_JoinHousehold_ShouldOpenOnePeriod()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        for (var round = 0; round < Rounds; round++)
        {
            var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
            var code = await InviteAsync(home, alex);
            var results = await Task.WhenAll(
                OutcomeAsync(JoinAsync(bea, code)),
                OutcomeAsync(JoinAsync(bea, code))
            );
            results.Count(result => result.Status == HttpStatusCode.OK).ShouldBe(1);
            // The loser waited on the household lock, then found itself admitted (or,
            // had it read the invite later, the code consumed).
            results.ShouldContain(result =>
                result.Error == HouseholdService.AlreadyMember
                || result.Error == HouseholdService.InvalidInvite
            );
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_member_periods WHERE household_id = '{home}' AND user_id = '{beaId}'"
                )
            ).ShouldBe(1L);
        }
    }

    [Fact]
    public async Task whenJoinRacesArchive_MembershipFlow_ShouldSerializeOnTheHousehold()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        for (var round = 0; round < Rounds; round++)
        {
            var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
            var code = await InviteAsync(home, alex);
            var results = await Task.WhenAll(
                OutcomeAsync(JoinAsync(bea, code)),
                OutcomeAsync(SendAsync(HttpMethod.Post, $"/api/households/{home}/archive", alex))
            );
            var (join, archive) = (results[0], results[1]);
            // A new member owes nothing, so archive always succeeds; the join either
            // committed first or found the household archived.
            archive.Status.ShouldBe(HttpStatusCode.OK);
            var joined = join.Status == HttpStatusCode.OK;
            if (!joined)
            {
                join.Status.ShouldBe(HttpStatusCode.BadRequest);
                join.Error.ShouldBe(HouseholdService.InvalidInvite);
            }
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_member_periods WHERE household_id = '{home}' AND user_id = '{beaId}'"
                )
            ).ShouldBe(joined ? 1L : 0L);
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.households WHERE id = '{home}' AND archived_at IS NOT NULL"
                )
            ).ShouldBe(1L);
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_invites WHERE household_id = '{home}'"
                )
            ).ShouldBe(0L);
        }
    }

    [Fact]
    public async Task whenLeaveRacesRemoval_MembershipFlow_ShouldEndMembershipOnce()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        for (var round = 0; round < Rounds; round++)
        {
            var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
            await AdmitAsync(home, alex, bea);
            var results = await Task.WhenAll(
                OutcomeAsync(SendAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea)),
                OutcomeAsync(
                    SendAsync(HttpMethod.Delete, $"/api/households/{home}/members/{beaId}", alex)
                )
            );
            results.Count(result => result.Status == HttpStatusCode.OK).ShouldBe(1);
            results.ShouldContain(result =>
                result.Status == HttpStatusCode.NotFound
                && result.Error == HouseholdService.NotFound
            );
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_member_periods WHERE household_id = '{home}' AND user_id = '{beaId}' AND left_at IS NOT NULL"
                )
            ).ShouldBe(1L);
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND action IN ('member.left', 'member.removed')"
                )
            ).ShouldBe(1L);
        }
    }

    [Fact]
    public async Task whenLeaveRacesArchive_MembershipFlow_ShouldNeverFail()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        for (var round = 0; round < Rounds; round++)
        {
            var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
            await AdmitAsync(home, alex, bea);
            var results = await Task.WhenAll(
                OutcomeAsync(SendAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea)),
                OutcomeAsync(SendAsync(HttpMethod.Post, $"/api/households/{home}/archive", alex))
            );
            var (leave, archive) = (results[0], results[1]);
            archive.Status.ShouldBe(HttpStatusCode.OK);
            // Leaving an archived household is not found; otherwise it committed first.
            leave.Status.ShouldBeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_member_periods WHERE household_id = '{home}' AND user_id = '{beaId}' AND left_at IS NULL"
                )
            ).ShouldBe(leave.Status == HttpStatusCode.OK ? 0L : 1L);
        }
    }

    [Fact]
    public async Task whenJoinRacesLedgerCurrencyChange_MembershipFlow_ShouldNeverMixCurrencies()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        for (var round = 0; round < Rounds * 2; round++)
        {
            await Fixture.SqlAsync(
                $"UPDATE penny.ledgers SET currency = 'CAD' WHERE user_id = '{beaId}'",
                Ct
            );
            var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
            var code = await InviteAsync(home, alex);
            var ledger = await GetLedgerAsync(bea);
            ledger["ledger"]!["currency"] = "USD";
            var results = await Task.WhenAll(
                OutcomeAsync(JoinAsync(bea, code)),
                OutcomeAsync(PutLedgerAsync(bea, ledger))
            );
            var (join, save) = (results[0], results[1]);
            // Exactly one wins: a CAD member, or a USD ledger outside the household.
            (join.Status == HttpStatusCode.OK).ShouldNotBe(save.Status == HttpStatusCode.OK);
            if (join.Status == HttpStatusCode.OK)
                save.Error.ShouldBe(LedgerService.CurrencyMismatch);
            else
                join.Error.ShouldBe(HouseholdService.HouseholdCurrency);
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_member_periods p JOIN penny.households h ON h.id = p.household_id JOIN penny.ledgers l ON l.user_id = p.user_id WHERE p.user_id = '{beaId}' AND p.left_at IS NULL AND h.currency <> l.currency"
                )
            ).ShouldBe(0L);
            // Leave the household again so the next round starts unconstrained.
            if (join.Status == HttpStatusCode.OK)
                await ExpectAsync(
                    HttpMethod.Post,
                    $"/api/households/{home}/leave",
                    bea,
                    HttpStatusCode.OK
                );
        }
    }

    [Fact]
    public async Task whenInviteReplacedDuringJoin_JoinHousehold_ShouldUseOnlyALiveCode()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        for (var round = 0; round < Rounds; round++)
        {
            var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
            var code = await InviteAsync(home, alex);
            var results = await Task.WhenAll(
                OutcomeAsync(JoinAsync(bea, code)),
                OutcomeAsync(SendAsync(HttpMethod.Post, $"/api/households/{home}/invites", alex))
            );
            var (join, invite) = (results[0], results[1]);
            invite.Status.ShouldBe(HttpStatusCode.Created);
            join.Status.ShouldBeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_member_periods WHERE household_id = '{home}' AND user_id = '{beaId}'"
                )
            ).ShouldBe(join.Status == HttpStatusCode.OK ? 1L : 0L);
            // Exactly the replacement invite remains, unused.
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_invites WHERE household_id = '{home}' AND used_at IS NULL"
                )
            ).ShouldBe(1L);
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_invites WHERE household_id = '{home}'"
                )
            ).ShouldBe(1L);
        }
    }

    private static async Task<(HttpStatusCode Status, string? Error)> OutcomeAsync(
        Task<HttpResponseMessage> request
    )
    {
        using var response = await request;
        var text = await response.Content.ReadAsStringAsync(Ct);
        string? error = null;
        if (!response.IsSuccessStatusCode)
            error = JsonDocument.Parse(text).RootElement.GetProperty("error").GetString();
        return (response.StatusCode, error);
    }
}
