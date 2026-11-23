using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Penny.Backend.Application.Mail;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// A server without email settings (MAZ-124) keeps working as before: /api/info says so,
// the email flows answer 404 and nothing is queued. The operator reset still works
// (PasswordResetTests).
public sealed class EmailDisabledTests(ApiFixture fixture) : HouseholdTestBase(fixture)
{
    [Fact]
    public async Task whenEmailOff_EmailFlows_ShouldAnswerNotFoundAndQueueNothing()
    {
        var info = await Client.GetFromJsonAsync<JsonElement>("/api/info", Ct);
        info.GetProperty("emailEnabled").GetBoolean().ShouldBeFalse();

        var alex = await AccountAsync("alex@example.test");
        using (
            var reset = await SendAsync(
                HttpMethod.Post,
                "/api/auth/password-reset/request",
                null,
                new { email = "alex@example.test" }
            )
        )
            await AuthTests.ShouldBeErrorAsync(reset, HttpStatusCode.NotFound, MailPolicy.Disabled);
        var householdId = (await CreateHouseholdAsync(alex.Token)).GetProperty("id").GetString()!;
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{householdId}/email-invites",
            alex.Token,
            HttpStatusCode.NotFound,
            MailPolicy.Disabled,
            new { email = "sam@example.test" }
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            $"/api/households/{householdId}/email-invites",
            alex.Token,
            HttpStatusCode.NotFound,
            MailPolicy.Disabled
        );
        // MAZ-172: verification is off. A new account stays unverified (the apps show no
        // unverified state while email is off), nothing is queued and resending is a 404.
        var profile = await ExpectAsync(
            HttpMethod.Get,
            "/api/profile",
            alex.Token,
            HttpStatusCode.OK
        );
        profile.GetProperty("emailVerified").GetBoolean().ShouldBeFalse();
        using (
            var resend = await SendAsync(
                HttpMethod.Post,
                "/api/auth/email-verification/resend",
                alex.Token
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                resend,
                HttpStatusCode.NotFound,
                MailPolicy.Disabled
            );
        // An email change works and queues nothing.
        using (
            var changed = await SendAsync(
                HttpMethod.Post,
                "/api/auth/email",
                alex.Token,
                new { email = "alex.new@example.test", password = TestPassword }
            )
        )
            changed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await CountAsync("SELECT count(*) FROM penny.mail_outbox")).ShouldBe(0L);
        (await CountAsync("SELECT count(*) FROM penny.email_verifications")).ShouldBe(0L);
        // Shared codes keep working.
        (await InviteAsync(householdId, alex.Token)).ShouldMatch("^[A-F0-9]{10}$");
    }
}
