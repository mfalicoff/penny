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
    [InlineData("""{"inboxItemId":"0123abcd","eventId":"ev"}""", true)]
    [InlineData("""{"inboxItemId":"../x","eventId":"ev"}""", false)]
    [InlineData("""{"inboxItemId":"0123abcd","eventId":""}""", false)]
    [InlineData("""{"inboxItemId":"0123abcd"}""", false)]
    [InlineData("""{"inboxItemId":7,"eventId":"ev"}""", false)]
    [InlineData("""{"inboxItemId":"0123abcd","eventId":"ev","subject":"Order"}""", false)]
    [InlineData(
        """{"householdId":"home","month":"2026-09","inboxItemId":"0123abcd","eventId":"ev"}""",
        false
    )]
    [InlineData("""{"inboxItemId":"0123abcd","householdId":"home","eventId":"ev"}""", false)]
    [InlineData("""[]""", false)]
    [InlineData("""not json""", false)]
    public void whenStoredPayloadRead_Parse_ShouldAcceptOnlyTheAllowlistedDeepLink(
        string json,
        bool valid
    ) => (PushPayload.Parse(json) is not null).ShouldBe(valid);

    [Fact]
    public void whenPayloadParsed_Parse_ShouldReturnTheMatchingShape()
    {
        PushPayload
            .Parse("""{"householdId":"home","month":"2026-09","expenseId":"e-1","eventId":"ev"}""")
            .ShouldBe(new HouseholdPushPayload("home", "2026-09", "e-1", "ev"));
        PushPayload
            .Parse("""{"householdId":"home","month":"2026-09","eventId":"ev"}""")
            .ShouldBe(new HouseholdPushPayload("home", "2026-09", null, "ev"));
        PushPayload
            .Parse("""{"eventId":"ev","inboxItemId":"0123abcd"}""")
            .ShouldBe(new ReceiptInboxPushPayload("0123abcd", "ev"));
    }

    [Fact]
    public void whenReceiptPayloadStored_ToJson_ShouldWriteExactlyTheInboxLinkAndRoundTrip()
    {
        var payload = new ReceiptInboxPushPayload("0123abcd", "ev");

        payload.ToJson().ShouldBe("""{"inboxItemId":"0123abcd","eventId":"ev"}""");
        payload.ThreadId.ShouldBe("receipt-inbox");
        PushPayload.Parse(payload.ToJson()).ShouldBe(payload);
        new HouseholdPushPayload("home", "2026-09", null, "ev").ThreadId.ShouldBe("household-home");
    }

    [Fact]
    public void whenEventTypeAndPayloadPaired_Fits_ShouldMatchReceiptsToTheInboxLinkOnly()
    {
        var receipt = new ReceiptInboxPushPayload("0123abcd", "ev");
        var household = new HouseholdPushPayload("home", "2026-09", null, "ev");

        PushContent.Fits("receipt.received", receipt).ShouldBeTrue();
        PushContent.Fits("expense.created", household).ShouldBeTrue();
        PushContent.Fits("receipt.received", household).ShouldBeFalse();
        PushContent.Fits("expense.created", receipt).ShouldBeFalse();
    }

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
        PushContent
            .For("receipt.received")
            .ShouldBe(("New receipt", "An emailed receipt is ready to attach."));
        PushContent.For("expense.deleted").ShouldBeNull();
    }
}
