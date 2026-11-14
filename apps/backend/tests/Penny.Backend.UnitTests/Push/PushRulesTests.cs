using Penny.Backend.Application.Push;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Push;

public sealed class PushRulesTests
{
    [Fact]
    public void whenAttemptsGrow_RetryAt_ShouldDoubleFromFiveSecondsToOneHour()
    {
        var now = PushSamples.Now;
        PushDeliveryRunner.RetryAt(now, 1, null).ShouldBe(now.AddSeconds(5));
        PushDeliveryRunner.RetryAt(now, 4, null).ShouldBe(now.AddSeconds(40));
        PushDeliveryRunner.RetryAt(now, 50, null).ShouldBe(now.AddHours(1));
        PushDeliveryRunner.RetryAt(now, 1, TimeSpan.FromMinutes(2)).ShouldBe(now.AddMinutes(2));
        PushDeliveryRunner.RetryAt(now, 1, TimeSpan.FromHours(5)).ShouldBe(now.AddHours(1));
    }

    [Theory]
    [InlineData(
        """{"householdId":"home","month":"2026-09","expenseId":"e-1","eventId":"ev"}""",
        true
    )]
    [InlineData("""{"householdId":"home","month":"2026-09","eventId":"ev"}""", true)]
    [InlineData("""{"householdId":"../x","month":"2026-09","eventId":"ev"}""", false)]
    [InlineData("""{"householdId":"home","month":"2026-13","eventId":"ev"}""", false)]
    [InlineData("""{"householdId":"home","month":"2026-09","expenseId":7,"eventId":"ev"}""", false)]
    [InlineData("""{"householdId":"home","month":"2026-09","eventId":""}""", false)]
    [InlineData("""[]""", false)]
    [InlineData("""not json""", false)]
    public void whenStoredPayloadRead_Parse_ShouldAcceptOnlyTheAllowlistedDeepLink(
        string json,
        bool valid
    ) => (PushPayload.Parse(json) is not null).ShouldBe(valid);

    [Fact]
    public void whenEventTypeKnown_For_ShouldReturnTextWithoutFinancialDetails()
    {
        PushContent
            .For("expense.created")
            .ShouldBe(
                (
                    "New household expense",
                    "A member added an expense. Open Penny to see your share."
                )
            );
        PushContent.For("expense.updated")!.Value.Title.ShouldBe("Household expense updated");
        PushContent.For("reimbursement.created")!.Value.Title.ShouldBe("Reimbursement recorded");
        PushContent.For("expense.deleted").ShouldBeNull();
    }
}
