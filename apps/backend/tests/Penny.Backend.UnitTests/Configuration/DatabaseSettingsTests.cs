using Npgsql;
using Penny.Backend.Persistence.Configuration;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class DatabaseSettingsTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Host=localhost;Password=never-print-this")]
    [InlineData("UnknownSetting=never-print-this")]
    public void whenSettingsMissingOrInvalid_Create_ShouldFailWithoutExposingCredentials(
        string? configuration
    )
    {
        var error = Should.Throw<InvalidOperationException>(() =>
            DatabaseSettings.Create(configuration)
        );
        error.Message.ShouldNotContain("never-print-this");
        error.Message.ShouldContain("Postgre");
    }

    [Fact]
    public void whenConnectionStringOverridesLimits_CreateDataSource_ShouldEnforceBoundsAndRedaction()
    {
        var settings = DatabaseSettings.Create(
            "Host=localhost;Database=test;Username=test;Password=secret;Maximum Pool Size=1000;Timeout=0;Command Timeout=0;Log Parameters=true;Include Error Detail=true",
            8,
            2,
            3
        );
        using var source = settings.CreateDataSource();
        var actual = new NpgsqlConnectionStringBuilder(source.ConnectionString);
        actual.MaxPoolSize.ShouldBe(8);
        actual.Timeout.ShouldBe(2);
        actual.CommandTimeout.ShouldBe(3);
        actual.LogParameters.ShouldBeFalse();
        actual.IncludeErrorDetail.ShouldBeFalse();
        settings.ToString().ShouldNotContain("secret");
    }
}
