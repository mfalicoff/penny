using Penny.Backend.Domain.Households;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

public sealed class MembershipDatesTests
{
    private static readonly DateTimeOffset Evening = new(2026, 10, 5, 1, 30, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(240, "2026-10-04")]
    [InlineData(0, "2026-10-05")]
    [InlineData(-840, "2026-10-05")]
    [InlineData(720, "2026-10-04")]
    [InlineData(90, "2026-10-05")]
    [InlineData(91, "2026-10-04")]
    public void whenOffsetGiven_JoinedOn_ShouldUseLocalCalendarDay(int offset, string expected) =>
        MembershipDates
            .JoinedOn(Evening, offset)!
            .Value.ToString("yyyy-MM-dd", null)
            .ShouldBe(expected);

    [Fact]
    public void whenOffsetMissing_JoinedOn_ShouldBeNull() =>
        MembershipDates.JoinedOn(Evening, null).ShouldBeNull();

    [Fact]
    public void whenInstantHasSubMilliseconds_Truncate_ShouldKeepWholeMilliseconds() =>
        MembershipDates.Truncate(Evening.AddTicks(9_999)).ShouldBe(Evening);
}
