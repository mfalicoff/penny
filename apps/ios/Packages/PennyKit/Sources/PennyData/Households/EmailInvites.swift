public import Foundation
public import Observation

/// Invite by email (MAZ-124, card `iphone-invite-email`): the invitations a household's or trip's
/// creator sent, with Send, Resend and Revoke. Online only, like every shared write. A 404
/// "doesn't send email" sets `emailOff`, so the sheet falls back to the shared code and the app
/// can read `/api/info` again.
@MainActor
@Observable
public final class EmailInvitesModel {
    public enum Load: Equatable, Sendable {
        case idle
        case loading
        case loaded
        case failed(HouseholdFailure)
    }

    public let householdId: String
    public private(set) var invites: [WireEmailInvite] = []
    public private(set) var load: Load = .idle
    /// An address being sent now.
    public private(set) var sending = false
    /// Invitations with a resend or a revoke in flight.
    public private(set) var working: Set<String> = []
    /// The server said it sends no email.
    public private(set) var emailOff = false

    @ObservationIgnored private let service: any HouseholdService

    public init(householdId: String, service: any HouseholdService) {
        self.householdId = householdId
        self.service = service
    }

    public func refresh() async {
        if invites.isEmpty { load = .loading }
        do {
            invites = try await service.emailInvites(householdId: householdId)
            load = .loaded
        } catch is CancellationError {
            if case .loading = load { load = .idle }
        } catch {
            let failure = HouseholdFailure.emailInvite(error)
            note(failure)
            load = .failed(failure)
        }
    }

    /// Sends an invitation to `address`. An address that already has one is sent again, so the
    /// list replaces its row.
    public func send(to address: String) async -> Result<WireEmailInvite, HouseholdFailure> {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard EmailAddress.looksValid(trimmed) else {
            return .failure(HouseholdFailure(.invalid, "Enter a valid email address."))
        }
        guard !sending else { return .failure(HouseholdFailure(.invalid, "An invitation is already being sent.")) }
        sending = true
        defer { sending = false }
        do {
            let invite = try await service.sendEmailInvite(householdId: householdId, email: trimmed)
            upsert(invite, atTop: true)
            return .success(invite)
        } catch {
            let failure = HouseholdFailure.emailInvite(error)
            note(failure)
            return .failure(failure)
        }
    }

    public func resend(_ invite: WireEmailInvite) async -> HouseholdFailure? {
        await act(on: invite) {
            let sent = try await self.service.resendEmailInvite(householdId: self.householdId, inviteId: invite.id)
            self.upsert(sent, atTop: false)
        }
    }

    public func revoke(_ invite: WireEmailInvite) async -> HouseholdFailure? {
        await act(on: invite) {
            try await self.service.revokeEmailInvite(householdId: self.householdId, inviteId: invite.id)
            self.invites.removeAll { $0.id == invite.id }
        }
    }

    private func act(on invite: WireEmailInvite, _ work: @escaping () async throws -> Void) async -> HouseholdFailure? {
        guard !working.contains(invite.id) else { return nil }
        working.insert(invite.id)
        defer { working.remove(invite.id) }
        do {
            try await work()
            return nil
        } catch {
            let failure = HouseholdFailure.emailInvite(error)
            note(failure)
            // Revoked elsewhere: drop the row the server no longer lists.
            if failure.kind == .gone { invites.removeAll { $0.id == invite.id } }
            return failure
        }
    }

    private func upsert(_ invite: WireEmailInvite, atTop: Bool) {
        if let index = invites.firstIndex(where: { $0.id == invite.id || $0.email == invite.email }) {
            if atTop {
                invites.remove(at: index)
                invites.insert(invite, at: 0)
            } else {
                invites[index] = invite
            }
        } else {
            invites.insert(invite, at: 0)
        }
        load = .loaded
    }

    private func note(_ failure: HouseholdFailure) {
        if failure.kind == .emailOff { emailOff = true }
    }
}

/// The words on an invitation's row (card `iphone-invite-email`), as on the web.
public enum EmailInviteText {
    public static func status(_ status: WireEmailInvite.Status) -> String {
        switch status {
        case .sending: "Sending"
        case .waiting: "Waiting"
        case .expired: "Expired"
        case .joined: "Joined"
        case .failed: "Failed"
        }
    }

    /// "Sent today at 9:38", "Sent Nov 18 · link expired", or what became of it.
    public static func detail(
        _ invite: WireEmailInvite, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        let sent = invite.sentAt.map {
            "Sent \(sentLabel(Date(milliseconds: $0), now: now, calendar: calendar, locale: locale))"
        }
        switch invite.status {
        case .sending: return sent.map { "\($0) · sending again" } ?? "Sending now"
        case .waiting: return sent ?? "Sent"
        case .expired: return "\(sent ?? "Sent") · link expired"
        case .joined: return "\(sent ?? "Sent") · joined"
        case .failed: return "Couldn't be delivered. Check the address, or share a code instead."
        }
    }

    /// "today at 9:38", "yesterday at 18:05", or "Nov 18".
    public static func sentLabel(_ date: Date, now: Date, calendar: Calendar, locale: Locale) -> String {
        let time = date.formatted(
            Date.FormatStyle(
                date: .omitted, time: .shortened, locale: locale, calendar: calendar,
                timeZone: calendar.timeZone))
        if calendar.isDate(date, inSameDayAs: now) { return "today at \(time)" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
            calendar.isDate(date, inSameDayAs: yesterday)
        {
            return "yesterday at \(time)"
        }
        var style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
        style = style.month(.abbreviated).day()
        return date.formatted(style)
    }
}
