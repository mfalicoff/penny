using Microsoft.Extensions.Configuration;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Mail;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class EmailOptionsTests
{
    private const string Secret = "a-smtp-password-value";

    private static readonly (string, string)[] Valid =
    [
        ("Email:Smtp:Host", "smtp.example.test"),
        ("Email:From", "penny@example.test"),
        ("Email:AppUrl", "http://localhost:4173"),
    ];

    private static EmailOptions Read(params (string Key, string Value)[] values)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(
                values.Select(pair => new KeyValuePair<string, string?>(pair.Key, pair.Value))
            )
            .Build();
        return EmailOptions.Read(configuration, AuthOptions.Read(configuration));
    }

    private static (string, string)[] With(params (string, string)[] extra) =>
        [.. Valid.Where(pair => extra.All(other => other.Item1 != pair.Item1)), .. extra];

    [Fact]
    public void whenNothingConfigured_Read_ShouldLeaveEmailOff()
    {
        var options = Read();
        options.Policy.Enabled.ShouldBeFalse();
        options.Smtp.ShouldBeNull();
    }

    [Fact]
    public void whenServerConfigured_Read_ShouldDefaultToStartTlsOnSubmissionPort()
    {
        var options = Read(Valid);
        options.Policy.Enabled.ShouldBeTrue();
        options.Policy.AppUrl.ShouldBe("http://localhost:4173");
        options.Policy.InviteLifetime.ShouldBe(TimeSpan.FromHours(72));
        options.Smtp!.Security.ShouldBe(SmtpSecurity.StartTls);
        options.Smtp.Port.ShouldBe(587);
        options.Smtp.FromName.ShouldBe("Penny");
        options.Smtp.Username.ShouldBeNull();
    }

    [Fact]
    public void whenImplicitTlsChosen_Read_ShouldUsePort465()
    {
        var options = Read(With(("Email:Smtp:Security", "tls")));
        options.Smtp!.Security.ShouldBe(SmtpSecurity.Tls);
        options.Smtp.Port.ShouldBe(465);
    }

    [Theory]
    [InlineData("Email:Smtp:Security", "ssl", "Email__Smtp__Security")]
    [InlineData("Email:Smtp:Security", "none", "loopback")]
    [InlineData("Email:From", "not an address", "Email__From")]
    [InlineData("Email:AppUrl", "https://elsewhere.example.test", "Auth__AllowedOrigins")]
    [InlineData("Email:Smtp:Port", "0", "Email:Smtp:Port")]
    [InlineData("Email:InviteHours", "0", "Email:InviteHours")]
    [InlineData("Email:Smtp:Username", "penny", "Email__Smtp__Password")]
    public void whenSettingInvalid_Read_ShouldNameIt(string key, string value, string named) =>
        Should
            .Throw<InvalidOperationException>(() => Read(With((key, value))))
            .Message.ShouldContain(named);

    [Fact]
    public void whenPlainTextToLoopback_Read_ShouldAllowIt() =>
        Read(With(("Email:Smtp:Host", "127.0.0.1"), ("Email:Smtp:Security", "none")))
            .Smtp!.Port.ShouldBe(25);

    [Fact]
    public void whenSettingsWithoutHost_Read_ShouldFailInsteadOfIgnoringThem() =>
        Should
            .Throw<InvalidOperationException>(() => Read(("Email:From", "penny@example.test")))
            .Message.ShouldContain("Email__Smtp__Host");

    [Fact]
    public void whenCredentialsConfigured_Read_ShouldNeverEchoThePassword()
    {
        var options = Read(With(("Email:Smtp:Username", "penny"), ("Email:Smtp:Password", Secret)));
        options.Smtp!.Password.ShouldBe(Secret);
        options.Smtp.ToString().ShouldNotContain(Secret);
        var error = Should.Throw<InvalidOperationException>(() =>
            Read(With(("Email:Smtp:Password", Secret), ("Email:Smtp:Security", "bogus")))
        );
        error.Message.ShouldNotContain(Secret);
    }
}
