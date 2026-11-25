using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Mail;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Households;

// Invitations by email (MAZ-124). The household creator, who manages members, invites an
// address; the request stores the invitation and queues its email in one transaction,
// and the mail runner sends it later. The code is issued when the email is sent, so the
// raw code exists only in the email; it is an invite code like a shared one (10 hex
// characters, SHA-256 stored), but it lasts `MailPolicy.InviteLifetime` and joins once.
// Joining still goes through POST /api/households/join, so the invitee accepts it.
public sealed class EmailInviteService(
    IHouseholdRepository households,
    MailPolicy mail,
    TimeProvider clock
)
{
    public const string InvalidEmail = "Enter a valid email address.";
    public const string NotFound = "Invitation not found.";
    public const string TooMany =
        "Too many invitation emails today. Try again tomorrow, or share a code instead.";
    public const string Joined = "They already joined with this invitation.";

    public Task<IReadOnlyList<EmailInviteView>> ListAsync(
        string householdId,
        string userId,
        CancellationToken cancellationToken
    )
    {
        RequireEnabled();
        return households.WriteAsync<IReadOnlyList<EmailInviteView>>(
            async store =>
            {
                await HouseholdService.RequireCreatorAsync(store, householdId, userId);
                var now = Now();
                return
                [
                    .. (await store.EmailInvitesAsync(householdId)).Select(invite =>
                        EmailInviteView.From(invite, now)
                    ),
                ];
            },
            cancellationToken
        );
    }

    public Task<EmailInviteView> InviteAsync(
        string householdId,
        string userId,
        string? email,
        string locale,
        CancellationToken cancellationToken
    )
    {
        RequireEnabled();
        var normalized = Credentials.NormalizeEmail(email)
            ?? throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.InviteInvalidEmail,
                InvalidEmail
            );
        return households.WriteAsync(
            async store =>
            {
                await HouseholdService.RequireCreatorAsync(store, householdId, userId);
                return await RequestAsync(store, householdId, userId, normalized, locale);
            },
            cancellationToken
        );
    }

    public Task<EmailInviteView> ResendAsync(
        string householdId,
        string userId,
        string inviteId,
        string locale,
        CancellationToken cancellationToken
    )
    {
        RequireEnabled();
        return households.WriteAsync(
            async store =>
            {
                await HouseholdService.RequireCreatorAsync(store, householdId, userId);
                var invite = await FindAsync(store, householdId, inviteId);
                if (invite.JoinedAt is not null)
                    throw new BackendFailure(FailureKind.Conflict, ErrorCodes.InviteJoined, Joined);
                return await RequestAsync(store, householdId, userId, invite.Email, locale);
            },
            cancellationToken
        );
    }

    public Task RevokeAsync(
        string householdId,
        string userId,
        string inviteId,
        CancellationToken cancellationToken
    )
    {
        RequireEnabled();
        return households.WriteAsync(
            async store =>
            {
                await HouseholdService.RequireCreatorAsync(store, householdId, userId);
                await FindAsync(store, householdId, inviteId);
                var now = Now();
                await store.RevokeEmailInviteAsync(inviteId, now);
                await HouseholdService.AuditAsync(
                    store,
                    householdId,
                    userId,
                    "invite.revoked",
                    null,
                    null,
                    now
                );
                return true;
            },
            cancellationToken
        );
    }

    // Mail runner: issues the code for an invitation email it is about to send, under the
    // household lock. Null when there is nothing to send any more: the invitation was
    // revoked or used, the household archived, or the inviter no longer its creator.
    public Task<OutgoingMail?> ComposeAsync(MailClaim claim, CancellationToken cancellationToken) =>
        households.WriteAsync(
            async store =>
            {
                if (claim.EmailInviteId is not { } inviteId)
                    return null;
                var invite = await store.FindEmailInviteAsync(inviteId);
                if (invite is null || invite.RevokedAt is not null || invite.JoinedAt is not null)
                    return null;
                if (!await store.LockAsync(invite.HouseholdId))
                    return null;
                var household = await store.FindAsync(invite.HouseholdId, includeArchived: false);
                var inviter = await store.MembershipAsync(invite.HouseholdId, invite.InvitedBy);
                if (
                    household is null
                    || inviter is not { IsCurrent: true }
                    || !string.Equals(
                        household.CreatorId,
                        invite.InvitedBy,
                        StringComparison.Ordinal
                    )
                )
                    return null;
                var now = Now();
                var code = InviteCodes.Create();
                var expiresAt = now + mail.InviteLifetime;
                await store.IssueEmailInviteCodeAsync(inviteId, InviteCodes.Hash(code), expiresAt);
                await HouseholdService.AuditAsync(
                    store,
                    invite.HouseholdId,
                    invite.InvitedBy,
                    "invite.emailed",
                    null,
                    new { expiresAt = expiresAt.ToUnixTimeMilliseconds() },
                    now
                );
                var (subject, text) = MailTemplates.HouseholdInvite(
                    claim.Locale,
                    mail.AppUrl,
                    code,
                    mail.InviteLifetime,
                    household.Name,
                    household.Trip is not null,
                    inviter.DisplayName
                );
                return new OutgoingMail(claim.Id, invite.Email, subject, text);
            },
            cancellationToken
        );

    private async Task<EmailInviteView> RequestAsync(
        IHouseholdTransaction store,
        string householdId,
        string userId,
        string email,
        string locale
    )
    {
        var now = Now();
        var recipient = MailRecipients.Hash(email);
        var (account, received) = await store.CountRecentMailAsync(
            userId,
            recipient,
            now - MailPolicy.LimitWindow
        );
        if (account >= mail.AccountMessagesPerDay || received >= mail.RecipientMessagesPerDay)
            throw new BackendFailure(FailureKind.RateLimited, ErrorCodes.InviteTooMany, TooMany);
        var invite = await store.RequestEmailInviteAsync(
            HouseholdService.NewId(),
            householdId,
            userId,
            email,
            now
        );
        await store.EnqueueInviteMailAsync(
            HouseholdService.NewId(),
            invite.Id,
            userId,
            recipient,
            locale,
            now
        );
        return EmailInviteView.From(invite, now);
    }

    private static async Task<StoredEmailInvite> FindAsync(
        IHouseholdTransaction store,
        string householdId,
        string inviteId
    ) =>
        HouseholdService.Storable(inviteId)
        && await store.FindEmailInviteAsync(inviteId) is { RevokedAt: null } invite
        && string.Equals(invite.HouseholdId, householdId, StringComparison.Ordinal)
            ? invite
            : throw new BackendFailure(FailureKind.NotFound, ErrorCodes.InviteNotFound, NotFound);

    private void RequireEnabled()
    {
        if (!mail.Enabled)
            throw new BackendFailure(
                FailureKind.NotFound,
                ErrorCodes.MailDisabled,
                MailPolicy.Disabled
            );
    }

    private DateTimeOffset Now() => MembershipDates.Truncate(clock.GetUtcNow());
}
