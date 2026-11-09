using System.Text.Json.Nodes;
using Penny.Backend.Domain.Households;
using Penny.Backend.UnitTests.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

// Golden split cases shared with the TypeScript domain tests
// (contracts/fixtures/shared-splits.json and parity-cases.json `sharedSplits`).
public sealed class HouseholdSplitsTests
{
    public static TheoryData<string> GoldenCases()
    {
        var data = new TheoryData<string>();
        foreach (var item in ContractFixtures.Read("shared-splits.json")["cases"]!.AsArray())
            data.Add(item!["name"]!.GetValue<string>());
        return data;
    }

    [Theory]
    [MemberData(nameof(GoldenCases))]
    public void whenGoldenCaseCalculated_Calculate_ShouldMatchTypeScriptResult(string name)
    {
        var item = ContractFixtures.Read("shared-splits.json")["cases"]!
            .AsArray()
            .Single(node => node!["name"]!.GetValue<string>() == name)!;
        var calculate = () => Calculate(item["totalCents"]!.GetValue<long>(), item["input"]!);
        if (item["error"] is not null)
            Should.Throw<ArgumentException>(calculate);
        else
            calculate().ShouldBe(Expected(item["expected"]!));
    }

    [Fact]
    public void whenParityCasesCalculated_Calculate_ShouldMatchSharedContract()
    {
        foreach (var item in ContractFixtures.Read("parity-cases.json")["sharedSplits"]!.AsArray())
            Calculate(item!["totalCents"]!.GetValue<long>(), item["input"]!)
                .ShouldBe(Expected(item["expected"]!));
    }

    [Fact]
    public void whenSharesComputed_Calculate_ShouldAlwaysAddUpToTotal()
    {
        long[] totals = [1, 2, 3, 7, 99, 100, 101, 9_999, 10_001, 123_457, 99_999_999_999];
        foreach (var total in totals)
        foreach (var members in new[] { 1, 2, 3, 6, 7, 13 })
        {
            var ids = Enumerable.Range(0, members).Select(index => $"m{index:D2}").ToList();
            HouseholdSplits.Equal(total, ids).Sum(share => share.AmountCents).ShouldBe(total);
            var points = ids.Select(_ => 10_000L / members).ToList();
            points[^1] += 10_000 - points.Sum();
            HouseholdSplits
                .Percent(total, [.. ids.Zip(points)])
                .Sum(share => share.AmountCents)
                .ShouldBe(total);
        }
    }

    private static IReadOnlyList<SplitShare> Calculate(long total, JsonNode input) =>
        input["mode"]!.GetValue<string>() switch
        {
            "equal" => HouseholdSplits.Equal(
                total,
                input["memberIds"]!.AsArray().Select(id => id!.GetValue<string>())
            ),
            "exact" => HouseholdSplits.Exact(
                total,
                [
                    .. input["allocations"]!
                        .AsArray()
                        .Select(item => new SplitShare(
                            item!["userId"]!.GetValue<string>(),
                            item["amountCents"]!.GetValue<long>()
                        )),
                ]
            ),
            _ => HouseholdSplits.Percent(
                total,
                [
                    .. input["allocations"]!
                        .AsArray()
                        .Select(item =>
                            (
                                item!["userId"]!.GetValue<string>(),
                                item["percentBasisPoints"]!.GetValue<long>()
                            )
                        ),
                ]
            ),
        };

    private static List<SplitShare> Expected(JsonNode expected) =>
        [
            .. expected
                .AsArray()
                .Select(item => new SplitShare(
                    item!["userId"]!.GetValue<string>(),
                    item["amountCents"]!.GetValue<long>()
                )),
        ];
}
