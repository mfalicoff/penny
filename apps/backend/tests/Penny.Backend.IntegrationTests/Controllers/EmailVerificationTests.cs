using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Mail;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Email verification (MAZ-172) over real HTTP, PostgreSQL and MailKit SMTP to a local fake
// server. Verification only records that the address is proven; nothing waits for it.
public sealed class EmailVerificationTests(ApiFixture fixture, EmailHost email)
    : EmailTestBase(fixture, email),
        IClassFixture<EmailHost>
{
    private const string Address = "person@example.test";
    private const string NewAddress = "renamed@example.test";

    [Fact]
    public async Task whenPasswordAccountRegisters_EmailVerification_ShouldEmailALinkThatVerifiesOnce()
    {
        var token = await RegisterUnverifiedAsync(Address);
        var before = await ProfileAsync(token);
        before.GetProperty("emailVerified").GetBoolean().ShouldBeFalse();
        before.TryGetProperty("emailVerifiedAt", out _).ShouldBeFalse();
        // Nothing is sent inside the request; the outbox holds no address or code.
        Smtp.Received.ShouldBeEmpty();
        (await PendingMailAsync()).ShouldBe(1L);

        (await DeliverAsync()).ShouldBe(1);
        var (_, message) = Smtp.To(Address).ShouldHaveSingleItem();
        message.Subject.ShouldBe("Verify your email for Penny");
        message.HtmlBody.ShouldBeNull();
        var code = LinkCode(message, "/verify-email");
        SessionTokens.IsWellFormed(code).ShouldBeTrue();
        // Only SHA-256(code) is stored, with the address it was sent to.
        (await ScalarAsync("SELECT token_hash FROM penny.email_verifications")).ShouldBe(
            SessionTokens.Hash(code)
        );

        MailAt(Noon.AddMinutes(3));
        // Anonymous: the link may be opened on another device.
        using (var verified = await VerifyAsync(code))
        {
            verified.StatusCode.ShouldBe(HttpStatusCode.OK);
            verified.Headers.CacheControl!.NoStore.ShouldBeTrue();
            (await verified.Content.ReadAsStringAsync(Ct)).ShouldBe(
                $$"""{"email":"{{Address}}"}"""
            );
        }
        var after = await ProfileAsync(token);
        after.GetProperty("emailVerified").GetBoolean().ShouldBeTrue();
        after.GetProperty("emailVerifiedAt").GetInt64().ShouldBe(Millis(Noon.AddMinutes(3)));

        // Single use.
        using var replay = await VerifyAsync(code);
        await AuthTests.ShouldBeErrorAsync(
            replay,
            HttpStatusCode.BadRequest,
            EmailVerificationService.InvalidToken
        );
        (await CountAsync("SELECT count(*) FROM penny.email_verifications")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenCodeExpires_EmailVerification_ShouldRejectAndPurgeIt()
    {
        var token = await RegisterUnverifiedAsync(Address);
        await DeliverAsync();
        var code = LinkCode(Smtp.To(Address).ShouldHaveSingleItem().Message, "/verify-email");
        MailAt(Noon + EmailVerificationService.Lifetime);
        using var expired = await VerifyAsync(code);
        await AuthTests.ShouldBeErrorAsync(
            expired,
            HttpStatusCode.BadRequest,
            EmailVerificationService.InvalidToken
        );
        (await CountAsync("SELECT count(*) FROM penny.email_verifications")).ShouldBe(0L);
        (await ProfileAsync(token)).GetProperty("emailVerified").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task whenCodeMalformedOrUnknown_EmailVerification_ShouldGiveOneError()
    {
        await RegisterUnverifiedAsync(Address);
        await DeliverAsync();
        foreach (var bad in new[] { "", "short", new string('a', 64), new string('G', 64) })
        {
            using var response = await VerifyAsync(bad);
            await AuthTests.ShouldBeErrorAsync(
                response,
                HttpStatusCode.BadRequest,
                EmailVerificationService.InvalidToken
            );
        }
        using var missing = await SendAsync(
            HttpMethod.Post,
            "/api/auth/email-verification",
            null,
            new { }
        );
        await AuthTests.ShouldBeErrorAsync(
            missing,
            HttpStatusCode.BadRequest,
            EmailVerificationService.InvalidToken
        );
        // The real code is untouched.
        (await CountAsync("SELECT count(*) FROM penny.email_verifications")).ShouldBe(1L);
    }

    [Fact]
    public async Task whenRedeemedConcurrently_EmailVerification_ShouldSucceedOnce()
    {
        await RegisterUnverifiedAsync(Address);
        await DeliverAsync();
        var code = LinkCode(Smtp.To(Address).ShouldHaveSingleItem().Message, "/verify-email");
        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => VerifyAsync(code)));
        responses.Count(response => response.StatusCode == HttpStatusCode.OK).ShouldBe(1);
        responses.Count(response => response.StatusCode == HttpStatusCode.BadRequest).ShouldBe(5);
        foreach (var response in responses)
            response.Dispose();
    }

    [Fact]
    public async Task whenResent_EmailVerification_ShouldWaitAMinuteKeepLimitsAndOnlyHonourTheLatestCode()
    {
        var token = await RegisterUnverifiedAsync(Address);
        // Before the first email is sent, and within a minute of it, a resend queues nothing.
        using (var early = await ResendAsync(token))
        {
            early.StatusCode.ShouldBe(HttpStatusCode.Accepted);
            (await early.Content.ReadAsStringAsync(Ct)).ShouldBe("""{"ok":true}""");
        }
        await DeliverAsync();
        MailAt(Noon.AddSeconds(59));
        (await ResendAsync(token)).Dispose();
        (await DeliverAsync()).ShouldBe(0);
        Smtp.To(Address).Count.ShouldBe(1);

        // After a minute each resend sends, until the recipient's daily limit.
        for (var minute = 1; minute <= EmailHost.RecipientLimit + 1; minute++)
        {
            MailAt(Noon.AddMinutes(minute).AddSeconds(1));
            using var resent = await ResendAsync(token);
            resent.StatusCode.ShouldBe(HttpStatusCode.Accepted);
            await DeliverAsync();
        }
        Smtp.To(Address).Count.ShouldBe(EmailHost.RecipientLimit);

        var codes = Smtp.To(Address)
            .Select(item => LinkCode(item.Message, "/verify-email"))
            .ToList();
        using (var stale = await VerifyAsync(codes[0]))
            stale.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using (var latest = await VerifyAsync(codes[^1]))
            latest.StatusCode.ShouldBe(HttpStatusCode.OK);

        // A verified account gets no more emails.
        MailAt(Noon.AddHours(25));
        (await ResendAsync(token)).Dispose();
        (await DeliverAsync()).ShouldBe(0);
        (await PendingMailAsync()).ShouldBe(0L);
    }

    [Fact]
    public async Task whenSignedOut_EmailVerificationResend_ShouldRequireSignIn()
    {
        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/auth/email-verification/resend",
            null
        );
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task whenVerifiedBeforeSending_MailDelivery_ShouldDropTheEmail()
    {
        await RegisterUnverifiedAsync(Address);
        await Fixture.SqlAsync("UPDATE penny.users SET email_verified_at = now()", Ct);
        var run = await Email.Runner.RunOnceAsync(Ct);
        run.Claimed.ShouldBe(1);
        run.Dropped.ShouldBe(1);
        Smtp.Received.ShouldBeEmpty();
        (await CountAsync("SELECT count(*) FROM penny.email_verifications")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenEmailChanged_EmailVerification_ShouldResetAndRejectTheEarlierAddressCode()
    {
        var token = await RegisterAsync(Address);
        (await ProfileAsync(token)).GetProperty("emailVerified").GetBoolean().ShouldBeTrue();

        using (var changed = await ChangeEmailAsync(token, " Renamed@Example.TEST ", TestPassword))
        {
            changed.StatusCode.ShouldBe(HttpStatusCode.OK);
            var profile = await changed.Content.ReadFromJsonAsync<JsonElement>(Ct);
            profile.GetProperty("email").GetString().ShouldBe(NewAddress);
            profile.GetProperty("emailVerified").GetBoolean().ShouldBeFalse();
        }
        // The session stays, and sign-in uses the new address.
        (await ProfileAsync(token)).GetProperty("email").GetString().ShouldBe(NewAddress);
        await DeliverAsync();
        var first = LinkCode(Smtp.To(NewAddress).ShouldHaveSingleItem().Message, "/verify-email");
        Smtp.To(Address).ShouldBeEmpty();

        // A code sent before an email change never verifies the next address.
        MailAt(Noon.AddMinutes(2));
        using (var back = await ChangeEmailAsync(token, Address, TestPassword))
            back.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await CountAsync("SELECT count(*) FROM penny.email_verifications")).ShouldBe(0L);
        using (var stale = await VerifyAsync(first))
            await AuthTests.ShouldBeErrorAsync(
                stale,
                HttpStatusCode.BadRequest,
                EmailVerificationService.InvalidToken
            );
        await DeliverAsync();
        var current = LinkCode(Smtp.To(Address).ShouldHaveSingleItem().Message, "/verify-email");
        using (var verified = await VerifyAsync(current))
            verified.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ProfileAsync(token)).GetProperty("emailVerified").GetBoolean().ShouldBeTrue();

        // The same address changes nothing.
        using (var same = await ChangeEmailAsync(token, Address, TestPassword))
            (await same.Content.ReadFromJsonAsync<JsonElement>(Ct))
                .GetProperty("emailVerified")
                .GetBoolean()
                .ShouldBeTrue();
    }

    [Fact]
    public async Task whenEmailChangedRightAfterSignUp_EmailVerification_ShouldEmailTheNewAddressAtOnce()
    {
        var token = await RegisterUnverifiedAsync(Address);
        await DeliverAsync();
        // Within the resend minute: the minute limits Resend only, never a new address.
        MailAt(Noon.AddSeconds(10));
        using (var changed = await ChangeEmailAsync(token, NewAddress, TestPassword))
            changed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await DeliverAsync()).ShouldBe(1);
        var code = LinkCode(Smtp.To(NewAddress).ShouldHaveSingleItem().Message, "/verify-email");
        using (var verified = await VerifyAsync(code))
            (await verified.Content.ReadFromJsonAsync<JsonElement>(Ct))
                .GetProperty("email")
                .GetString()
                .ShouldBe(NewAddress);
    }

    [Fact]
    public async Task whenEmailChangedBeforeTheFirstEmailIsSent_EmailVerification_ShouldSendOnceToTheNewAddress()
    {
        var token = await RegisterUnverifiedAsync(Address);
        using (var changed = await ChangeEmailAsync(token, NewAddress, TestPassword))
            changed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await DeliverAsync()).ShouldBe(1);
        Smtp.To(Address).ShouldBeEmpty();
        Smtp.To(NewAddress).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task whenEmailChangeInvalid_EmailChange_ShouldRefuseAndChangeNothing()
    {
        var token = await RegisterAsync(Address);
        await RegisterAsync("taken@example.test");
        using (var wrong = await ChangeEmailAsync(token, NewAddress, "not the password"))
            await AuthTests.ShouldBeErrorAsync(
                wrong,
                HttpStatusCode.BadRequest,
                AuthService.WrongCurrentPassword
            );
        using (var invalid = await ChangeEmailAsync(token, "not-an-email", TestPassword))
            await AuthTests.ShouldBeErrorAsync(
                invalid,
                HttpStatusCode.BadRequest,
                PasswordResetService.InvalidEmail
            );
        using (var taken = await ChangeEmailAsync(token, "taken@example.test", TestPassword))
            await AuthTests.ShouldBeErrorAsync(
                taken,
                HttpStatusCode.Conflict,
                AuthService.EmailInUse
            );
        using (var signedOut = await ChangeEmailAsync(null, NewAddress, TestPassword))
            signedOut.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        // A provider account has no password: its provider manages the email.
        await Fixture.SqlAsync(
            $"UPDATE penny.users SET password = '' WHERE email = '{Address}'",
            Ct
        );
        using (var managed = await ChangeEmailAsync(token, NewAddress, ""))
            await AuthTests.ShouldBeErrorAsync(
                managed,
                HttpStatusCode.Forbidden,
                AuthService.EmailManaged
            );
        (await ProfileAsync(token)).GetProperty("email").GetString().ShouldBe(Address);
        (await PendingMailAsync()).ShouldBe(0L);
    }

    [Fact]
    public async Task whenVerificationSent_Logs_ShouldHoldNoAddressesLinksOrCodes()
    {
        var token = await RegisterUnverifiedAsync(Address);
        await DeliverAsync();
        var code = LinkCode(Smtp.To(Address).ShouldHaveSingleItem().Message, "/verify-email");
        (await VerifyAsync(code)).Dispose();
        (await ChangeEmailAsync(token, NewAddress, TestPassword)).Dispose();
        Email.Logs.Messages.ShouldNotBeEmpty();
        Email.Logs.Messages.ShouldAllBe(message =>
            !message.Contains(Address, StringComparison.OrdinalIgnoreCase)
            && !message.Contains(NewAddress, StringComparison.OrdinalIgnoreCase)
            && !message.Contains(code, StringComparison.OrdinalIgnoreCase)
            && !message.Contains("#code=", StringComparison.Ordinal)
        );
    }

    [Fact]
    public async Task whenLanguageFrench_EmailVerification_ShouldSendTheFrenchEmail()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/register")
        {
            Content = JsonContent.Create(new { email = Address, password = TestPassword }),
        };
        request.Headers.AcceptLanguage.ParseAdd("fr-CA,fr;q=0.9");
        using (var registered = await Client.SendAsync(request, Ct))
            registered.StatusCode.ShouldBe(HttpStatusCode.Created);
        await DeliverAsync();
        Smtp.To(Address)
            .ShouldHaveSingleItem()
            .Message.Subject.ShouldBe("Confirmez votre adresse courriel pour Penny");
    }

    private Task<HttpResponseMessage> VerifyAsync(string code) =>
        SendAsync(HttpMethod.Post, "/api/auth/email-verification", null, new { token = code });

    private Task<HttpResponseMessage> ResendAsync(string token) =>
        SendAsync(HttpMethod.Post, "/api/auth/email-verification/resend", token);

    private Task<HttpResponseMessage> ChangeEmailAsync(
        string? token,
        string address,
        string password
    ) => SendAsync(HttpMethod.Post, "/api/auth/email", token, new { email = address, password });

    private async Task<JsonElement> ProfileAsync(string token) =>
        await ExpectAsync(HttpMethod.Get, "/api/profile", token, HttpStatusCode.OK);
}
