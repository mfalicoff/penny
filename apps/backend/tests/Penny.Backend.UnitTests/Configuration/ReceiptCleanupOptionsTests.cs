using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class ReceiptCleanupOptionsTests
{
    private static ReceiptCleanupOptions Read(params (string Key, string Value)[] values) =>
        ReceiptCleanupOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value))
                )
                .Build()
        );

    [Fact]
    public void whenNothingConfigured_Read_ShouldRunTheWorkerWithThirtyDays()
    {
        Read().ShouldBe(new ReceiptCleanupOptions(true, TimeSpan.FromDays(30)));
    }

    [Fact]
    public void whenConfigured_Read_ShouldUseTheValues()
    {
        Read(("Receipts:CleanupWorker", "false"), ("Receipts:UnlinkedRetentionDays", "90"))
            .ShouldBe(new ReceiptCleanupOptions(false, TimeSpan.FromDays(90)));
    }

    [Theory]
    [InlineData("Receipts:CleanupWorker", "yes")]
    [InlineData("Receipts:UnlinkedRetentionDays", "0")]
    [InlineData("Receipts:UnlinkedRetentionDays", "3651")]
    public void whenValueInvalid_Read_ShouldFailWithTheSettingName(string key, string value)
    {
        Should
            .Throw<InvalidOperationException>(() => Read((key, value)))
            .Message.ShouldContain(key.Split(':')[1]);
    }
}
