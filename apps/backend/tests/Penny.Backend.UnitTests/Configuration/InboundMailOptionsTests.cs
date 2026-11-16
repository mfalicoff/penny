using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

// Emailed receipt settings (MAZ-184): off by default; when on, the domain and a secret
// of at least 32 bytes are required.
public sealed class InboundMailOptionsTests
{
    private const string Secret = "cGVubnktdGVzdC1zZWNyZXQtMzItYnl0ZXMtbG9uZyEh";

    private static Penny.Backend.Application.InboundMail.InboundMailSettings Read(
        params (string Key, string Value)[] values
    ) =>
        InboundMailOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value))
                )
                .Build()
        );

    [Fact]
    public void whenNothingConfigured_Read_ShouldBeDisabledWithDefaults()
    {
        var settings = Read();
        settings.Enabled.ShouldBeFalse();
        settings.WebhookSecret.ShouldBeEmpty();
        settings.MaxMessageBytes.ShouldBe(26214400);
        settings.AddressLifetimeDays.ShouldBe(90);
        settings.InboxRetentionDays.ShouldBe(30);
    }

    [Fact]
    public void whenEnabled_Read_ShouldNormalizeDomainAndUseDefaultLimits()
    {
        var settings = Read(
            ("InboundMail:Enabled", "true"),
            ("InboundMail:Domain", " Receipts.Example.COM "),
            ("InboundMail:WebhookSecret", Secret)
        );
        settings.Enabled.ShouldBeTrue();
        settings.Domain.ShouldBe("receipts.example.com");
        settings.WebhookSecret.Length.ShouldBe(33);
        (settings.HourlyLimit, settings.DailyLimit).ShouldBe((20, 100));
        (settings.MaxPendingPerUser, settings.MaxPendingTotal).ShouldBe((200, 10_000));
        settings.ToString().ShouldNotContain(Secret);
    }

    [Theory]
    [InlineData("", Secret)]
    [InlineData("receipts", Secret)]
    [InlineData("https://receipts.example.com", Secret)]
    [InlineData("receipts.example.com", "")]
    [InlineData("receipts.example.com", "not base64!")]
    [InlineData("receipts.example.com", "c2hvcnQ=")]
    public void whenEnabledWithoutDomainOrSecret_Read_ShouldThrow(string domain, string secret) =>
        Should.Throw<InvalidOperationException>(() =>
            Read(
                ("InboundMail:Enabled", "true"),
                ("InboundMail:Domain", domain),
                ("InboundMail:WebhookSecret", secret)
            )
        );

    [Theory]
    [InlineData("InboundMail:Enabled", "yes")]
    [InlineData("InboundMail:MaxMessageBytes", "1000")]
    [InlineData("InboundMail:AddressLifetimeDays", "0")]
    public void whenValueOutOfRange_Read_ShouldThrow(string key, string value) =>
        Should.Throw<InvalidOperationException>(() => Read((key, value)));
}
