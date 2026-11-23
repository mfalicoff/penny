using System.Net;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using MimeKit;
using Shouldly;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// HTTP, SMTP and runner helpers for the email suites (MAZ-124). Every call goes to the
// email host; addresses and data are synthetic.
public abstract partial class EmailTestBase(ApiFixture fixture, EmailHost email)
    : HouseholdTestBase(fixture)
{
    protected EmailHost Email { get; } = InitialState(email);

    private static EmailHost InitialState(EmailHost email)
    {
        email.Smtp.Reset();
        email.Factory.Clock.Set(Noon);
        return email;
    }

    protected override WebApplicationFactory<Program> ApiHost => Email.Factory;

    protected FakeSmtpServer Smtp => Email.Smtp;

    protected void MailAt(DateTimeOffset instant) => Email.Factory.Clock.Set(instant);

    // Registers an account as it existed before email verification (MAZ-172): verified, with
    // no verification email waiting, so the suites count only the emails they ask for.
    protected override async Task<string> RegisterAsync(string email, HttpClient? client = null)
    {
        var token = await RegisterUnverifiedAsync(email, client);
        await Fixture.SqlAsync(
            $"""
            DELETE FROM penny.mail_outbox WHERE kind = 'email-verification' AND user_id = (SELECT id FROM penny.users WHERE email = '{email}');
            UPDATE penny.users SET email_verified_at = now() WHERE email = '{email}';
            """,
            Ct
        );
        return token;
    }

    // A fresh sign-up: unverified, with its verification email queued.
    protected Task<string> RegisterUnverifiedAsync(string email, HttpClient? client = null) =>
        base.RegisterAsync(email, client);

    protected async Task<int> DeliverAsync()
    {
        var sent = 0;
        for (var pass = 0; pass < 100; pass++)
        {
            var run = await Email.Runner.RunOnceAsync(Ct);
            run.Failures.ShouldBeEmpty();
            sent += run.Sent;
            if (run.Claimed == 0)
                break;
        }
        return sent;
    }

    protected Task<HttpResponseMessage> RequestResetAsync(string email) =>
        SendAsync(HttpMethod.Post, "/api/auth/password-reset/request", null, new { email });

    protected Task<HttpResponseMessage> RedeemAsync(string token, string password) =>
        SendAsync(HttpMethod.Post, "/api/auth/password-reset", null, new { token, password });

    protected static string Body(MimeMessage message) => message.TextBody ?? "";

    // The code a link in the email carries (`/reset-password#code=` or `/join#code=`).
    protected static string LinkCode(MimeMessage message, string path)
    {
        var match = Regex.Match(
            Body(message),
            Regex.Escape(EmailHost.AppUrl + path + "#code=") + "([0-9A-Fa-f]+)"
        );
        match.Success.ShouldBeTrue(Body(message));
        return match.Groups[1].Value;
    }

    protected Task<long> PendingMailAsync() =>
        CountAsync("SELECT count(*) FROM penny.mail_outbox WHERE finished_at IS NULL");

    protected async Task<System.Text.Json.JsonElement> EmailInviteAsync(
        string householdId,
        string token,
        string address,
        HttpStatusCode status = HttpStatusCode.Accepted
    ) =>
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{householdId}/email-invites",
            token,
            status,
            new { email = address }
        );

    protected async Task<System.Text.Json.JsonElement> EmailInvitesAsync(
        string householdId,
        string token
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Get,
                $"/api/households/{householdId}/email-invites",
                token,
                HttpStatusCode.OK
            )
        ).GetProperty("items");
}
