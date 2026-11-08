using System.Net;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Invitations, joins, exits and archive over real HTTP + PostgreSQL. All data is
// synthetic.
public sealed class HouseholdMembershipTests(ApiFixture fixture) : HouseholdTestBase(fixture)
{
    [Fact]
    public async Task whenInviteExpiredReusedOrReplaced_JoinHousehold_ShouldRejectWithoutConsuming()
    {
        At(Noon);
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, _) = await AccountAsync("bea@example.test");
        var (cam, _) = await AccountAsync("cam@example.test");
        var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;

        var invite = await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/invites",
            alex,
            HttpStatusCode.Created
        );
        var code = invite.GetProperty("code").GetString()!;
        code.ShouldMatch("^[0-9A-F]{10}$");
        invite.GetProperty("expiresAt").GetInt64().ShouldBe(Millis(Noon) + 600_000);
        // Only the SHA-256 of the code is stored.
        (
            await ScalarAsync(
                $"SELECT code_hash FROM penny.household_invites WHERE household_id = '{home}'"
            )
        ).ShouldBe(InviteCodes.Hash(code));
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_invites WHERE code_hash = '{code}'"
            )
        ).ShouldBe(0L);

        // Malformed codes are invalid data; unknown codes are invalid invites.
        foreach (
            var malformed in new object[]
            {
                new { code = "ABCDEF012" },
                new { code = "ABCDEF012G" },
                new { code = 1234567890 },
                new { },
            }
        )
            await ExpectErrorAsync(
                HttpMethod.Post,
                "/api/households/join",
                bea,
                HttpStatusCode.BadRequest,
                HouseholdService.InvalidData,
                malformed
            );
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/join",
            bea,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidInvite,
            new { code = "0000000000" }
        );

        // A failed join (currency) leaves the code usable.
        await Fixture.SqlAsync(
            "UPDATE penny.ledgers SET currency = 'USD' WHERE user_id = (SELECT id FROM penny.users WHERE email = 'bea@example.test')",
            Ct
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/join",
            bea,
            HttpStatusCode.BadRequest,
            HouseholdService.HouseholdCurrency,
            new { code }
        );
        await Fixture.SqlAsync(
            "UPDATE penny.ledgers SET currency = 'CAD' WHERE user_id = (SELECT id FROM penny.users WHERE email = 'bea@example.test')",
            Ct
        );
        // The creator is already a member: 409, and the code stays usable.
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/join",
            alex,
            HttpStatusCode.Conflict,
            HouseholdService.AlreadyMember,
            new { code }
        );

        // Codes are case-insensitive and single-use.
        var joined = (
            await ExpectAsync(
                HttpMethod.Post,
                "/api/households/join",
                bea,
                HttpStatusCode.OK,
                new { code = code.ToLowerInvariant() }
            )
        ).GetProperty("household");
        joined.GetProperty("id").GetString().ShouldBe(home);
        joined.GetProperty("memberCount").GetInt32().ShouldBe(2);
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/join",
            cam,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidInvite,
            new { code }
        );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_invites WHERE household_id = '{home}' AND used_at IS NOT NULL"
            )
        ).ShouldBe(1L);

        // A new invite replaces the previous one.
        var first = await InviteAsync(home, alex);
        var second = await InviteAsync(home, alex);
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/join",
            cam,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidInvite,
            new { code = first }
        );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_invites WHERE household_id = '{home}'"
            )
        ).ShouldBe(1L);

        // Expiry is exclusive: valid one millisecond before, invalid at the instant.
        At(Noon.AddMinutes(10));
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/join",
            cam,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidInvite,
            new { code = second }
        );
        var third = await InviteAsync(home, alex);
        At(Noon.AddMinutes(20).AddMilliseconds(-1));
        await ExpectAsync(
            HttpMethod.Post,
            "/api/households/join",
            cam,
            HttpStatusCode.OK,
            new { code = third }
        );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND action = 'member.joined'"
            )
        ).ShouldBe(2L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND action = 'invite.created'"
            )
        ).ShouldBe(4L);
    }

    [Fact]
    public async Task whenMembersJoinAroundLocalMidnight_JoinHousehold_ShouldRecordTheirLocalJoinDay()
    {
        // October 4 at 9:30 p.m. in Toronto (UTC-4), already October 5 in UTC.
        var evening = new DateTimeOffset(2026, 10, 5, 1, 30, 0, TimeSpan.Zero);
        At(evening);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var home = (await CreateHouseholdAsync(alex, offset: 240)).GetProperty("id").GetString()!;
        (await MemberAsync(home, alex, alexId))
            .GetProperty("joinedOn")
            .GetString()
            .ShouldBe("2026-10-04");

        foreach (
            var (email, offset, expected) in new (string, int?, string?)[]
            {
                ("toronto@example.test", 240, "2026-10-04"),
                ("kiritimati@example.test", -840, "2026-10-05"),
                ("baker@example.test", 720, "2026-10-04"),
                ("utc@example.test", 0, "2026-10-05"),
                ("older-client@example.test", null, null),
            }
        )
        {
            var (token, userId) = await AccountAsync(email);
            await AdmitAsync(home, alex, token, offset);
            var member = await MemberAsync(home, alex, userId);
            member.GetProperty("joinedAt").GetInt64().ShouldBe(Millis(evening));
            if (expected is null)
                member.TryGetProperty("joinedOn", out _).ShouldBeFalse();
            else
                member.GetProperty("joinedOn").GetString().ShouldBe(expected);
        }

        // Exactly at local midnight the new local day begins.
        var (late, lateId) = await AccountAsync("midnight@example.test");
        At(new DateTimeOffset(2026, 10, 5, 4, 0, 0, TimeSpan.Zero).AddMilliseconds(-1));
        await AdmitAsync(home, alex, late, 240);
        (await MemberAsync(home, alex, lateId))
            .GetProperty("joinedOn")
            .GetString()
            .ShouldBe("2026-10-04");
        var (early, earlyId) = await AccountAsync("after-midnight@example.test");
        At(new DateTimeOffset(2026, 10, 5, 4, 0, 0, TimeSpan.Zero));
        await AdmitAsync(home, alex, early, 240);
        (await MemberAsync(home, alex, earlyId))
            .GetProperty("joinedOn")
            .GetString()
            .ShouldBe("2026-10-05");
    }

    [Fact]
    public async Task whenBalancesUnsettled_LeaveRemoveAndArchive_ShouldConflictUntilSettled()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var (cam, camId) = await AccountAsync("cam@example.test");
        var (dan, _) = await AccountAsync("dan@example.test");
        var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
        await AdmitAsync(home, alex, bea);
        // September: alex paid 9000 split with bea. October: bea paid alex's 4500 back
        // as an expense, which does not settle September (months are independent).
        await AddExpenseAsync(home, alexId, 9000, "2026-09-10", (alexId, 4500), (beaId, 4500));
        await AddExpenseAsync(home, beaId, 4500, "2026-10-02", (alexId, 4500));
        // A deleted expense never counts.
        await AddExpenseAsync(home, alexId, 100, "2026-08-01", (beaId, 100));
        await Fixture.SqlAsync(
            $"UPDATE penny.household_expenses SET deleted_at = now() WHERE household_id = '{home}' AND expense_date = DATE '2026-08-01'",
            Ct
        );

        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/leave",
            bea,
            HttpStatusCode.Conflict,
            HouseholdService.UnsettledExit
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            $"/api/households/{home}/members/{beaId}",
            alex,
            HttpStatusCode.Conflict,
            HouseholdService.UnsettledExit
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/archive",
            alex,
            HttpStatusCode.Conflict,
            HouseholdService.UnsettledArchive
        );

        // Joining after historical expenses: cam owes nothing for them and may leave.
        At(Noon.AddHours(30));
        await AdmitAsync(home, alex, cam);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_splits WHERE user_id = '{camId}'"
            )
        ).ShouldBe(0L);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", cam, HttpStatusCode.OK);

        // Settling both months (an individual payment and a monthly reimbursement).
        await AddReimbursementAsync(home, "2026-09", beaId, alexId, 4500);
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/leave",
            bea,
            HttpStatusCode.Conflict,
            HouseholdService.UnsettledExit
        );
        await AddReimbursementAsync(home, "2026-10", alexId, beaId, 4500);
        var leftAt = Noon.AddHours(31);
        At(leftAt);
        (
            await ExpectAsync(
                HttpMethod.Post,
                $"/api/households/{home}/leave",
                bea,
                HttpStatusCode.OK
            )
        )
            .GetProperty("ok")
            .GetBoolean()
            .ShouldBeTrue();

        // Former members keep history: the household stays listed and readable, with
        // only the members who had joined by the time they left.
        At(Noon.AddHours(40));
        await AdmitAsync(home, alex, dan);
        (await ListIdsAsync(bea)).ShouldBe([home]);
        var seenByBea = await DetailAsync(home, bea);
        seenByBea.GetProperty("household").GetProperty("memberCount").GetInt32().ShouldBe(2);
        seenByBea
            .GetProperty("members")
            .EnumerateArray()
            .Select(member => member.GetProperty("userId").GetString())
            .ShouldBe([alexId, beaId, camId], ignoreOrder: true);
        (await MemberAsync(home, alex, beaId))
            .GetProperty("leftAt")
            .GetInt64()
            .ShouldBe(Millis(leftAt));
        (await DetailAsync(home, alex)).GetProperty("members").GetArrayLength().ShouldBe(4);
        // A former member can no longer act on the household.
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/leave",
            bea,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );

        // Everyone is settled now, so the creator may archive.
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/archive",
            alex,
            HttpStatusCode.OK
        );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND action IN ('member.left', 'household.archived')"
            )
        ).ShouldBe(3L);
    }

    [Fact]
    public async Task whenCreatorLeavesOrRemovesMembers_MembershipFlow_ShouldEnforceCreatorRules()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var (cam, camId) = await AccountAsync("cam@example.test");
        var (_, outsiderId) = await AccountAsync("outsider@example.test");
        var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
        await AdmitAsync(home, alex, bea);
        await AdmitAsync(home, alex, cam);

        await ExpectErrorAsync(
            HttpMethod.Delete,
            $"/api/households/{home}/members/{alexId}",
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.CreatorCannotBeRemoved
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/leave",
            alex,
            HttpStatusCode.Conflict,
            HouseholdService.CreatorCannotLeave
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            $"/api/households/{home}/members/{camId}",
            bea,
            HttpStatusCode.Forbidden,
            HouseholdService.CreatorOnly
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            $"/api/households/{home}/members/{outsiderId}",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            $"/api/households/{home}/members/unknown-user",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );

        At(Noon.AddHours(1));
        await ExpectAsync(
            HttpMethod.Delete,
            $"/api/households/{home}/members/{beaId}",
            alex,
            HttpStatusCode.OK
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            $"/api/households/{home}/members/{beaId}",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
        (await MemberAsync(home, bea, beaId))
            .GetProperty("leftAt")
            .GetInt64()
            .ShouldBe(Millis(Noon.AddHours(1)));
        (
            await ScalarAsync(
                $"SELECT actor_id || ':' || (before_json->>'userId') FROM penny.household_audit WHERE action = 'member.removed'"
            )
        ).ShouldBe($"{alexId}:{beaId}");

        // A removed member rejoins with a new period; the old one is kept.
        At(Noon.AddHours(2));
        await AdmitAsync(home, alex, bea, offset: 0);
        var rejoined = await MemberAsync(home, alex, beaId);
        rejoined.GetProperty("joinedAt").GetInt64().ShouldBe(Millis(Noon.AddHours(2)));
        rejoined.TryGetProperty("leftAt", out _).ShouldBeFalse();
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_member_periods WHERE household_id = '{home}' AND user_id = '{beaId}'"
            )
        ).ShouldBe(2L);

        // Once alone, the creator may leave; the household is then empty but kept.
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", cam, HttpStatusCode.OK);
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/leave",
            alex,
            HttpStatusCode.OK
        );
        (await DetailAsync(home, alex))
            .GetProperty("household")
            .GetProperty("memberCount")
            .GetInt32()
            .ShouldBe(0);
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/invites",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
    }

    [Fact]
    public async Task whenAccountBelongsToSeveralHouseholds_HouseholdList_ShouldScopeEveryMembership()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, _) = await AccountAsync("bea@example.test");
        var first = (await CreateHouseholdAsync(alex, "First")).GetProperty("id").GetString()!;
        At(Noon.AddMinutes(1));
        var trip = (await CreateTripAsync(alex)).GetProperty("id").GetString()!;
        At(Noon.AddMinutes(2));
        var beas = (await CreateHouseholdAsync(bea, "Bea's")).GetProperty("id").GetString()!;
        At(Noon.AddMinutes(3));

        // An invite admits to its own household only.
        var code = await InviteAsync(beas, bea);
        var joined = (
            await ExpectAsync(
                HttpMethod.Post,
                "/api/households/join",
                alex,
                HttpStatusCode.OK,
                new { code }
            )
        ).GetProperty("household");
        joined.GetProperty("id").GetString().ShouldBe(beas);
        (await ListIdsAsync(alex)).ShouldBe([beas, trip, first]);
        (await ListIdsAsync(bea)).ShouldBe([beas]);
        await ExpectErrorAsync(
            HttpMethod.Get,
            $"/api/households/{first}",
            bea,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
        // Bea created hers, so alex is not its creator.
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{beas}/invites",
            alex,
            HttpStatusCode.Forbidden,
            HouseholdService.CreatorOnly
        );

        // Leaving one household changes no other membership.
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{beas}/leave",
            alex,
            HttpStatusCode.OK
        );
        (await DetailAsync(first, alex))
            .GetProperty("household")
            .GetProperty("memberCount")
            .GetInt32()
            .ShouldBe(1);
        (await DetailAsync(beas, bea))
            .GetProperty("household")
            .GetProperty("memberCount")
            .GetInt32()
            .ShouldBe(1);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_member_periods WHERE user_id = '{alexId}' AND left_at IS NULL"
            )
        ).ShouldBe(2L);
    }

    [Fact]
    public async Task whenHouseholdArchived_HouseholdRoutes_ShouldHideItAndRefuseChanges()
    {
        At(Noon);
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, _) = await AccountAsync("bea@example.test");
        var (cam, _) = await AccountAsync("cam@example.test");
        var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
        await AdmitAsync(home, alex, bea);
        var pending = await InviteAsync(home, alex);

        At(Noon.AddMinutes(1));
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/archive",
            alex,
            HttpStatusCode.OK
        );
        (
            await ScalarAsync(
                $"SELECT archived_at = TIMESTAMPTZ '2026-09-28 12:01:00+00' FROM penny.households WHERE id = '{home}'"
            )
        ).ShouldBe(true);

        (await ListIdsAsync(alex)).ShouldBeEmpty();
        (await ListIdsAsync(bea)).ShouldBeEmpty();
        // History stays readable by its members.
        (await DetailAsync(home, bea))
            .GetProperty("members")
            .GetArrayLength()
            .ShouldBe(2);
        // Outstanding invites are revoked and no change is accepted.
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/join",
            cam,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidInvite,
            new { code = pending }
        );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_invites WHERE household_id = '{home}'"
            )
        ).ShouldBe(0L);
        await ExpectErrorAsync(
            HttpMethod.Patch,
            $"/api/households/{home}",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            new { name = "Again" }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/invites",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/archive",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/leave",
            bea,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );

        // An archived household no longer constrains its members' ledger currency.
        var ledger = await GetLedgerAsync(bea);
        ledger["ledger"]!["currency"] = "USD";
        using var saved = await PutLedgerAsync(bea, ledger);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
