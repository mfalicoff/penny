using MimeKit;
using Penny.Backend.Application.Abstractions.InboundMail;
using Penny.Backend.Persistence.InboundMail;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.InboundMail;

// Only the ingress' own ARC-Authentication-Results set is trusted (MAZ-184).
public sealed class MailAuthenticationReaderTests
{
    private const string Ingress = "mx.cloudflare.net";

    private static MailAuthentication Read(params (string Field, string Value)[] headers)
    {
        var list = new HeaderList();
        foreach (var (field, value) in headers)
            list.Add(field, value);
        return MailAuthenticationReader.Read(list, Ingress);
    }

    [Fact]
    public void whenIngressSetPresent_Read_ShouldMapEachMethod() =>
        Read(
                (
                    "ARC-Authentication-Results",
                    "i=1; mx.cloudflare.net; dkim=pass header.d=shop.example header.s=s1; dmarc=pass (p=reject sp=reject) header.from=shop.example; spf=softfail (mx.cloudflare.net: domain of x designates y) smtp.mailfrom=shop.example"
                )
            )
            .ShouldBe(new MailAuthentication("fail", "pass", "pass"));

    [Fact]
    public void whenSenderForgedALowerSet_Read_ShouldTrustOnlyTheHighestInstance() =>
        Read(
                (
                    "ARC-Authentication-Results",
                    "i=2; mx.cloudflare.net; dkim=fail; dmarc=fail; spf=fail"
                ),
                (
                    "ARC-Authentication-Results",
                    "i=1; mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass"
                )
            )
            .ShouldBe(new MailAuthentication("fail", "fail", "fail"));

    [Theory]
    [InlineData("Authentication-Results", "mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass")]
    [InlineData(
        "ARC-Authentication-Results",
        "i=1; mx.google.com; dkim=pass; dmarc=pass; spf=pass"
    )]
    [InlineData("ARC-Authentication-Results", "mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass")]
    public void whenNoIngressSet_Read_ShouldBeUnknown(string field, string value) =>
        Read((field, value)).ShouldBe(MailAuthentication.Missing);

    [Fact]
    public void whenMethodsMissing_Read_ShouldReportThemUnknownAndNotVerified()
    {
        var result = Read(("ARC-Authentication-Results", "i=1; mx.cloudflare.net; spf=none"));
        result.ShouldBe(new MailAuthentication("none", "unknown", "unknown"));
        result.Verified.ShouldBeFalse();
    }

    // The reviewer's case: a forged set numbered above the ingress' own.
    [Theory]
    [InlineData("i=50")]
    [InlineData("i=2")]
    [InlineData("i=999")]
    [InlineData("i=0")]
    public void whenSenderAddsAHigherOrInvalidSet_Read_ShouldNotBeVerified(string forged) =>
        Read(
            (
                "ARC-Authentication-Results",
                "i=1; mx.cloudflare.net; dkim=fail; dmarc=fail; spf=fail"
            ),
            (
                "ARC-Authentication-Results",
                forged + "; mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass"
            )
        )
            .Verified.ShouldBeFalse();

    [Fact]
    public void whenInstancesRepeat_Read_ShouldBeUnknown() =>
        Read(
                (
                    "ARC-Authentication-Results",
                    "i=1; mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass"
                ),
                (
                    "ARC-Authentication-Results",
                    "i=1; mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass"
                )
            )
            .ShouldBe(MailAuthentication.Missing);

    [Fact]
    public void whenIngressSetIsTopmostAndHighest_Read_ShouldTrustItOverLowerForgedSets() =>
        Read(
            (
                "ARC-Authentication-Results",
                "i=3; mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass"
            ),
            ("ARC-Authentication-Results", "i=2; mx.google.com; dkim=fail; dmarc=fail; spf=fail"),
            (
                "ARC-Authentication-Results",
                "i=1; mx.cloudflare.net; dkim=fail; dmarc=fail; spf=fail"
            )
        )
            .Verified.ShouldBeTrue();
}
