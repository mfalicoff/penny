using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Domain.Households;
using Penny.Backend.UnitTests.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

// Golden settlement cases shared with the TypeScript domain tests
// (contracts/fixtures/settlement.json), the month-end cutoff and overdue rules.
public sealed class MonthlySettlementTests
{
    public static TheoryData<string> GoldenCases()
    {
        var data = new TheoryData<string>();
        foreach (var item in Fixture()["cases"]!.AsArray())
            data.Add(item!["name"]!.GetValue<string>());
        return data;
    }

    [Theory]
    [MemberData(nameof(GoldenCases))]
    public void whenGoldenCaseSettled_BalancesAndSuggest_ShouldMatchTypeScriptResult(string name)
    {
        var item = Fixture()["cases"]!
            .AsArray()
            .Single(node => node!["name"]!.GetValue<string>() == name)!;
        var month = item["month"]!.GetValue<string>();
        var contributions = new List<BalanceContribution>();
        foreach (var expense in item["expenses"]!.AsArray())
        {
            // Soft-deleted expenses never reach the calculation (the queries skip them).
            if (expense!["deletedAt"] is not null)
                continue;
            contributions.AddRange(
                MonthlySettlement.Expense(
                    expense["date"]!.GetValue<string>()[..7],
                    expense["payerUserId"]!.GetValue<string>(),
                    expense["totalCents"]!.GetValue<long>(),
                    expense["splits"]!
                        .AsArray()
                        .Select(share => new SplitShare(
                            share!["userId"]!.GetValue<string>(),
                            share["amountCents"]!.GetValue<long>()
                        ))
                )
            );
        }
        foreach (var reimbursement in item["reimbursements"]!.AsArray())
            contributions.AddRange(
                MonthlySettlement.Reimbursement(
                    reimbursement!["month"]!.GetValue<string>(),
                    reimbursement["fromUserId"]!.GetValue<string>(),
                    reimbursement["toUserId"]!.GetValue<string>(),
                    reimbursement["amountCents"]!.GetValue<long>()
                )
            );

        var balances = MonthlySettlement.Balances(month, contributions);
        var suggestions = MonthlySettlement.Suggest(balances);

        balances.ShouldBe([
            .. item["expected"]!["balances"]!
                .AsArray()
                .Select(balance => new MemberBalance(
                    balance!["userId"]!.GetValue<string>(),
                    balance["balanceCents"]!.GetValue<long>()
                )),
        ]);
        suggestions.ShouldBe([
            .. item["expected"]!["suggestions"]!
                .AsArray()
                .Select(suggestion => new SuggestedReimbursement(
                    suggestion!["fromUserId"]!.GetValue<string>(),
                    suggestion["toUserId"]!.GetValue<string>(),
                    suggestion["amountCents"]!.GetValue<long>()
                )),
        ]);
        // Every month's balances net to zero, and the suggestions settle them exactly.
        balances.Sum(balance => balance.BalanceCents).ShouldBe(0);
        MonthlySettlement
            .Balances(
                month,
                contributions.Concat(
                    suggestions.SelectMany(suggestion =>
                        MonthlySettlement.Reimbursement(
                            month,
                            suggestion.FromUserId,
                            suggestion.ToUserId,
                            suggestion.AmountCents
                        )
                    )
                )
            )
            .ShouldAllBe(balance => balance.BalanceCents == 0);
    }

    [Fact]
    public void whenBalancesAreInvalid_Suggest_ShouldRejectLikeTypeScript()
    {
        foreach (var item in Fixture()["suggestionErrors"]!.AsArray())
        {
            IReadOnlyList<MemberBalance> balances =
            [
                .. item!["balances"]!
                    .AsArray()
                    .Select(balance => new MemberBalance(
                        balance!["userId"]!.GetValue<string>(),
                        balance["balanceCents"]!.GetValue<long>()
                    )),
            ];
            Should.Throw<ArgumentException>(() => MonthlySettlement.Suggest(balances));
        }
    }

    [Theory]
    [InlineData("2026-09", "2026-09-29", false)]
    [InlineData("2026-09", "2026-09-30", true)]
    [InlineData("2026-09", "2026-10-01", true)]
    [InlineData("2026-02", "2026-02-27", false)]
    [InlineData("2026-02", "2026-02-28", true)]
    [InlineData("2028-02", "2028-02-28", false)]
    [InlineData("2028-02", "2028-02-29", true)]
    [InlineData("2026-12", "2026-12-30", false)]
    [InlineData("2026-12", "2026-12-31", true)]
    [InlineData("2026-10", "2026-09-30", false)]
    public void whenDayIsBeforeOrAfterMonthEnd_CanRecord_ShouldOpenOnTheLastDay(
        string month,
        string today,
        bool expected
    ) => MonthlySettlement.CanRecord(month, DateOnly.Parse(today)).ShouldBe(expected);

    [Fact]
    public void whenInstantIsNearMidnight_MonthOf_ShouldUseUtc()
    {
        // 8:30 p.m. on Sep 30 in Toronto is already October in UTC.
        MonthlySettlement
            .MonthOf(new DateTimeOffset(2026, 9, 30, 20, 30, 0, TimeSpan.FromHours(-4)))
            .ShouldBe("2026-10");
        MonthlySettlement
            .MonthOf(new DateTimeOffset(2026, 9, 30, 23, 59, 59, TimeSpan.Zero))
            .ShouldBe("2026-09");
    }

    [Theory]
    [InlineData("2026-08", "2026-09", true, true)]
    [InlineData("2026-09", "2026-09", true, false)]
    [InlineData("2026-08", "2026-09", false, false)]
    [InlineData("2026-10", "2026-09", true, false)]
    public void whenMonthIsEarlierWithSuggestions_IsOverdue_ShouldBeTrue(
        string month,
        string currentMonth,
        bool hasSuggestions,
        bool expected
    ) => MonthlySettlement.IsOverdue(month, currentMonth, hasSuggestions).ShouldBe(expected);

    [Fact]
    public void whenMonthsAreIndependent_UnsettledMonths_ShouldNotOffsetAcrossMonths()
    {
        // Bea owes alex 30.00 in August and alex owes bea 30.00 in September: both
        // months stay unsettled, ascending. October nets to zero.
        BalanceContribution[] contributions =
        [
            .. MonthlySettlement.Expense(
                "2026-09",
                "bea",
                6000,
                [new("alex", 3000), new("bea", 3000)]
            ),
            .. MonthlySettlement.Expense(
                "2026-08",
                "alex",
                6000,
                [new("alex", 3000), new("bea", 3000)]
            ),
            .. MonthlySettlement.Expense(
                "2026-10",
                "alex",
                6000,
                [new("alex", 3000), new("bea", 3000)]
            ),
            .. MonthlySettlement.Reimbursement("2026-10", "bea", "alex", 3000),
        ];
        MonthlySettlement.UnsettledMonths(contributions).ShouldBe(["2026-08", "2026-09"]);
        MonthlySettlement
            .Balances("2026-10", contributions)
            .ShouldBe([new("alex", 0), new("bea", 0)]);
    }

    [Fact]
    public void whenBodyIsValid_ReadReimbursement_ShouldReadTransfer()
    {
        ExpenseReader
            .ReadReimbursement(
                Parse("""{"fromUserId":"bea","toUserId":"alex","amountCents":3000,"extra":1}""")
            )
            .ShouldBe(new ReimbursementRequest("bea", "alex", 3000));
        ExpenseReader
            .ReadReimbursement(
                Parse("""{"fromUserId":"bea","toUserId":"alex","amountCents":99999999999}""")
            )!
            .AmountCents.ShouldBe(99_999_999_999);
    }

    [Theory]
    [InlineData("""{"toUserId":"alex","amountCents":3000}""")]
    [InlineData("""{"fromUserId":"","toUserId":"alex","amountCents":3000}""")]
    [InlineData("""{"fromUserId":"bea","toUserId":null,"amountCents":3000}""")]
    [InlineData("""{"fromUserId":"bea","toUserId":"alex","amountCents":0}""")]
    [InlineData("""{"fromUserId":"bea","toUserId":"alex","amountCents":-1}""")]
    [InlineData("""{"fromUserId":"bea","toUserId":"alex","amountCents":30.5}""")]
    [InlineData("""{"fromUserId":"bea","toUserId":"alex","amountCents":"3000"}""")]
    [InlineData("""{"fromUserId":"bea","toUserId":"alex","amountCents":100000000000}""")]
    [InlineData("[]")]
    public void whenBodyIsInvalid_ReadReimbursement_ShouldReturnNull(string json) =>
        ExpenseReader.ReadReimbursement(Parse(json)).ShouldBeNull();

    [Fact]
    public void whenBodyIsMissing_ReadReimbursement_ShouldReturnNull() =>
        ExpenseReader.ReadReimbursement(null).ShouldBeNull();

    private static JsonNode Fixture() => ContractFixtures.Read("settlement.json");

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();
}
