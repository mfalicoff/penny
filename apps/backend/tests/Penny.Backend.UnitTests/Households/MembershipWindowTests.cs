using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;
using Penny.Backend.UnitTests.Ledgers;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

public sealed class MembershipWindowTests
{
    [Fact]
    public void whenMembersJoinAndLeave_ActiveOn_ShouldUseInclusiveJoinAndExclusiveLeave()
    {
        MembershipWindow[] members =
        [
            new("alex", Day("2026-01-01"), null),
            new("blair", Day("2026-01-01"), Day("2026-03-01")),
            new("casey", Day("2026-02-01"), null),
            // A former member who rejoined appears once.
            new("blair", Day("2026-03-10"), null),
        ];
        MembershipWindow.ActiveOn(members, Day("2026-01-31")).ShouldBe(["alex", "blair"]);
        MembershipWindow.ActiveOn(members, Day("2026-02-01")).ShouldBe(["alex", "blair", "casey"]);
        MembershipWindow.ActiveOn(members, Day("2026-03-01")).ShouldBe(["alex", "casey"]);
        MembershipWindow.ActiveOn(members, Day("2026-03-10")).ShouldBe(["alex", "blair", "casey"]);
    }

    [Fact]
    public void whenPeriodHasNoLocalJoinDay_From_ShouldShiftJoinInstantByCallerOffset()
    {
        // 01:30 UTC on Oct 5 is 9:30 p.m. on Oct 4 in Toronto (offset 240).
        var joined = new DateTimeOffset(2026, 10, 5, 1, 30, 0, TimeSpan.Zero);
        MembershipWindow.From("bea", joined, null, null, 240).JoinedOn.ShouldBe(Day("2026-10-04"));
        MembershipWindow.From("bea", joined, null, null, 0).JoinedOn.ShouldBe(Day("2026-10-05"));
        // A recorded local day wins; the departure day is the UTC day of leaving.
        var window = MembershipWindow.From(
            "bea",
            joined,
            Day("2026-10-04"),
            new DateTimeOffset(2026, 10, 9, 23, 0, 0, TimeSpan.Zero),
            -600
        );
        window.JoinedOn.ShouldBe(Day("2026-10-04"));
        window.LeftOn.ShouldBe(Day("2026-10-09"));
    }

    [Fact]
    public void whenParityDatesAdvanced_Next_ShouldMatchSharedContract()
    {
        foreach (var item in ContractFixtures.Read("parity-cases.json")["dates"]!.AsArray())
            RecurringDates
                .Next(
                    Day(item!["date"]!.GetValue<string>()),
                    item["frequency"]!.GetValue<string>(),
                    item["anchorDay"]!.GetValue<int>()
                )
                .ShouldBe(Day(item["next"]!.GetValue<string>()));
    }

    [Theory]
    [InlineData("2027-01-31", "monthly", 31, "2027-02-28")]
    [InlineData("2027-02-28", "monthly", 31, "2027-03-31")]
    [InlineData("2028-02-29", "yearly", 29, "2029-02-28")]
    [InlineData("2031-02-28", "yearly", 29, "2032-02-29")]
    [InlineData("2026-12-28", "weekly", 28, "2027-01-04")]
    public void whenAnchoredRuleAdvances_Next_ShouldClampToMonthLength(
        string date,
        string frequency,
        int anchor,
        string next
    ) => RecurringDates.Next(Day(date), frequency, anchor).ShouldBe(Day(next));

    private static DateOnly Day(string value) =>
        LedgerDates.TryParse(value, out var date) ? date : throw new FormatException(value);
}
