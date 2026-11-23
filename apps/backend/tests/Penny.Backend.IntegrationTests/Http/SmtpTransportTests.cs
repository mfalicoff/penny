using Penny.Backend.Api.Mail;
using Penny.Backend.Application.Mail;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// The MailKit transport (MAZ-124) against a local SMTP server over real TLS: implicit TLS
// on connect (port 465, as Cloudflare Email Service uses) and STARTTLS (port 587), with
// authentication, an untrusted certificate, and a server that can't upgrade.
public sealed class SmtpTransportTests
{
    private const string User = "api_token";
    private const string Secret = "a-synthetic-api-token";
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static SmtpMailTransport Transport(
        FakeSmtpServer server,
        SmtpSecurity security,
        bool trust = true
    ) =>
        new(
            new SmtpSettings(
                "localhost",
                server.Port,
                security,
                User,
                Secret,
                "penny@example.test",
                "Penny",
                TimeSpan.FromSeconds(5)
            ),
            trust ? (_, certificate, _, _) => server.IsServerCertificate(certificate) : null
        );

    private static OutgoingMail Mail() =>
        new("message-1", "sam@example.test", "Subject", "Synthetic body\n");

    [Theory]
    [InlineData(FakeSmtpTls.Implicit, SmtpSecurity.Tls)]
    [InlineData(FakeSmtpTls.StartTls, SmtpSecurity.StartTls)]
    public async Task whenServerSecured_SmtpTransport_ShouldAuthenticateOverTlsAndSend(
        FakeSmtpTls tls,
        SmtpSecurity security
    )
    {
        await using var server = new FakeSmtpServer(tls);
        var outcome = (
            await Transport(server, security).SendAsync([Mail()], Ct)
        ).ShouldHaveSingleItem();
        outcome.Kind.ShouldBe(MailOutcomeKind.Sent);
        server.Credentials.ShouldHaveSingleItem().ShouldBe((User, Secret));
        var (recipient, message) = server.Received.ShouldHaveSingleItem();
        recipient.ShouldBe("sam@example.test");
        message.From.Mailboxes.ShouldHaveSingleItem().Name.ShouldBe("Penny");
        (message.TextBody ?? "").ShouldContain("Synthetic body");
    }

    [Theory]
    [InlineData(FakeSmtpTls.Implicit, SmtpSecurity.Tls)]
    [InlineData(FakeSmtpTls.StartTls, SmtpSecurity.StartTls)]
    public async Task whenCertificateUntrusted_SmtpTransport_ShouldRetryWithoutSending(
        FakeSmtpTls tls,
        SmtpSecurity security
    )
    {
        await using var server = new FakeSmtpServer(tls);
        var outcome = (
            await Transport(server, security, trust: false).SendAsync([Mail()], Ct)
        ).ShouldHaveSingleItem();
        outcome.ShouldBe(MailOutcome.Retry("smtp:tls"));
        server.Received.ShouldBeEmpty();
        server.Credentials.ShouldBeEmpty();
    }

    [Fact]
    public async Task whenServerCannotStartTls_SmtpTransport_ShouldNeverFallBackToPlainText()
    {
        await using var server = new FakeSmtpServer(FakeSmtpTls.None);
        var outcome = (
            await Transport(server, SmtpSecurity.StartTls).SendAsync([Mail()], Ct)
        ).ShouldHaveSingleItem();
        outcome.Kind.ShouldBe(MailOutcomeKind.Retry);
        server.Received.ShouldBeEmpty();
        server.Credentials.ShouldBeEmpty();
    }

    [Fact]
    public async Task whenImplicitTlsSentToStartTlsPort_SmtpTransport_ShouldRetryWithReason()
    {
        await using var server = new FakeSmtpServer(FakeSmtpTls.StartTls);
        var outcome = (
            await Transport(server, SmtpSecurity.Tls).SendAsync([Mail()], Ct)
        ).ShouldHaveSingleItem();
        outcome.Kind.ShouldBe(MailOutcomeKind.Retry);
        outcome.Reason.ShouldBeOneOf("smtp:tls", "smtp:connect");
        server.Received.ShouldBeEmpty();
    }
}
