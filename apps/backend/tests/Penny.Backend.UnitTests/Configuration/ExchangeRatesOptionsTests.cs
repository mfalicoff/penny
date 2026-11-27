using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Application.Rates;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class ExchangeRatesOptionsTests
{
    private static ExchangeRatesOptions Read(params (string Key, string Value)[] values) =>
        ExchangeRatesOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value))
                )
                .Build()
        );

    [Fact]
    public void whenNothingConfigured_Read_ShouldFetchFromTheEcbEveryFourHours()
    {
        Read()
            .ShouldBe(
                new ExchangeRatesOptions(
                    new ExchangeRateSettings(
                        true,
                        new Uri("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip"),
                        new Uri("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml")
                    ),
                    true,
                    TimeSpan.FromHours(4)
                )
            );
    }

    [Fact]
    public void whenConfigured_Read_ShouldUseTheValues()
    {
        var options = Read(
            ("ExchangeRates:Enabled", "false"),
            ("ExchangeRates:Worker", "false"),
            ("ExchangeRates:RefreshMinutes", "60"),
            ("ExchangeRates:HistoryUrl", "https://rates.example.test/hist.zip"),
            ("ExchangeRates:RecentUrl", "http://rates.example.test/90d.xml")
        );
        options.Settings.Enabled.ShouldBeFalse();
        options.Worker.ShouldBeFalse();
        options.RefreshInterval.ShouldBe(TimeSpan.FromHours(1));
        options.Settings.HistoryUri.ShouldBe(new Uri("https://rates.example.test/hist.zip"));
        options.Settings.RecentUri.ShouldBe(new Uri("http://rates.example.test/90d.xml"));
    }

    [Theory]
    [InlineData("ExchangeRates:Enabled", "no")]
    [InlineData("ExchangeRates:Worker", "1")]
    [InlineData("ExchangeRates:RefreshMinutes", "14")]
    [InlineData("ExchangeRates:RefreshMinutes", "10081")]
    [InlineData("ExchangeRates:HistoryUrl", "ftp://rates.example.test/hist.zip")]
    [InlineData("ExchangeRates:RecentUrl", "rates.xml")]
    public void whenValueInvalid_Read_ShouldFailWithTheSettingName(string key, string value)
    {
        Should
            .Throw<InvalidOperationException>(() => Read((key, value)))
            .Message.ShouldContain(key.Split(':')[1]);
    }
}
