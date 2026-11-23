using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Mail;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Password resets by email (MAZ-124) over real HTTP, PostgreSQL and MailKit SMTP to a
// local fake server.
public sealed class EmailPasswordResetTests(ApiFixture fixture, EmailHost email)
    : EmailTestBase(fixture, email),
        IClassFixture<EmailHost>
{
    private const string Address = "person@example.test";
    private const string NewPassword = "a brand new password";

    [Fact]
    public async Task whenEmailOn_ServerInfo_ShouldReportEmailEnabled()
    {
        var info = await Client.GetFromJsonAsync<JsonElement>("/api/info", Ct);
        info.GetProperty("emailEnabled").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task whenKnownAndUnknownEmailsAsk_PasswordResetRequest_ShouldAnswerIdenticallyAndEmailOnlyTheAccount()
    {
        await RegisterAsync(Address);
        using var known = await RequestResetAsync(" PERSON@example.TEST ");
        using var unknown = await RequestResetAsync("nobody@example.test");
        known.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        unknown.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        (await known.Content.ReadAsStringAsync(Ct)).ShouldBe(
            await unknown.Content.ReadAsStringAsync(Ct)
        );
        known.Headers.CacheControl!.NoStore.ShouldBeTrue();
        // Nothing is sent inside the request; the outbox holds no address or code.
        Smtp.Received.ShouldBeEmpty();
        (await PendingMailAsync()).ShouldBe(1L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.mail_outbox WHERE recipient_hash = '{MailRecipients.Hash(Address)}'"
            )
        ).ShouldBe(1L);

        (await DeliverAsync()).ShouldBe(1);
        Smtp.Received.Count.ShouldBe(1);
        var (recipient, message) = Smtp.To(Address).ShouldHaveSingleItem();
        recipient.ShouldBe(Address);
        message.Subject.ShouldBe("Reset your Penny password");
        message.From.Mailboxes.ShouldHaveSingleItem().Address.ShouldBe("penny@example.test");
        message.HtmlBody.ShouldBeNull();
        var code = LinkCode(message, "/reset-password");
        SessionTokens.IsWellFormed(code).ShouldBeTrue();
        // Only SHA-256(code) is stored.
        (await ScalarAsync("SELECT token_hash FROM penny.password_resets")).ShouldBe(
            SessionTokens.Hash(code)
        );

        using (var redeemed = await RedeemAsync(code, NewPassword))
            redeemed.StatusCode.ShouldBe(HttpStatusCode.OK);
        using (var again = await RedeemAsync(code, "an attacker's password"))
            await AuthTests.ShouldBeErrorAsync(
                again,
                HttpStatusCode.BadRequest,
                PasswordResetService.InvalidToken
            );
        using var login = await Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = Address, password = NewPassword },
            Ct
        );
        login.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenEmailedCodeExpires_PasswordReset_ShouldRejectIt()
    {
        await RegisterAsync(Address);
        (await RequestResetAsync(Address)).Dispose();
        await DeliverAsync();
        var code = LinkCode(Smtp.To(Address).ShouldHaveSingleItem().Message, "/reset-password");
        MailAt(Noon.AddHours(24));
        using var expired = await RedeemAsync(code, NewPassword);
        await AuthTests.ShouldBeErrorAsync(
            expired,
            HttpStatusCode.BadRequest,
            PasswordResetService.InvalidToken
        );
    }

    [Fact]
    public async Task whenRequestedTwiceBeforeSending_PasswordResetRequest_ShouldSendOneEmail()
    {
        await RegisterAsync(Address);
        (await RequestResetAsync(Address)).Dispose();
        (await RequestResetAsync(Address)).Dispose();
        (await DeliverAsync()).ShouldBe(1);
        Smtp.Received.Count.ShouldBe(1);
    }

    [Fact]
    public async Task whenRecipientLimitReached_PasswordResetRequest_ShouldStopEmailingSilently()
    {
        await RegisterAsync(Address);
        for (var request = 0; request < EmailHost.RecipientLimit + 2; request++)
        {
            using var response = await RequestResetAsync(Address);
            response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
            await DeliverAsync();
        }
        Smtp.To(Address).Count.ShouldBe(EmailHost.RecipientLimit);
        // The window is the last 24 hours.
        MailAt(Noon.AddHours(25));
        (await RequestResetAsync(Address)).Dispose();
        await DeliverAsync();
        Smtp.To(Address).Count.ShouldBe(EmailHost.RecipientLimit + 1);
        // Only the latest emailed code works.
        var codes = Smtp.To(Address)
            .Select(item => LinkCode(item.Message, "/reset-password"))
            .ToList();
        using (var stale = await RedeemAsync(codes[0], NewPassword))
            stale.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using (var latest = await RedeemAsync(codes[^1], NewPassword))
            latest.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenServerFailsTemporarily_MailDelivery_ShouldRetryWithBackoffAndThenSend()
    {
        await RegisterAsync(Address);
        Smtp.Refuse(1, "451 4.3.0 Try again later");
        (await RequestResetAsync(Address)).Dispose();
        var first = await Email.Runner.RunOnceAsync(Ct);
        first.Retried.ShouldBe(1);
        first.Reasons.ShouldBe(["smtp:451"]);
        Smtp.Received.ShouldBeEmpty();
        (await ScalarAsync("SELECT attempts FROM penny.mail_outbox")).ShouldBe(1);
        (await ScalarAsync("SELECT last_error FROM penny.mail_outbox")).ShouldBe("smtp:451");
        // Not due again before its backoff.
        (await Email.Runner.RunOnceAsync(Ct)).Claimed.ShouldBe(0);

        Smtp.Down = true;
        MailAt(Noon + MailDeliveryRunner.RetryBase);
        var down = await Email.Runner.RunOnceAsync(Ct);
        down.Retried.ShouldBe(1);
        down.Reasons.ShouldBe(["smtp:connect"]);

        Smtp.Down = false;
        MailAt(Noon.AddMinutes(5));
        (await DeliverAsync()).ShouldBe(1);
        var code = LinkCode(Smtp.To(Address).ShouldHaveSingleItem().Message, "/reset-password");
        using var redeemed = await RedeemAsync(code, NewPassword);
        redeemed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await PendingMailAsync()).ShouldBe(0L);
    }

    [Fact]
    public async Task whenAttemptsRunOut_MailDelivery_ShouldFailForGood()
    {
        await RegisterAsync(Address);
        Smtp.Down = true;
        (await RequestResetAsync(Address)).Dispose();
        var now = Noon;
        for (var attempt = 0; attempt < MailDeliveryRunner.MaxAttempts; attempt++)
        {
            (await Email.Runner.RunOnceAsync(Ct)).Claimed.ShouldBe(1);
            now += MailDeliveryRunner.RetryMax;
            MailAt(now);
        }
        (await Email.Runner.RunOnceAsync(Ct)).Claimed.ShouldBe(0);
        (await PendingMailAsync()).ShouldBe(0L);
        (await ScalarAsync("SELECT last_error FROM penny.mail_outbox")).ShouldBe("smtp:connect");
        (
            await CountAsync("SELECT count(*) FROM penny.mail_outbox WHERE sent_at IS NOT NULL")
        ).ShouldBe(0L);
    }

    [Fact]
    public async Task whenMailIsSent_Logs_ShouldHoldNoAddressesLinksOrCodes()
    {
        await RegisterAsync(Address);
        Smtp.Refuse(1, "451 4.3.0 Mailbox person@example.test busy");
        (await RequestResetAsync(Address)).Dispose();
        await Email.Runner.RunOnceAsync(Ct);
        MailAt(Noon.AddMinutes(5));
        await DeliverAsync();
        var code = LinkCode(Smtp.To(Address).ShouldHaveSingleItem().Message, "/reset-password");
        Email.Logs.Messages.ShouldNotBeEmpty();
        Email.Logs.Messages.ShouldAllBe(message =>
            !message.Contains(Address, StringComparison.OrdinalIgnoreCase)
            && !message.Contains(code, StringComparison.OrdinalIgnoreCase)
            && !message.Contains("#code=", StringComparison.Ordinal)
            && !message.Contains(MailRecipients.Hash(Address), StringComparison.Ordinal)
        );
        // Stored reasons are codes, never the server's text.
        (
            await CountAsync(
                "SELECT count(*) FROM penny.mail_outbox WHERE last_error LIKE '%example%'"
            )
        ).ShouldBe(0L);
    }
}
