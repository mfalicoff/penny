using System.Net;
using System.Text.Json;
using Penny.Backend.Application.Households;
using Penny.Backend.Domain.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Shared recurring rule writes (MAZ-59) over HTTP with real PostgreSQL:
// contract envelopes, messages and check order, revisions, payer privacy, anchor days and
// pause/resume. All data is synthetic.
public sealed class SharedRecurrenceTests(ApiFixture fixture) : SharedRecurrenceTestBase(fixture)
{
    [Fact]
    public async Task whenMemberManagesRule_RecurringFlow_ShouldListUpdateAndDeleteWithRevisions()
    {
        var (alex, alexId, bea, beaId, home) = await HomeAsync();
        var created = await CreateRuleAsync(
            home,
            alex,
            Rule(9000, alexId, "2027-01-31", extra: Exact((alexId, 6000), (beaId, 3000)))
        );
        var ruleId = Id(created);
        created.GetProperty("householdId").GetString().ShouldBe(home);
        created.GetProperty("splitMode").GetString().ShouldBe("exact");
        created.GetProperty("allocations").GetArrayLength().ShouldBe(2);
        created.GetProperty("nextDate").GetString().ShouldBe("2027-01-31");
        created.GetProperty("anchorDay").GetInt32().ShouldBe(31);
        created.GetProperty("active").GetBoolean().ShouldBeTrue();
        created.GetProperty("revision").GetInt64().ShouldBe(0);

        var listed = (await ListRulesAsync(home, bea)).ShouldHaveSingleItem();
        Id(listed).ShouldBe(ruleId);
        listed.GetProperty("title").GetString().ShouldBe("Rent");

        var edited = Rule(9000, alexId, "2027-01-31", extra: new { title = "Rent and water" });
        var updated = await UpdateRuleAsync(home, ruleId, bea, Edit(edited, 0));
        updated.GetProperty("revision").GetInt64().ShouldBe(1);
        updated.GetProperty("splitMode").GetString().ShouldBe("equal");
        updated.TryGetProperty("allocations", out _).ShouldBeFalse();
        await ExpectErrorAsync(
            HttpMethod.Put,
            RulePath(home, ruleId),
            alex,
            HttpStatusCode.Conflict,
            SharedRecurrenceService.RuleChanged,
            Edit(edited, 0)
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            RulePath(home, ruleId),
            alex,
            HttpStatusCode.Conflict,
            SharedRecurrenceService.RuleChanged,
            new { revision = 0 }
        );
        (
            await ExpectAsync(
                HttpMethod.Delete,
                RulePath(home, ruleId),
                alex,
                HttpStatusCode.OK,
                new { revision = 1 }
            )
        )
            .GetProperty("ok")
            .GetBoolean()
            .ShouldBeTrue();
        (await ListRulesAsync(home, alex)).ShouldBeEmpty();
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_recurring_allocations WHERE recurring_id = '{ruleId}'"
            )
        ).ShouldBe(0);
        foreach (
            var action in new[] { "recurring.created", "recurring.updated", "recurring.deleted" }
        )
            (await AuditCountAsync(home, action)).ShouldBe(1);
        // Rule events notify nobody.
        (await CountAsync("SELECT count(*) FROM penny.push_outbox")).ShouldBe(0);
    }

    [Fact]
    public async Task whenRequestIsInvalid_RecurringFlow_ShouldFollowContractCheckOrder()
    {
        var (alex, alexId, bea, beaId, home) = await HomeAsync();
        var (outsider, outsiderId) = await AccountAsync("outsider@example.test");
        var valid = Rule(9000, alexId, "2027-01-31");
        // Access before the body.
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(home),
            outsider,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            new { title = "" }
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            RulesPath(home),
            outsider,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(home),
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            Rule(9000, alexId, "2027-01-31", "daily")
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(home),
            alex,
            HttpStatusCode.Forbidden,
            SharedExpenseService.PayerOnlyAccount,
            Rule(9000, beaId, "2027-01-31", extra: new { accountId = "visa" })
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(home),
            alex,
            HttpStatusCode.BadRequest,
            SharedExpenseService.AccountNotFound,
            Rule(9000, alexId, "2027-01-31", extra: new { accountId = "visa" })
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(home),
            alex,
            HttpStatusCode.BadRequest,
            SharedExpenseService.ReceiptUnavailable,
            Rule(9000, alexId, "2027-01-31", extra: new { receiptId = "missing" })
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(home),
            alex,
            HttpStatusCode.BadRequest,
            SharedRecurrenceService.PayerNotCurrent,
            Rule(9000, outsiderId, "2027-01-31")
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(home),
            alex,
            HttpStatusCode.BadRequest,
            ExpenseSplit.Total,
            Rule(9000, alexId, "2027-01-31", extra: Exact((alexId, 6000), (beaId, 1000)))
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(home),
            alex,
            HttpStatusCode.BadRequest,
            ExpenseSplit.EveryMember,
            Rule(9000, alexId, "2027-01-31", extra: Percent((alexId, 10000)))
        );
        var ruleId = Id(await CreateRuleAsync(home, alex, valid));
        await ExpectErrorAsync(
            HttpMethod.Put,
            RulePath(home, "missing"),
            alex,
            HttpStatusCode.NotFound,
            SharedRecurrenceService.RuleNotFound,
            Edit(valid, 0)
        );
        await ExpectErrorAsync(
            HttpMethod.Put,
            RulePath(home, ruleId),
            bea,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            valid
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            RulePath(home, ruleId),
            bea,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            new { revision = -1 }
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            RulePath(home, "missing"),
            bea,
            HttpStatusCode.NotFound,
            SharedRecurrenceService.RuleNotFound,
            new { revision = 0 }
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            RulePath(home, ruleId),
            outsider,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            new { revision = 0 }
        );
        (await CountAsync("SELECT count(*) FROM penny.household_recurring")).ShouldBe(1);
    }

    [Fact]
    public async Task whenPayerLinksAccount_RecurringFlow_ShouldShowItOnlyToThePayer()
    {
        var (alex, alexId, bea, _, home) = await HomeAsync();
        await AddAccountAsync(alex, "visa");
        var ruleId = Id(
            await CreateRuleAsync(
                home,
                alex,
                Rule(9000, alexId, "2027-01-31", extra: new { accountId = "visa" })
            )
        );
        (await ListRulesAsync(home, alex))
            .ShouldHaveSingleItem()
            .GetProperty("accountId")
            .GetString()
            .ShouldBe("visa");
        var seenByBea = (await ListRulesAsync(home, bea)).ShouldHaveSingleItem();
        seenByBea.TryGetProperty("accountId", out _).ShouldBeFalse();
        // Another member's edit keeps the payer's account.
        await UpdateRuleAsync(home, ruleId, bea, Edit(Rule(8000, alexId, "2027-01-31"), 0));
        (
            await ScalarAsync(
                $"SELECT account_id FROM penny.household_recurring WHERE id = '{ruleId}'"
            )
        ).ShouldBe("visa");
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND (after_json ? 'accountId' OR before_json ? 'accountId')"
            )
        ).ShouldBe(0);
        // The payer's own edit without an account clears it.
        await UpdateRuleAsync(home, ruleId, alex, Edit(Rule(8000, alexId, "2027-01-31"), 1));
        (
            await ScalarAsync(
                $"SELECT account_id FROM penny.household_recurring WHERE id = '{ruleId}'"
            )
        ).ShouldBe(DBNull.Value);
    }

    [Fact]
    public async Task whenMemberLeaves_ListRules_ShouldReturnNoRulesToFormerMember()
    {
        var (alex, alexId, bea, _, home) = await HomeAsync();
        await CreateRuleAsync(home, alex, Rule(9000, alexId, "2027-01-31"));
        using (var left = await SendAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea))
            left.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ListRulesAsync(home, bea)).ShouldBeEmpty();
        await ExpectErrorAsync(
            HttpMethod.Post,
            RulesPath(home),
            bea,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            Rule(9000, alexId, "2027-01-31")
        );
        (await ListRulesAsync(home, alex)).Count.ShouldBe(1);
    }

    [Fact]
    public async Task whenRuleEditedAfterShortMonth_UpdateRule_ShouldKeepOriginalAnchorDay()
    {
        var (alex, alexId, bea, _, home) = await HomeAsync();
        var body = Rule(9000, alexId, "2027-01-31");
        var ruleId = Id(await CreateRuleAsync(home, alex, body));
        // The runner records Jan 31, moves the rule to Feb 28 and bumps its revision.
        (await RunAtAsync(Utc("2027-02-01"))).ShouldBe(1);
        var advanced = (await ListRulesAsync(home, bea)).ShouldHaveSingleItem();
        advanced.GetProperty("nextDate").GetString().ShouldBe("2027-02-28");
        advanced.GetProperty("anchorDay").GetInt32().ShouldBe(31);
        advanced.GetProperty("revision").GetInt64().ShouldBe(1);
        // A client still holding the pre-run rule cannot rewind it.
        await ExpectErrorAsync(
            HttpMethod.Put,
            RulePath(home, ruleId),
            bea,
            HttpStatusCode.Conflict,
            SharedRecurrenceService.RuleChanged,
            Edit(body, 0)
        );
        var edited = await UpdateRuleAsync(
            home,
            ruleId,
            bea,
            Edit(Rule(9500, alexId, "2027-02-28"), 1)
        );
        edited.GetProperty("anchorDay").GetInt32().ShouldBe(31);
        (await RunAtAsync(Utc("2027-04-01"))).ShouldBe(2);
        (await OccurrencesAsync(ruleId)).ShouldBe(["2027-01-31", "2027-02-28", "2027-03-31"]);
        (await NextDateAsync(ruleId)).ShouldBe("2027-04-30");
        // Choosing a new date re-anchors the rule on that day.
        var moved = await UpdateRuleAsync(
            home,
            ruleId,
            alex,
            Edit(Rule(9500, alexId, "2027-05-15"), 4)
        );
        moved.GetProperty("anchorDay").GetInt32().ShouldBe(15);
    }

    [Fact]
    public async Task whenPausedRuleResumed_UpdateRule_ShouldSkipPausedOccurrencesAndKeepAnchor()
    {
        var (alex, alexId, _, _, home) = await HomeAsync();
        At(Utc("2027-01-01"));
        var body = Rule(9000, alexId, "2027-01-31");
        var ruleId = Id(await CreateRuleAsync(home, alex, body));
        var paused = await UpdateRuleAsync(home, ruleId, alex, Edit(body, 0, active: false));
        paused.GetProperty("active").GetBoolean().ShouldBeFalse();
        (await RunAtAsync(Utc("2027-05-15"))).ShouldBe(0);
        (await NextDateAsync(ruleId)).ShouldBe("2027-01-31");
        // Resuming with the unchanged date continues from the next anchored date.
        var resumed = await UpdateRuleAsync(home, ruleId, alex, Edit(body, 1));
        resumed.GetProperty("nextDate").GetString().ShouldBe("2027-05-31");
        resumed.GetProperty("anchorDay").GetInt32().ShouldBe(31);
        (await RunAtAsync(Utc("2027-07-01"))).ShouldBe(2);
        (await OccurrencesAsync(ruleId)).ShouldBe(["2027-05-31", "2027-06-30"]);
    }
}
