using Penny.Backend.Application.Households;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Households;

public sealed class AuditRedactionTests
{
    [Fact]
    public void whenSnapshotHasPrivateFields_Redact_ShouldRemoveAccountAndReceiptName()
    {
        var redacted = AuditRedaction.Redact(
            """{"id":"x1","accountId":"acct-private","receiptId":"r1","receipt":{"id":"r1","name":"Pharmacy.pdf","mime":"application/pdf"}}"""
        )!;
        redacted.ShouldNotContain("acct-private");
        redacted.ShouldNotContain("Pharmacy.pdf");
        redacted.ShouldContain("\"receiptId\":\"r1\"");
        redacted.ShouldContain("\"mime\":\"application/pdf\"");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("""{"userId":"bea"}""")]
    [InlineData("[1,2]")]
    [InlineData("null")]
    public void whenSnapshotHasNothingPrivate_Redact_ShouldKeepItUnchanged(string? json) =>
        AuditRedaction.Redact(json).ShouldBe(json);
}
