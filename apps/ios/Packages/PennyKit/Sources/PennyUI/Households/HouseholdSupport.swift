import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// A person as a gray monogram, like iOS Contacts (people never get a meaning color).
struct Monogram: View {
    let initials: String
    @ScaledMetric private var size: Double

    init(initials: String, size: Double = 34) {
        self.initials = initials
        _size = ScaledMetric(wrappedValue: size, relativeTo: .body)
    }

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.36, weight: .semibold))
            .foregroundStyle(PennyColor.secondaryLabel)
            .frame(width: size, height: size)
            .background(PennyColor.fill, in: Circle())
            .accessibilityHidden(true)
    }
}

/// Overlapping monograms for a household's members.
struct MonogramStack: View {
    let initials: [String]
    var size: Double = 34

    var body: some View {
        HStack(spacing: -size * 0.2) {
            ForEach(Array(initials.prefix(4).enumerated()), id: \.offset) { _, letters in
                Monogram(initials: letters, size: size)
                    .overlay(Circle().stroke(PennyColor.surface, lineWidth: size >= 40 ? 3 : 1.5))
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

    /// What recording a payment means, from the record-payment card: "Record this once Jo has paid
    /// you outside Penny. …", or "once you have paid Jo" when you're the one paying.
    static func recordExplanation(from: String, to: String, people: HouseholdPeople) -> String {
        let paid =
            from == people.meId
            ? "you have paid \(people.name(to))" : "\(people.name(from)) has paid \(people.object(to))"
        return "Record this once \(paid) outside Penny. Penny keeps track — it doesn't send money, and nobody's "
            + "spending changes."
    }

    /// "2 min ago", "now", "yesterday": an instant relative to `now` (`ShellModel.now`).
    static func ago(_ milliseconds: Int64, now: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.dateTimeStyle = .named
        formatter.unitsStyle = .short
        return formatter.localizedString(for: instant(milliseconds), relativeTo: now)
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
    /// The category's SF Symbol and palette color (stored Ionicons names map onto symbols).
    var symbol: String { CategoryStyle.symbol(forIonicon: icon) }
    var tint: Color { PennyColor.category(CategoryStyle.color(forCategoryID: name.lowercased(), hex: color)) }

    init(_ category: LedgerCategory) {
        self.init(name: category.name, icon: category.icon, color: category.color)
    }

    static let other = WireSharedCategory(name: "Other", icon: "ellipsis-horizontal", color: "#8E8A85")
}

/// The cards' small tags on shared screens: a glyph and 12-point semibold words in a rounded
/// rectangle, tinted by meaning (`iphone-shared`'s green Settled, `iphone-shared-balances`'
/// amber Settles Nov 30, `iphone-record-payment`'s neutral Full share). Always words as well as
/// color.
struct HouseholdTag: View {
    enum Tone { case neutral, income, pending, danger }

    @ScaledMetric(relativeTo: .caption) private var glyph = 10.0
    let text: String
    let systemImage: String
    var tone: Tone = .neutral

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage).font(.system(size: glyph, weight: .bold)).accessibilityHidden(true)
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .fixedSize()
    }

    private var foreground: Color {
        switch tone {
        case .neutral: PennyColor.secondaryLabel
        case .income: PennyColor.income
        case .pending: PennyColor.pending
        case .danger: PennyColor.danger
        }
    }

    private var background: Color {
        switch tone {
        case .neutral: PennyColor.fill
        case .income: PennyColor.income.opacity(0.14)
        case .pending: PennyColor.pending.opacity(0.16)
        case .danger: PennyColor.danger.opacity(0.12)
        }
    }
}
