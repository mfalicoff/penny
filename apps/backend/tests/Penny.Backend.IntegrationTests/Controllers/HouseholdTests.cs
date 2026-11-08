using System.Net;
using System.Text;
using System.Text.Json;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Real HTTP + PostgreSQL ports of the legacy household creation, detail, rename, trip
// and access journeys (tests/core/households-server.test.ts). All data is synthetic.
public sealed class HouseholdTests(ApiFixture fixture) : HouseholdTestBase(fixture)
{
    [Fact]
    public async Task whenHouseholdsCreated_HouseholdFlow_ShouldReturnLegacyShapes()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");

        using (
            var created = await SendAsync(
                HttpMethod.Post,
                "/api/households",
                alex,
                new
                {
                    name = "  Home  ",
                    currency = "CAD",
                    timezoneOffsetMinutes = 240,
                }
            )
        )
        {
            created.StatusCode.ShouldBe(HttpStatusCode.Created);
            // Legacy key order and envelope; regular households have no `trip`.
            var text = await created.Content.ReadAsStringAsync(Ct);
            var household = JsonDocument.Parse(text).RootElement.GetProperty("household");
            var id = household.GetProperty("id").GetString()!;
            id.ShouldMatch("^[0-9a-f]{32}$");
            var createdAt = Millis(Noon);
            text.ShouldBe(
                $$$"""{"household":{"id":"{{{id}}}","name":"Home","currency":"CAD","creatorId":"{{{alexId}}}","createdAt":{{{createdAt}}},"memberCount":1}}"""
            );
        }

        var trip = await CreateTripAsync(alex);
        trip.GetProperty("trip").GetProperty("startDate").GetString().ShouldBe("2026-11-01");
        trip.GetProperty("trip").GetProperty("endDate").GetString().ShouldBe("2026-11-08");
        var tripId = trip.GetProperty("id").GetString()!;

        var detail = await DetailAsync(tripId, alex);
        detail.GetProperty("household").GetProperty("memberCount").GetInt32().ShouldBe(1);
        var creator = detail.GetProperty("members").EnumerateArray().Single();
        creator.GetProperty("userId").GetString().ShouldBe(alexId);
        creator.GetProperty("email").GetString().ShouldBe("alex@example.test");
        creator.GetProperty("joinedAt").GetInt64().ShouldBe(Millis(Noon));
        // Without an offset there is no local join day, as with older clients.
        creator.TryGetProperty("joinedOn", out _).ShouldBeFalse();
        creator.TryGetProperty("leftAt", out _).ShouldBeFalse();

        (await ListIdsAsync(alex)).Count.ShouldBe(2);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.household_audit WHERE action IN ('household.created', 'trip.created') AND after_json ? 'memberCount'"
            )
        ).ShouldBe(2L);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.household_member_periods WHERE joined_on = DATE '2026-09-28'"
            )
        ).ShouldBe(1L);
    }

    [Fact]
    public async Task whenBodyInvalid_CreateHousehold_ShouldReturnLegacyErrors()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        object[] invalidHouseholds =
        [
            new { currency = "CAD" },
            new { name = "   ", currency = "CAD" },
            new { name = new string('a', 81), currency = "CAD" },
            new { name = "Home", currency = "JPY" },
            new { name = "Home", currency = "cad" },
            new
            {
                name = "Home",
                currency = "CAD",
                timezoneOffsetMinutes = 721,
            },
            new
            {
                name = "Home",
                currency = "CAD",
                timezoneOffsetMinutes = -841,
            },
            new
            {
                name = "Home",
                currency = "CAD",
                timezoneOffsetMinutes = 1.5,
            },
            new
            {
                name = "Home",
                currency = "CAD",
                timezoneOffsetMinutes = (int?)null,
            },
            new { name = 7, currency = "CAD" },
        ];
        foreach (var body in invalidHouseholds)
            await ExpectErrorAsync(
                HttpMethod.Post,
                "/api/households",
                alex,
                HttpStatusCode.BadRequest,
                HouseholdService.InvalidData,
                body
            );
        object[] invalidTrips =
        [
            new
            {
                name = "Coast",
                currency = "CAD",
                startDate = "2026-11-08",
                endDate = "2026-11-01",
            },
            new
            {
                name = "Coast",
                currency = "CAD",
                startDate = "1999-12-31",
                endDate = "2026-11-01",
            },
            new
            {
                name = "Coast",
                currency = "CAD",
                startDate = "2026-11-01",
                endDate = "2101-01-01",
            },
            new
            {
                name = "Coast",
                currency = "CAD",
                startDate = "2026-02-29",
                endDate = "2026-03-01",
            },
            new { name = "Coast", currency = "CAD" },
        ];
        foreach (var body in invalidTrips)
            await ExpectErrorAsync(
                HttpMethod.Post,
                "/api/households/trips",
                alex,
                HttpStatusCode.BadRequest,
                HouseholdService.InvalidData,
                body
            );

        // Malformed JSON keeps the shared boundary message.
        using (var request = Authorized(HttpMethod.Post, "/api/households", bearer: alex))
        {
            request.Content = new StringContent("{\"name\":", Encoding.UTF8, "application/json");
            using var malformed = await Client.SendAsync(request, Ct);
            await AuthTests.ShouldBeErrorAsync(
                malformed,
                HttpStatusCode.BadRequest,
                "Invalid JSON."
            );
        }

        // Currency must match the creator's private ledger.
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households",
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.HouseholdCurrency,
            new { name = "Home", currency = "USD" }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/trips",
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.TripCurrency,
            new
            {
                name = "Coast",
                currency = "EUR",
                startDate = "2026-11-01",
                endDate = "2026-11-01",
            }
        );
        (await CountAsync("SELECT count(*) FROM penny.households")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenCallerIsNotMemberOrCreator_HouseholdRoutes_ShouldReturnLegacyAccessErrors()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var (outsider, _) = await AccountAsync("outsider@example.test");
        var home = (await CreateHouseholdAsync(alex)).GetProperty("id").GetString()!;
        var trip = (await CreateTripAsync(alex)).GetProperty("id").GetString()!;
        await AdmitAsync(home, alex, bea);
        await AdmitAsync(trip, alex, bea);
        var dates = new
        {
            name = "Renamed",
            startDate = "2026-11-01",
            endDate = "2026-11-02",
        };

        // No session: 401 before anything else.
        using (var anonymous = await SendAsync(HttpMethod.Get, "/api/households", null))
            anonymous.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        using (var anonymous = await JoinAsync(null!, "ABCDEF0123"))
            anonymous.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        // Outsiders and unknown households look the same: 404, even with invalid bodies.
        foreach (var id in new[] { home, "missing-household" })
        {
            await ExpectErrorAsync(
                HttpMethod.Get,
                $"/api/households/{id}",
                outsider,
                HttpStatusCode.NotFound,
                HouseholdService.NotFound
            );
            await ExpectErrorAsync(
                HttpMethod.Patch,
                $"/api/households/{id}",
                outsider,
                HttpStatusCode.NotFound,
                HouseholdService.NotFound,
                new { }
            );
            await ExpectErrorAsync(
                HttpMethod.Patch,
                $"/api/households/{id}/trip",
                outsider,
                HttpStatusCode.NotFound,
                HouseholdService.NotFound,
                dates
            );
            await ExpectErrorAsync(
                HttpMethod.Post,
                $"/api/households/{id}/archive",
                outsider,
                HttpStatusCode.NotFound,
                HouseholdService.NotFound
            );
            await ExpectErrorAsync(
                HttpMethod.Post,
                $"/api/households/{id}/invites",
                outsider,
                HttpStatusCode.NotFound,
                HouseholdService.NotFound
            );
            await ExpectErrorAsync(
                HttpMethod.Post,
                $"/api/households/{id}/leave",
                outsider,
                HttpStatusCode.NotFound,
                HouseholdService.NotFound
            );
            await ExpectErrorAsync(
                HttpMethod.Delete,
                $"/api/households/{id}/members/{beaId}",
                outsider,
                HttpStatusCode.NotFound,
                HouseholdService.NotFound
            );
        }
        (await ListIdsAsync(outsider)).ShouldBeEmpty();

        // Members who did not create the household cannot manage it (403 before 400).
        await ExpectErrorAsync(
            HttpMethod.Patch,
            $"/api/households/{home}",
            bea,
            HttpStatusCode.Forbidden,
            HouseholdService.CreatorOnly,
            new { }
        );
        await ExpectErrorAsync(
            HttpMethod.Patch,
            $"/api/households/{trip}/trip",
            bea,
            HttpStatusCode.Forbidden,
            HouseholdService.CreatorOnly,
            dates
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/archive",
            bea,
            HttpStatusCode.Forbidden,
            HouseholdService.CreatorOnly
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/invites",
            bea,
            HttpStatusCode.Forbidden,
            HouseholdService.CreatorOnly
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            $"/api/households/{home}/members/{alexId}",
            bea,
            HttpStatusCode.Forbidden,
            HouseholdService.CreatorOnly
        );

        // The creator gets validation errors, and a trip update needs a trip.
        await ExpectErrorAsync(
            HttpMethod.Patch,
            $"/api/households/{home}",
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            new { name = "" }
        );
        await ExpectErrorAsync(
            HttpMethod.Patch,
            $"/api/households/{home}/trip",
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            new { name = "Trip" }
        );
        await ExpectErrorAsync(
            HttpMethod.Patch,
            $"/api/households/{home}/trip",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.TripNotFound,
            dates
        );

        // A rename is trimmed, visible to members and audited with before/after views.
        var renamed = (
            await ExpectAsync(
                HttpMethod.Patch,
                $"/api/households/{home}",
                alex,
                HttpStatusCode.OK,
                new { name = " Flat " }
            )
        ).GetProperty("household");
        renamed.GetProperty("name").GetString().ShouldBe("Flat");
        renamed.GetProperty("memberCount").GetInt32().ShouldBe(2);
        (await DetailAsync(home, bea))
            .GetProperty("household")
            .GetProperty("name")
            .GetString()
            .ShouldBe("Flat");
        (
            await ScalarAsync(
                $"SELECT before_json->>'name' || '>' || (after_json->>'name') FROM penny.household_audit WHERE household_id = '{home}' AND action = 'household.renamed'"
            )
        ).ShouldBe("Home>Flat");
    }

    [Fact]
    public async Task whenTripDatesChangeOrMembersJoinLate_UpdateTrip_ShouldKeepMembershipIndependentOfTravelRange()
    {
        At(new DateTimeOffset(2026, 12, 14, 12, 0, 0, TimeSpan.Zero));
        var (alex, _) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var trip = (await CreateTripAsync(alex, "2026-11-01", "2026-11-08"))
            .GetProperty("id")
            .GetString()!;
        var path = $"/api/households/{trip}/trip";

        foreach (
            var (start, end) in new[]
            {
                ("2026-11-08", "2026-11-07"),
                ("1999-12-31", "2026-11-08"),
                ("2026-11-01", "2101-01-01"),
                ("2026-11-31", "2026-12-01"),
                ("2026-11-1", "2026-11-08"),
            }
        )
            await ExpectErrorAsync(
                HttpMethod.Patch,
                path,
                alex,
                HttpStatusCode.BadRequest,
                HouseholdService.InvalidData,
                new
                {
                    name = "Coast",
                    startDate = start,
                    endDate = end,
                }
            );

        // A booking made months before the trip, outside its travel range.
        var alexId = (string)
            (await ScalarAsync("SELECT id FROM penny.users WHERE email = 'alex@example.test'"))!;
        await AddExpenseAsync(trip, alexId, 5000, "2026-08-01", (alexId, 5000));

        // Joining after the trip ended is allowed; the join day is the real day, not
        // clamped to the travel range.
        At(new DateTimeOffset(2026, 12, 15, 18, 0, 0, TimeSpan.Zero));
        var joined = await AdmitAsync(trip, alex, bea, offset: 300);
        joined.GetProperty("memberCount").GetInt32().ShouldBe(2);
        (await MemberAsync(trip, alex, beaId))
            .GetProperty("joinedOn")
            .GetString()
            .ShouldBe("2026-12-15");

        // Moving the range never moves expenses or memberships.
        var updated = (
            await ExpectAsync(
                HttpMethod.Patch,
                path,
                alex,
                HttpStatusCode.OK,
                new
                {
                    name = " Coast weekend ",
                    startDate = "2026-11-02",
                    endDate = "2026-11-02",
                }
            )
        ).GetProperty("household");
        updated.GetProperty("name").GetString().ShouldBe("Coast weekend");
        updated.GetProperty("trip").GetProperty("startDate").GetString().ShouldBe("2026-11-02");
        updated.GetProperty("trip").GetProperty("endDate").GetString().ShouldBe("2026-11-02");
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_expenses WHERE household_id = '{trip}' AND expense_date = DATE '2026-08-01'"
            )
        ).ShouldBe(1L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{trip}' AND action = 'trip.edited' AND before_json->'trip'->>'startDate' = '2026-11-01'"
            )
        ).ShouldBe(1L);

        // A personal trip may link to the shared trip with its own dates; leaving the
        // shared trip keeps that private link (it is not date-based membership).
        var ledger = await GetLedgerAsync(bea);
        ledger["ledger"]!["trips"]!
            .AsArray()
            .Add(
                JsonNode(
                    """{"id":"coast","name":"My coast","startDate":"2026-10-30","endDate":"2026-11-10","sharedHouseholdId":"TRIP"}""".Replace(
                        "TRIP",
                        trip,
                        StringComparison.Ordinal
                    )
                )
            );
        using (var saved = await PutLedgerAsync(bea, ledger))
            saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{trip}/leave", bea, HttpStatusCode.OK);
        var after = await GetLedgerAsync(bea);
        after["ledger"]!["trips"]![0]!["sharedHouseholdId"]!.GetValue<string>().ShouldBe(trip);
        (await ListIdsAsync(bea)).ShouldBe([trip]);
    }

    private static System.Text.Json.Nodes.JsonNode JsonNode(string json) =>
        System.Text.Json.Nodes.JsonNode.Parse(json)!;
}
