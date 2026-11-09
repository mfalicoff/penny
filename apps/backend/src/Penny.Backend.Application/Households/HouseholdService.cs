using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Households;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Households;

// Port of the legacy household membership, invitation, trip and archive operations
// (server/infrastructure/households.ts). Messages, failure kinds and the order of
// checks are part of the client contract; deviations are listed in
// docs/migration/households.md. Every mutation runs in one transaction that first
// locks the household row, so membership changes of one household serialize, and
// re-checks access inside it.
public sealed class HouseholdService(IHouseholdRepository households, TimeProvider clock)
{
    public const string InvalidData = "Invalid household data.";
    public const string NotFound = "Household not found.";
    public const string TripNotFound = "Trip not found.";
    public const string CreatorOnly = "Only the household creator can manage members.";
    public const string HouseholdCurrency = "Household currency must match your ledger currency.";
    public const string TripCurrency = "Trip currency must match your ledger currency.";
    public const string InvalidInvite = "Invite code is invalid or expired.";
    public const string AlreadyMember = "You are already a member.";
    public const string CreatorCannotLeave = "The creator cannot leave while other members remain.";
    public const string CreatorCannotBeRemoved = "The creator cannot remove themselves.";
    public const string UnsettledExit = "Settle every monthly balance before leaving.";
    public const string UnsettledArchive = "Settle all monthly balances before archiving.";

    private static readonly JsonSerializerOptions AuditJson = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public Task<IReadOnlyList<HouseholdView>> ListAsync(
        string userId,
        CancellationToken cancellationToken
    ) =>
        households.ReadAsync<IReadOnlyList<HouseholdView>>(
            async store => [.. (await store.ListAsync(userId)).Select(HouseholdView.From)],
            cancellationToken
        );

    // POST /api/households (`trip` false) and POST /api/households/trips.
    public async Task<HouseholdView> CreateAsync(
        string userId,
        JsonElement? body,
        bool trip,
        CancellationToken cancellationToken
    )
    {
        var input =
            HouseholdReader.ReadNew(body, trip)
            ?? throw new BackendFailure(FailureKind.Invalid, InvalidData);
        var now = Now();
        return await households.WriteAsync(
            async store =>
            {
                var currency = await LedgerCurrencyAsync(store, userId);
                if (!string.Equals(currency, input.Currency, StringComparison.Ordinal))
                    throw new BackendFailure(
                        FailureKind.Invalid,
                        trip ? TripCurrency : HouseholdCurrency
                    );
                var householdId = NewId();
                await store.AddHouseholdAsync(
                    new(householdId, input.Name, input.Currency, userId, now, null, input.Trip, 1)
                );
                await store.OpenPeriodAsync(
                    NewId(),
                    householdId,
                    userId,
                    now,
                    MembershipDates.JoinedOn(now, input.TimezoneOffsetMinutes)
                );
                var created = await ViewAsync(store, householdId);
                await AuditAsync(
                    store,
                    householdId,
                    userId,
                    trip ? "trip.created" : "household.created",
                    null,
                    created,
                    now
                );
                return created;
            },
            cancellationToken
        );
    }

    // Current and former members may read; a former member sees only the members who
    // had joined by the time they left. Archived households stay readable.
    public Task<HouseholdDetail> GetAsync(
        string householdId,
        string userId,
        CancellationToken cancellationToken
    ) =>
        households.ReadAsync(
            async store =>
            {
                var membership =
                    (
                        Storable(householdId)
                            ? await store.MembershipAsync(householdId, userId)
                            : null
                    ) ?? throw new BackendFailure(FailureKind.NotFound, NotFound);
                var household =
                    await store.FindAsync(householdId, includeArchived: true)
                    ?? throw new BackendFailure(FailureKind.NotFound, NotFound);
                var members = await store.MembersAsync(householdId);
                return new HouseholdDetail(
                    HouseholdView.From(household),
                    membership.LeftAt is { } leftAt
                        ? [.. members.Where(member => member.JoinedAt <= leftAt)]
                        : members
                );
            },
            cancellationToken
        );

    public async Task<HouseholdView> RenameAsync(
        string householdId,
        string userId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var name = HouseholdReader.ReadName(body);
        var now = Now();
        return await households.WriteAsync(
            async store =>
            {
                // Access is checked before the body, as in the legacy route.
                var before = HouseholdView.From(
                    await RequireCreatorAsync(store, householdId, userId)
                );
                if (name is null)
                    throw new BackendFailure(FailureKind.Invalid, InvalidData);
                await store.RenameAsync(householdId, name);
                var after = await ViewAsync(store, householdId);
                await AuditAsync(
                    store,
                    householdId,
                    userId,
                    "household.renamed",
                    before,
                    after,
                    now
                );
                return after;
            },
            cancellationToken
        );
    }

    // Changing the travel range never moves existing expenses or memberships: shared
    // trip expenses may be dated outside it (bookings made in advance).
    public async Task<HouseholdView> UpdateTripAsync(
        string householdId,
        string userId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var change = HouseholdReader.ReadTrip(body);
        var now = Now();
        return await households.WriteAsync(
            async store =>
            {
                var household = await RequireCreatorAsync(store, householdId, userId);
                if (change is null)
                    throw new BackendFailure(FailureKind.Invalid, InvalidData);
                if (household.Trip is null)
                    throw new BackendFailure(FailureKind.NotFound, TripNotFound);
                var before = HouseholdView.From(household);
                await store.UpdateTripAsync(householdId, change.Name, change.Dates);
                var after = await ViewAsync(store, householdId);
                await AuditAsync(store, householdId, userId, "trip.edited", before, after, now);
                return after;
            },
            cancellationToken
        );
    }

    // Archiving hides the household from lists and from every write, keeps its
    // history readable by members, and revokes outstanding invites.
    public Task ArchiveAsync(
        string householdId,
        string userId,
        CancellationToken cancellationToken
    ) =>
        households.WriteAsync(
            async store =>
            {
                await RequireCreatorAsync(store, householdId, userId);
                if (!HouseholdSettlement.IsSettled(await store.BalancesAsync(householdId)))
                    throw new BackendFailure(FailureKind.Conflict, UnsettledArchive);
                var now = Now();
                await store.ArchiveAsync(householdId, now);
                await store.DeleteInvitesAsync(householdId);
                // Search seam (MAZ-121): archiving changes which shared rows members can
                // search; update any membership-derived projection here, before commit.
                await AuditAsync(
                    store,
                    householdId,
                    userId,
                    "household.archived",
                    null,
                    new { householdId },
                    now
                );
                return true;
            },
            cancellationToken
        );

    // One live invite per household: a new code replaces the previous one.
    public Task<IssuedInvite> InviteAsync(
        string householdId,
        string userId,
        CancellationToken cancellationToken
    ) =>
        households.WriteAsync(
            async store =>
            {
                await RequireCreatorAsync(store, householdId, userId);
                var now = Now();
                var code = InviteCodes.Create();
                var expiresAt = now + InviteCodes.Lifetime;
                await store.ReplaceInviteAsync(householdId, InviteCodes.Hash(code), expiresAt);
                var issued = new IssuedInvite(code, expiresAt.ToUnixTimeMilliseconds());
                await AuditAsync(
                    store,
                    householdId,
                    userId,
                    "invite.created",
                    null,
                    new { expiresAt = issued.ExpiresAt },
                    now
                );
                return issued;
            },
            cancellationToken
        );

    // Legacy invites admit any number of accounts until they expire (10 minutes) or
    // a new invite replaces them; joining never consumes the code.
    public async Task<HouseholdView> JoinAsync(
        string userId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var input =
            HouseholdReader.ReadJoin(body)
            ?? throw new BackendFailure(FailureKind.Invalid, InvalidData);
        var codeHash = InviteCodes.Hash(input.Code);
        return await households.WriteAsync(
            async store =>
            {
                var now = Now();
                var invite = await store.FindInviteAsync(codeHash);
                if (invite is null || invite.ExpiresAt <= now)
                    throw new BackendFailure(FailureKind.Invalid, InvalidInvite);
                var householdId = invite.HouseholdId;
                // Archived households accept no members (their invites are revoked).
                // Invite replacement and archive hold this lock, so re-reading the code
                // under it proves it was not replaced or revoked in the meantime.
                if (
                    !await store.LockAsync(householdId)
                    || await store.FindInviteAsync(codeHash) is null
                )
                    throw new BackendFailure(FailureKind.Invalid, InvalidInvite);
                var household =
                    await store.FindAsync(householdId, includeArchived: false)
                    ?? throw new BackendFailure(FailureKind.Invalid, InvalidInvite);
                // The ledger row stays locked, so a concurrent PUT /api/ledger cannot
                // change currency between this check and the commit (ledger check 5).
                var currency = await LedgerCurrencyAsync(store, userId);
                if (!string.Equals(currency, household.Currency, StringComparison.Ordinal))
                    throw new BackendFailure(FailureKind.Invalid, HouseholdCurrency);
                if (await store.MembershipAsync(householdId, userId) is { IsCurrent: true })
                    throw new BackendFailure(FailureKind.Conflict, AlreadyMember);
                // A former member rejoins with a new period; earlier periods are kept.
                await store.OpenPeriodAsync(
                    NewId(),
                    householdId,
                    userId,
                    now,
                    MembershipDates.JoinedOn(now, input.TimezoneOffsetMinutes)
                );
                // Search seam (MAZ-121): the member can now search this household's
                // shared rows; update any membership-derived projection here.
                await AuditAsync(
                    store,
                    householdId,
                    userId,
                    "member.joined",
                    null,
                    new { userId },
                    now
                );
                return await ViewAsync(store, householdId);
            },
            cancellationToken
        );
    }

    public Task LeaveAsync(
        string householdId,
        string userId,
        CancellationToken cancellationToken
    ) =>
        households.WriteAsync(
            async store =>
            {
                var household = await RequireMemberAsync(store, householdId, userId);
                if (
                    string.Equals(household.CreatorId, userId, StringComparison.Ordinal)
                    && household.MemberCount > 1
                )
                    throw new BackendFailure(FailureKind.Conflict, CreatorCannotLeave);
                await EndMembershipAsync(store, householdId, userId, userId, "member.left");
                return true;
            },
            cancellationToken
        );

    public Task RemoveAsync(
        string householdId,
        string actorId,
        string userId,
        CancellationToken cancellationToken
    ) =>
        households.WriteAsync(
            async store =>
            {
                await RequireCreatorAsync(store, householdId, actorId);
                if (string.Equals(actorId, userId, StringComparison.Ordinal))
                    throw new BackendFailure(FailureKind.Invalid, CreatorCannotBeRemoved);
                await RequireMemberAsync(store, householdId, userId);
                await EndMembershipAsync(store, householdId, userId, actorId, "member.removed");
                return true;
            },
            cancellationToken
        );

    // Leaving or removal: the member must be settled in every month. Their past
    // periods, splits and payments stay, so history remains visible to them.
    private async Task EndMembershipAsync(
        IHouseholdTransaction store,
        string householdId,
        string userId,
        string actorId,
        string action
    )
    {
        if (!HouseholdSettlement.IsSettled(await store.BalancesAsync(householdId), userId))
            throw new BackendFailure(FailureKind.Conflict, UnsettledExit);
        var now = Now();
        await store.ClosePeriodAsync(householdId, userId, now);
        // Search seam (MAZ-121): the member loses access to shared rows recorded after
        // this instant; update any membership-derived projection here, before commit.
        await AuditAsync(store, householdId, actorId, action, new { userId }, null, now);
    }

    // Legacy `requireMember` (current member of an unarchived household), holding the
    // household lock for the rest of the unit.
    private static async Task<StoredHousehold> RequireMemberAsync(
        IHouseholdTransaction store,
        string householdId,
        string userId
    )
    {
        if (
            Storable(householdId)
            && Storable(userId)
            && await store.LockAsync(householdId)
            && await store.MembershipAsync(householdId, userId) is { IsCurrent: true }
        )
            return await store.FindAsync(householdId, includeArchived: false)
                ?? throw new BackendFailure(FailureKind.NotFound, NotFound);
        throw new BackendFailure(FailureKind.NotFound, NotFound);
    }

    private static async Task<StoredHousehold> RequireCreatorAsync(
        IHouseholdTransaction store,
        string householdId,
        string userId
    )
    {
        var household = await RequireMemberAsync(store, householdId, userId);
        return string.Equals(household.CreatorId, userId, StringComparison.Ordinal)
            ? household
            : throw new BackendFailure(FailureKind.Forbidden, CreatorOnly);
    }

    // Every account is created with a ledger; a missing one is a server fault.
    private static async Task<string> LedgerCurrencyAsync(
        IHouseholdTransaction store,
        string userId
    ) =>
        await store.LockLedgerCurrencyAsync(userId)
        ?? throw new InvalidOperationException("Account ledger is missing.");

    private static async Task<HouseholdView> ViewAsync(
        IHouseholdTransaction store,
        string householdId
    ) =>
        HouseholdView.From(
            await store.FindAsync(householdId, includeArchived: false)
                ?? throw new InvalidOperationException("Household disappeared inside its lock.")
        );

    private static Task AuditAsync(
        IHouseholdTransaction store,
        string householdId,
        string actorId,
        string action,
        object? before,
        object? after,
        DateTimeOffset now
    ) =>
        store.AuditAsync(
            new(
                NewId(),
                householdId,
                actorId,
                action,
                before is null ? null : JsonSerializer.Serialize(before, AuditJson),
                after is null ? null : JsonSerializer.Serialize(after, AuditJson),
                now
            )
        );

    // Route values that PostgreSQL text cannot hold match no household or member.
    private static bool Storable(string id) => LedgerText.IsStorable(id);

    // Legacy `randomId(16)`: 16 random bytes as lower-case hex.
    private static string NewId() => RandomNumberGenerator.GetHexString(32, lowercase: true);

    private DateTimeOffset Now() => MembershipDates.Truncate(clock.GetUtcNow());
}
