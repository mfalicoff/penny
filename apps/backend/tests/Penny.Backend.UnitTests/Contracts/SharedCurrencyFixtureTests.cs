using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Contracts;

// MAZ-151 phase 2 golden cases from the TypeScript reference rules
// (apps/web/src/domain/households.ts: memberAmounts, settleIn and
// sharedExpenseCurrencyProblem), checked against SharedCurrency and the real
// ExpenseReader. The `projection` section is the client's join into the personal view
// (`ledgerWithHouseholds`), so it is not checked here. The manifest hash check in
// GoldenFixtureTests covers this file.
public sealed class SharedCurrencyFixtureTests
{
    private static readonly SharedCurrencyFixture Golden = StrictJson.Read<SharedCurrencyFixture>(
        "shared-currency.json"
    );

    [Fact]
    public void whenMemberAmountsRead_MemberAmounts_ShouldConvertLikeTypeScript()
    {
        Golden.MemberAmounts.ShouldNotBeEmpty();
        foreach (var item in Golden.MemberAmounts)
        {
            MemberHomeAmount? Compute() =>
                SharedCurrency.MemberAmounts(
                    item.Expense.TotalCents,
                    item.Expense.OriginalAmount,
                    item.Expense.OriginalCurrency,
                    item.ShareCents,
                    item.HouseholdCurrency,
                    item.Home,
                    item.Rate
                );
            if (item.Error is { } error)
            {
                Should
                    .Throw<ArgumentException>(Compute)
                    .Message.ShouldStartWith(error, customMessage: item.Name);
                continue;
            }
            Compute().ShouldBe(item.Expected, item.Name);
        }
    }

    [Fact]
    public void whenSettleInRead_SettleIn_ShouldConvertLikeTypeScript()
    {
        Golden.SettleIn.ShouldNotBeEmpty();
        foreach (var item in Golden.SettleIn)
        {
            SettledIn Compute() =>
                SharedCurrency.SettleIn(item.Balances, item.From, item.To, item.Rate);
            if (item.Error is { } error)
            {
                Should
                    .Throw<ArgumentException>(Compute)
                    .Message.ShouldStartWith(error, customMessage: item.Name);
                continue;
            }
            var expected = item.Expected.ShouldNotBeNull(item.Name);
            var settled = Compute();
            settled.Balances.ShouldBe(expected.Balances, item.Name);
            settled.Suggestions.ShouldBe(expected.Suggestions, item.Name);
        }
    }

    [Fact]
    public void whenExpensesRead_SharedExpenseCurrencyProblem_ShouldMatchTypeScript()
    {
        Golden.Expenses.ShouldNotBeEmpty();
        Golden.Expenses.ShouldContain(item => item.Problem == null);
        Golden.Expenses.ShouldContain(item => item.Problem != null);
        foreach (var item in Golden.Expenses)
        {
            var fields = item.Expense;
            // The rule itself, with the fields as the client sends them.
            Currencies
                .ForeignAmountProblem(
                    fields.GetProperty("totalCents").GetInt64(),
                    Optional(fields, "originalAmount")?.GetInt64(),
                    Optional(fields, "originalCurrency")?.GetString(),
                    Optional(fields, "rate")?.GetString(),
                    Optional(fields, "rateStatus")?.GetString(),
                    Optional(fields, "rateDate") is { } date
                        ? LedgerDates.TryParse(date.GetString()!, out var day)
                            ? day
                            : throw new FormatException(item.Name)
                        : null,
                    item.HouseholdCurrency
                )
                .ShouldBe(item.Problem, item.Name);
            // The API path: ExpenseReader types the fields (a partial set is already
            // invalid), then SharedCurrency checks them against the household's currency.
            var input = ExpenseReader.ReadInput(Body(fields));
            if (input is null)
            {
                item.Problem.ShouldNotBeNull(item.Name);
                continue;
            }
            SharedCurrency
                .ExpenseProblem(input.TotalCents, input.Foreign, item.HouseholdCurrency)
                .ShouldBe(item.Problem, item.Name);
        }
    }

    private static JsonElement? Optional(JsonElement fields, string name) =>
        fields.TryGetProperty(name, out var value) ? value : null;

    // A whole shared expense body around the fixture's amount fields.
    private static JsonElement Body(JsonElement fields)
    {
        var body = JsonNode.Parse(fields.GetRawText())!.AsObject();
        body["title"] = "Dinner";
        body["date"] = "2026-11-03";
        body["payerUserId"] = "sam";
        body["splitMode"] = "equal";
        body["category"] = new JsonObject
        {
            ["name"] = "Travel",
            ["icon"] = "airplane-outline",
            ["color"] = "#5B7DB1",
        };
        using var document = JsonDocument.Parse(body.ToJsonString());
        return document.RootElement.Clone();
    }
}
