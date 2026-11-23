using System.Net;
using Penny.Backend.Application.Households;
using Penny.Backend.Application.Mail;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Household and trip invitations by email (MAZ-124) over real HTTP, PostgreSQL and
// MailKit SMTP to a local fake server.
public sealed class EmailInviteTests(ApiFixture fixture, EmailHost email)
    : EmailTestBase(fixture, email),
        IClassFixture<EmailHost>
{
    private const string Invitee = "sam@example.test";

    private async Task<(string HouseholdId, string Alex)> HouseholdAsync()
    {
        var alex = await AccountAsync("alex@example.test");
        var householdId = (await CreateHouseholdAsync(alex.Token)).GetProperty("id").GetString()!;
        return (householdId, alex.Token);
    }

    [Fact]
    public async Task whenCreatorInvitesByEmail_EmailInvite_ShouldSendACodeThatJoinsOnce()
    {
        var (householdId, alex) = await HouseholdAsync();
        var invite = await EmailInviteAsync(householdId, alex, " SAM@Example.test ");
        invite.GetProperty("email").GetString().ShouldBe(Invitee);
        invite.GetProperty("status").GetString().ShouldBe("sending");
        invite.GetProperty("expiresAt").ValueKind.ShouldBe(System.Text.Json.JsonValueKind.Null);
        Smtp.Received.ShouldBeEmpty();

        (await DeliverAsync()).ShouldBe(1);
        var message = Smtp.To(Invitee).ShouldHaveSingleItem().Message;
        (message.Subject ?? "").ShouldContain("Home");
        var code = LinkCode(message, "/join");
        code.ShouldMatch("^[A-F0-9]{10}$");
        Body(message).ShouldContain($"{code[..5]} {code[5..]}");
        // No amounts or other financial data travel in the email.
        Body(message).ShouldNotContain("$");
        Body(message).ShouldNotContain("CAD");

        var listed = (await EmailInvitesAsync(householdId, alex))
            .EnumerateArray()
            .ShouldHaveSingleItem();
        listed.GetProperty("status").GetString().ShouldBe("waiting");
        listed.GetProperty("sentAt").GetInt64().ShouldBe(Millis(Noon));
        listed.GetProperty("expiresAt").GetInt64().ShouldBe(Millis(Noon.AddHours(72)));
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{householdId}' AND action = 'invite.emailed'"
            )
        ).ShouldBe(1L);
        // The address stays out of the audit history.
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE after_json::text LIKE '%example.test%'"
            )
        ).ShouldBe(0L);

        // Joining still goes through the join endpoint, once.
        MailAt(Noon.AddHours(71));
        var sam = await AccountAsync(Invitee);
        using (var joined = await JoinAsync(sam.Token, code))
            joined.StatusCode.ShouldBe(HttpStatusCode.OK);
        var other = await AccountAsync("other@example.test");
        using (var reused = await JoinAsync(other.Token, code))
            await AuthTests.ShouldBeErrorAsync(
                reused,
                HttpStatusCode.BadRequest,
                HouseholdService.InvalidInvite
            );
        (await EmailInvitesAsync(householdId, alex))[0]
            .GetProperty("status")
            .GetString()
            .ShouldBe("joined");
    }

    [Fact]
    public async Task whenInviteExpires_EmailInvite_ShouldRefuseTheCodeAndListItExpired()
    {
        var (householdId, alex) = await HouseholdAsync();
        await EmailInviteAsync(householdId, alex, Invitee);
        await DeliverAsync();
        var code = LinkCode(Smtp.To(Invitee).ShouldHaveSingleItem().Message, "/join");
        MailAt(Noon.AddHours(72));
        var sam = await AccountAsync(Invitee);
        using var late = await JoinAsync(sam.Token, code);
        await AuthTests.ShouldBeErrorAsync(
            late,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidInvite
        );
        (await EmailInvitesAsync(householdId, alex))[0]
            .GetProperty("status")
            .GetString()
            .ShouldBe("expired");
    }

    [Fact]
    public async Task whenResent_EmailInvite_ShouldReplaceTheEarlierCode()
    {
        var (householdId, alex) = await HouseholdAsync();
        var id = (await EmailInviteAsync(householdId, alex, Invitee))
            .GetProperty("id")
            .GetString()!;
        await DeliverAsync();
        var first = LinkCode(Smtp.To(Invitee).ShouldHaveSingleItem().Message, "/join");

        MailAt(Noon.AddMinutes(1));
        var resent = await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{householdId}/email-invites/{id}/resend",
            alex,
            HttpStatusCode.Accepted
        );
        resent.GetProperty("id").GetString().ShouldBe(id);
        resent.GetProperty("status").GetString().ShouldBe("sending");
        // The earlier link keeps working until the new email issues its own code.
        await DeliverAsync();
        var second = LinkCode(Smtp.To(Invitee)[1].Message, "/join");
        second.ShouldNotBe(first);

        var sam = await AccountAsync(Invitee);
        using (var stale = await JoinAsync(sam.Token, first))
            await AuthTests.ShouldBeErrorAsync(
                stale,
                HttpStatusCode.BadRequest,
                HouseholdService.InvalidInvite
            );
        using (var current = await JoinAsync(sam.Token, second))
            current.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var joinedAgain = await SendAsync(
            HttpMethod.Post,
            $"/api/households/{householdId}/email-invites/{id}/resend",
            alex
        );
        await AuthTests.ShouldBeErrorAsync(
            joinedAgain,
            HttpStatusCode.Conflict,
            EmailInviteService.Joined
        );
    }

    [Fact]
    public async Task whenRevokedBeforeSending_EmailInvite_ShouldSendNothing()
    {
        var (householdId, alex) = await HouseholdAsync();
        var id = (await EmailInviteAsync(householdId, alex, Invitee))
            .GetProperty("id")
            .GetString()!;
        await ExpectAsync(
            HttpMethod.Delete,
            $"/api/households/{householdId}/email-invites/{id}",
            alex,
            HttpStatusCode.OK
        );
        var run = await Email.Runner.RunOnceAsync(Ct);
        run.Claimed.ShouldBe(0);
        Smtp.Received.ShouldBeEmpty();
        (await EmailInvitesAsync(householdId, alex)).GetArrayLength().ShouldBe(0);
        using var gone = await SendAsync(
            HttpMethod.Delete,
            $"/api/households/{householdId}/email-invites/{id}",
            alex
        );
        await AuthTests.ShouldBeErrorAsync(
            gone,
            HttpStatusCode.NotFound,
            EmailInviteService.NotFound
        );
    }

    [Fact]
    public async Task whenRevokedAfterSending_EmailInvite_ShouldRefuseItsCode()
    {
        var (householdId, alex) = await HouseholdAsync();
        var id = (await EmailInviteAsync(householdId, alex, Invitee))
            .GetProperty("id")
            .GetString()!;
        await DeliverAsync();
        var code = LinkCode(Smtp.To(Invitee).ShouldHaveSingleItem().Message, "/join");
        await ExpectAsync(
            HttpMethod.Delete,
            $"/api/households/{householdId}/email-invites/{id}",
            alex,
            HttpStatusCode.OK
        );
        var sam = await AccountAsync(Invitee);
        using var refused = await JoinAsync(sam.Token, code);
        await AuthTests.ShouldBeErrorAsync(
            refused,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidInvite
        );
    }

    [Fact]
    public async Task whenServerRefusesRecipient_EmailInvite_ShouldListItFailed()
    {
        var (householdId, alex) = await HouseholdAsync();
        Smtp.Refuse(1, "550 5.1.1 No such user");
        await EmailInviteAsync(householdId, alex, Invitee);
        var run = await Email.Runner.RunOnceAsync(Ct);
        run.Failed.ShouldBe(1);
        run.Reasons.ShouldBe(["smtp:550"]);
        (await EmailInvitesAsync(householdId, alex))[0]
            .GetProperty("status")
            .GetString()
            .ShouldBe("failed");
        (await PendingMailAsync()).ShouldBe(0L);
    }

    [Fact]
    public async Task whenAccountLimitReached_EmailInvite_ShouldAnswerTooManyRequests()
    {
        var (householdId, alex) = await HouseholdAsync();
        for (var index = 0; index < EmailHost.AccountLimit; index++)
            await EmailInviteAsync(householdId, alex, $"person{index}@example.test");
        using var refused = await SendAsync(
            HttpMethod.Post,
            $"/api/households/{householdId}/email-invites",
            alex,
            new { email = "one-more@example.test" }
        );
        await AuthTests.ShouldBeErrorAsync(
            refused,
            HttpStatusCode.TooManyRequests,
            EmailInviteService.TooMany
        );
        (await CountAsync("SELECT count(*) FROM penny.household_email_invites")).ShouldBe(
            EmailHost.AccountLimit
        );
    }

    [Fact]
    public async Task whenRecipientLimitReached_EmailInvite_ShouldAnswerTooManyRequests()
    {
        var (householdId, alex) = await HouseholdAsync();
        for (var index = 0; index < EmailHost.RecipientLimit; index++)
            await EmailInviteAsync(householdId, alex, Invitee);
        using var refused = await SendAsync(
            HttpMethod.Post,
            $"/api/households/{householdId}/email-invites",
            alex,
            new { email = Invitee }
        );
        await AuthTests.ShouldBeErrorAsync(
            refused,
            HttpStatusCode.TooManyRequests,
            EmailInviteService.TooMany
        );
        // One request at a time sends one email: the earlier ones were superseded.
        (await DeliverAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task whenMemberWhoIsNotCreatorManagesInvites_EmailInvite_ShouldBeForbidden()
    {
        var (householdId, alex) = await HouseholdAsync();
        var sam = await AccountAsync(Invitee);
        await AdmitAsync(householdId, alex, sam.Token);
        using var invite = await SendAsync(
            HttpMethod.Post,
            $"/api/households/{householdId}/email-invites",
            sam.Token,
            new { email = "friend@example.test" }
        );
        await AuthTests.ShouldBeErrorAsync(
            invite,
            HttpStatusCode.Forbidden,
            HouseholdService.CreatorOnly
        );
        using var list = await SendAsync(
            HttpMethod.Get,
            $"/api/households/{householdId}/email-invites",
            sam.Token
        );
        await AuthTests.ShouldBeErrorAsync(
            list,
            HttpStatusCode.Forbidden,
            HouseholdService.CreatorOnly
        );
        using var invalid = await SendAsync(
            HttpMethod.Post,
            $"/api/households/{householdId}/email-invites",
            alex,
            new { email = "not an address" }
        );
        await AuthTests.ShouldBeErrorAsync(
            invalid,
            HttpStatusCode.BadRequest,
            EmailInviteService.InvalidEmail
        );
    }

    [Fact]
    public async Task whenHouseholdArchived_EmailInvite_ShouldRevokeItAndSendNothing()
    {
        var (householdId, alex) = await HouseholdAsync();
        await EmailInviteAsync(householdId, alex, Invitee);
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{householdId}/archive",
            alex,
            HttpStatusCode.OK
        );
        (await DeliverAsync()).ShouldBe(0);
        Smtp.Received.ShouldBeEmpty();
        (
            await CountAsync(
                "SELECT count(*) FROM penny.household_email_invites WHERE revoked_at IS NULL"
            )
        ).ShouldBe(0L);
    }

    [Fact]
    public async Task whenTripInviteIsFrench_EmailInvite_ShouldUseTheFrenchTemplate()
    {
        var alex = await AccountAsync("alex@example.test");
        var tripId = (await CreateTripAsync(alex.Token)).GetProperty("id").GetString()!;
        using var request = Authorized(
            HttpMethod.Post,
            $"/api/households/{tripId}/email-invites",
            bearer: alex.Token
        );
        request.Headers.AcceptLanguage.ParseAdd("fr-CA,fr;q=0.9,en;q=0.5");
        request.Content = System.Net.Http.Json.JsonContent.Create(new { email = Invitee });
        using (var response = await Client.SendAsync(request, Ct))
            response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        await DeliverAsync();
        var message = Smtp.To(Invitee).ShouldHaveSingleItem().Message;
        (message.Subject ?? "").ShouldContain("voyage");
        Body(message).ShouldContain("code d'invitation");
        LinkCode(message, "/join").ShouldMatch("^[A-F0-9]{10}$");
    }
}
