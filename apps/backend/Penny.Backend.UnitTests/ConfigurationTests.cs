using Npgsql;
using Penny.Backend.Persistence;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests;

public sealed class ConfigurationTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Host=localhost;Password=never-print-this")]
    [InlineData("UnknownSetting=never-print-this")]
    public void Missing_or_invalid_database_settings_fail_without_credentials(string? configuration)
    {
        var error = Should.Throw<InvalidOperationException>(() =>
            DatabaseSettings.Create(configuration)
        );
        error.Message.ShouldNotContain("never-print-this");
        error.Message.ShouldContain("Postgre");
    }

    [Fact]
    public void Pool_timeouts_and_sensitive_logging_are_bounded_even_when_connection_string_overrides_them()
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

    [Fact]
    public void Domain_and_application_have_no_framework_or_persistence_dependency()
    {
        var domain = typeof(Penny.Backend.Domain.BackendFailure).Assembly.GetReferencedAssemblies();
        domain.ShouldNotContain(reference =>
            reference.Name!.StartsWith("Microsoft.AspNetCore", StringComparison.Ordinal)
            || reference.Name.StartsWith("Npgsql", StringComparison.Ordinal)
            || reference.Name.StartsWith("Penny.Backend.", StringComparison.Ordinal)
        );
        var application =
            typeof(Penny.Backend.Application.IStorageReadiness).Assembly.GetReferencedAssemblies();
        application.ShouldNotContain(reference =>
            reference.Name!.Contains("Persistence", StringComparison.Ordinal)
            || reference.Name.Contains("Api", StringComparison.Ordinal)
            || reference.Name.StartsWith("Npgsql", StringComparison.Ordinal)
        );
    }
}
