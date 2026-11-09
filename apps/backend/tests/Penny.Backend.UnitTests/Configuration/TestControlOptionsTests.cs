using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.Internal;
using Penny.Backend.Api.Testing;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class TestControlOptionsTests
{
    private const string Token = "0123456789abcdef0123456789abcdef";
    private const string TestDatabase =
        "Host=127.0.0.1;Database=penny_test_r1234;Username=penny_runtime;Password=x";

    private static TestControlOptions Read(
        string environment,
        params (string Key, string Value)[] values
    ) =>
        TestControlOptions.Read(
            new ConfigurationBuilder()
                .AddInMemoryCollection(
                    values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value))
                )
                .Build(),
            new HostingEnvironment { EnvironmentName = environment }
        );

    [Fact]
    public void whenNothingConfigured_Read_ShouldDisableControls()
    {
        Read(Environments.Production).Enabled.ShouldBeFalse();
        Read(Environments.Development).Enabled.ShouldBeFalse();
        Read(Environments.Production, ("TestControls:Enabled", "false")).Enabled.ShouldBeFalse();
    }

    [Fact]
    public void whenEnabledInProduction_Read_ShouldRefuseToStart()
    {
        Should
            .Throw<InvalidOperationException>(() =>
                Read(
                    Environments.Production,
                    ("TestControls:Enabled", "true"),
                    ("TestControls:Token", Token),
                    ("ConnectionStrings:Postgres", TestDatabase)
                )
            )
            .Message.ShouldContain("Production");
    }

    [Theory]
    [InlineData("TRUE")]
    [InlineData("yes")]
    public void whenEnabledValueMisspelled_Read_ShouldFail(string value) =>
        Should.Throw<InvalidOperationException>(() =>
            Read("Testing", ("TestControls:Enabled", value))
        );

    [Fact]
    public void whenTokenShortOrMissing_Read_ShouldFail()
    {
        Should.Throw<InvalidOperationException>(() =>
            Read(
                "Testing",
                ("TestControls:Enabled", "true"),
                ("ConnectionStrings:Postgres", TestDatabase)
            )
        );
        Should.Throw<InvalidOperationException>(() =>
            Read(
                "Testing",
                ("TestControls:Enabled", "true"),
                ("TestControls:Token", "short"),
                ("ConnectionStrings:Postgres", TestDatabase)
            )
        );
    }

    [Theory]
    [InlineData("Host=db;Database=penny;Username=penny_runtime")]
    [InlineData("Host=db;Database=production_penny_test;Username=penny_runtime")]
    [InlineData("Host=db;Username=penny_runtime")]
    [InlineData("not a connection string")]
    public void whenDatabaseIsNotATestDatabase_Read_ShouldFail(string connection) =>
        Should.Throw<InvalidOperationException>(() =>
            Read(
                "Testing",
                ("TestControls:Enabled", "true"),
                ("TestControls:Token", Token),
                ("ConnectionStrings:Postgres", connection)
            )
        );

    [Fact]
    public void whenPrefixWidened_Read_ShouldFail() =>
        Should.Throw<InvalidOperationException>(() =>
            Read(
                "Testing",
                ("TestControls:Enabled", "true"),
                ("TestControls:Token", Token),
                ("TestControls:DatabasePrefix", "penny"),
                ("ConnectionStrings:Postgres", TestDatabase)
            )
        );

    [Fact]
    public void whenTestDatabaseConfigured_Read_ShouldEnableControls()
    {
        var options = Read(
            "Testing",
            ("TestControls:Enabled", "true"),
            ("TestControls:Token", Token),
            ("ConnectionStrings:Postgres", TestDatabase)
        );
        options.Enabled.ShouldBeTrue();
        options.DatabasePrefix.ShouldBe("penny_test");
        options.OidcCertificateHash.ShouldBeNull();
    }
}
