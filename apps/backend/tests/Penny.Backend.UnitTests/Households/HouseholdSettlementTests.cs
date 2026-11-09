using Penny.Backend.Domain.Households;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

public sealed class HouseholdSettlementTests
{
    [Fact]
    public void whenMonthsOffsetEachOther_IsSettled_ShouldStillRequireEveryMonth()
    {
        BalanceContribution[] contributions =
        [
            new("2026-09", "alex", 9000),
            new("2026-09", "alex", -4500),
            new("2026-09", "bea", -4500),
            new("2026-10", "bea", 4500),
            new("2026-10", "alex", -4500),
        ];
        HouseholdSettlement.IsSettled(contributions, "bea").ShouldBeFalse();
        HouseholdSettlement.IsSettled(contributions, "cam").ShouldBeTrue();
        HouseholdSettlement.IsSettled(contributions).ShouldBeFalse();

        BalanceContribution[] repaid =
        [
            .. contributions,
            new("2026-09", "bea", 4500),
            new("2026-09", "alex", -4500),
        ];
        HouseholdSettlement.IsSettled(repaid, "alex").ShouldBeFalse();
        HouseholdSettlement
            .IsSettled([.. repaid, new("2026-10", "alex", 4500), new("2026-10", "bea", -4500)])
            .ShouldBeTrue();
    }

    [Fact]
    public void whenNoActivity_IsSettled_ShouldBeTrue()
    {
        HouseholdSettlement.IsSettled([]).ShouldBeTrue();
        HouseholdSettlement.IsSettled([], "alex").ShouldBeTrue();
    }

    [Fact]
    public void whenUserIdsDifferOnlyInCase_IsSettled_ShouldCompareOrdinally() =>
        HouseholdSettlement
            .IsSettled([new("2026-09", "Alex", 1), new("2026-09", "alex", -1)], "alex")
            .ShouldBeFalse();
}
