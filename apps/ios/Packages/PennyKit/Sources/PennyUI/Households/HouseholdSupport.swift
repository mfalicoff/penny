import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// A person as a gray monogram, like iOS Contacts (people never get a meaning color).
struct Monogram: View {
    let initials: String
    @ScaledMetric(relativeTo: .body) private var size: Double = 34

    var body: some View {
        Text(initials)
            .font(.caption.weight(.semibold))
            .foregroundStyle(PennyColor.secondaryLabel)
            .frame(width: size, height: size)
            .background(PennyColor.fill, in: Circle())
            .accessibilityHidden(true)
    }
}

/// Overlapping monograms for a household's members.
struct MonogramStack: View {
    let initials: [String]

    var body: some View {
        HStack(spacing: -8) {
            ForEach(Array(initials.prefix(4).enumerated()), id: \.offset) { _, letters in
                Monogram(initials: letters)
                    .overlay(Circle().stroke(PennyColor.surface, lineWidth: 2))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Words for balances, shares and months, shared by the screens and their spoken labels.
enum HouseholdText {
    /// "you're owed $142.50", "you owe $38.20" or "Settled".
    static func balance(_ cents: Int64, currency: String) -> String {
        let amount = MoneyFormat.amount(abs(cents), currency: currency)
        if cents > 0 { return "you're owed \(amount)" }
        if cents < 0 { return "you owe \(amount)" }
        return "Settled"
    }

    /// A member's balance: "+$142.50 gets back", "−$110.40 owes", "Settled".
    static func memberBalance(_ cents: Int64, currency: String) -> String {
        let amount = MoneyFormat.amount(abs(cents), currency: currency)
        if cents > 0 { return "+\(amount) gets back" }
        if cents < 0 { return "\(MoneyFormat.minus)\(amount) owes" }
        return "Settled"
    }

    static func month(_ month: MonthKey) -> String {
        DayText.date(month.first).formatted(.dateTime.month(.wide).year())
    }

    static func shortMonth(_ month: MonthKey) -> String {
        DayText.date(month.first).formatted(.dateTime.month(.wide))
    }

    static func day(_ text: String) -> String {
        guard let date = CalendarDate(text) else { return text }
        return DayText.date(date).formatted(.dateTime.month(.abbreviated).day())
    }

    static func instant(_ milliseconds: Int64) -> Date { Date(milliseconds: milliseconds) }

    static func money(_ currency: String) -> (Int64) -> String {
        { MoneyFormat.amount($0, currency: currency) }
    }

    /// "Settles Nov 30": monthly payments open on the month's last day.
    static func settles(_ month: MonthKey) -> String { "Settles \(monthEnd(month))" }

    /// "Nov 30".
    static func monthEnd(_ month: MonthKey) -> String {
        DayText.date(month.last).formatted(.dateTime.month(.abbreviated).day())
    }

    /// The online requirement, said once wherever shared data is changed.
    static let onlineRequirement =
        "Shared households live on your server, so changing them needs a connection. What you type is kept if a save fails."

    /// What recording a payment means, from the record-payment card.
    static func recordExplanation(payer: String) -> String {
        "Record this once \(payer) has paid outside Penny. Penny keeps track — it doesn't send money, and nobody's spending changes."
    }
}

/// A failure on a shared screen: what happened, that nothing changed, and Try again when that
/// can help. The action sits outside the banner so it stays its own button for VoiceOver.
struct HouseholdFailureBanner: View {
    let failure: HouseholdFailure
    /// The Shared list (`shared.notice`) or a household page (`household.notice`).
    var onList = false
    var retry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            StatusBanner(
                tone: failure.kind == .offline ? .offline : .error, title: Self.title(failure.kind),
                message: failure.message
            )
            .accessibilityIdentifier(onList ? "shared.notice" : "household.notice")
            if failure.canRetry, let retry {
                Button("Try again", action: retry)
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("household.retry")
            }
        }
    }

    static func title(_ kind: HouseholdFailure.Kind) -> String {
        switch kind {
        case .offline: "You're offline"
        case .unreachable: "Can't reach the server"
        case .stale: "Changed by someone else"
        case .restricted: "Not allowed right now"
        case .membership: "Membership changed"
        case .gone: "No longer there"
        case .invalidInvite: "Invite code didn't work"
        case .rateLimited: "Too many attempts"
        case .signIn: "Sign in again"
        case .invalid: "Check what you entered"
        case .server: "Something went wrong"
        }
    }
}

extension WireSharedCategory {
    /// The category's SF Symbol and palette color (legacy Ionicons names map onto symbols).
    var symbol: String { CategoryStyle.symbol(forIonicon: icon) }
    var tint: Color { PennyColor.category(CategoryStyle.color(forCategoryID: name.lowercased(), hex: color)) }

    init(_ category: LedgerCategory) {
        self.init(name: category.name, icon: category.icon, color: category.color)
    }

    static let other = WireSharedCategory(name: "Other", icon: "ellipsis-horizontal", color: "#8E8A85")
}
