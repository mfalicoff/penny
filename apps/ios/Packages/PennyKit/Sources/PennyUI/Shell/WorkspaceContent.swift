import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Shows `content` for a loaded ledger, and a named state otherwise: loading, a load error
/// with its next step (Try again, or Download again for a copy that can't be read), or a copy
/// this build can't open.
struct WorkspaceContent<Content: View>: View {
    @Environment(ShellModel.self) private var shell
    @ViewBuilder let content: (Ledger) -> Content

    var body: some View {
        switch shell.workspace.load {
        case .loading:
            PennyStateView(.loading, title: "Loading your entries…")
        case .ready(let ledger):
            content(ledger)
        case .failed(let problem):
            PennyStateView(
                problem.kind == .offline ? .offline : .error,
                title: problem.kind == .offline ? "You're offline" : "Couldn't load your entries",
                message: problem.message, actionTitle: Self.actionTitle(problem)
            ) { Task { await shell.workspace.reload() } }
        case .unavailable(let message):
            PennyStateView(.unavailable, title: "Can't open your entries", message: message)
        }
    }

    static func actionTitle(_ problem: WorkspaceProblem) -> String {
        problem.kind == .storageUnreadable ? "Download again" : "Try again"
    }
}

/// One entry, as the cards' `.row`: category icon, title, a line with the date (where the list
/// has no day headers), the account and what's special about it ("split 2 ways", "monthly"), or
/// "Waiting to sync", and the amount with its meaning's sign and color. A split or shared entry
/// shows the person's share, with "of $12.80" or "your share" under it.
struct EntryRow: View {
    @Environment(ShellModel.self) private var shell
    let entry: ReportEntry
    let report: LedgerReport
    let currency: String
    /// Activity's rows sit under day headers, so they leave the date out.
    var showsDate = true

    var body: some View {
        let category = report.categories.first { $0.id == entry.categoryId }
        let waiting = shell.workspace.pendingEntryIDs.contains(entry.id)
        // MAZ-136: a preview, or income dated after today, is expected: an amber ring, and the
        // word in the meta line so the meaning is never color alone.
        let expected = entry.isExpected(today: shell.today)
        HStack(spacing: 12) {
            CategoryIcon(
                symbol: EntryText.tileSymbol(entry.kind, category: category),
                color: EntryText.tileColor(entry.kind, category: category, id: entry.categoryId)
            )
            .overlay {
                if expected { Circle().strokeBorder(PennyColor.pending, lineWidth: 2).accessibilityHidden(true) }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.title).font(.callout.weight(.semibold)).foregroundStyle(PennyColor.label).lineLimit(2)
                if waiting {
                    // The status stays in words while the sync line replaces the meta line.
                    Label(Self.waitingText(entry, today: shell.today), systemImage: "clock")
                        .font(.footnote).foregroundStyle(PennyColor.pending)
                } else {
                    Text(
                        Self.meta(
                            entry, category: category, report: report, today: shell.today, showsDate: showsDate)
                    )
                    .font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                MoneyText(
                    entry.share, meaning: Self.meaning(entry, today: shell.today), currency: currency,
                    style: .callout.weight(.semibold))
                if let note = Self.amountNote(entry, currency: currency) {
                    Text(note).font(.caption.weight(.medium)).foregroundStyle(PennyColor.secondaryLabel)
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, ControlSize.rowInsets.leading)
        .padding(.vertical, ControlSize.rowInsets.top)
        .frame(minHeight: ControlSize.row)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("entry.\(entry.id)")
    }

    static func meaning(_ entry: ReportEntry, today: CalendarDate? = nil) -> MoneyMeaning {
        if entry.isExpected(today: today) { return .pending }
        switch entry.kind {
        case .expense: return .expense
        case .income: return .income
        case .investment: return .investment
        }
    }

    /// What a row not in Left to spend is, said once: "Expected" for income dated after today
    /// (MAZ-136) and for scheduled income, "Scheduled" for any other preview (MAZ-77), nil for
    /// a recorded entry. A preview never reads as money that moved.
    static func status(_ entry: ReportEntry, today: CalendarDate?) -> String? {
        guard entry.isExpected(today: today) else { return nil }
        return entry.kind == .income ? "Expected" : "Scheduled"
    }

    /// The line under the title, as the cards read it: the day (unless the list has day
    /// headers), the status, then the household's name and who paid for a shared expense
    /// (MAZ-185, MAZ-275: "Apartment · you paid $2,900", "Apartment · Jo paid") or the account,
    /// then "split 2 ways" for an equal split and, under a day header, the schedule's cadence
    /// ("monthly"). The category stands in when there is nothing else to say.
    /// "Nov 6 · Visa", "Today · Visa · split 2 ways"; on Activity "Main chequing · monthly".
    static func meta(
        _ entry: ReportEntry, category: LedgerCategory?, report: LedgerReport, today: CalendarDate,
        showsDate: Bool = true
    ) -> String {
        var details: [String] = []
        if let household = entry.householdName {
            details.append(household.isEmpty ? "Shared" : household)
            // MAZ-275: who paid, as the cards' Rent row ("Apartment · you paid $2,900"), in place
            // of the account the payer paid with.
            if let paid = paidText(entry, currency: report.ledger.currency.rawValue) { details.append(paid) }
        } else if let account = entry.accountId.flatMap(report.ledger.account(id:)) {
            details.append(account.name)
        }
        if entry.householdName == nil, let people = equalSplit(entry) { details.append("split \(people) ways") }
        if !showsDate, let rule = entry.recurringId.flatMap(report.ledger.rule(id:)) {
            details.append(ScheduleText.frequency(rule.frequency).lowercased())
        }
        if details.isEmpty, let category { details.append(category.name) }
        let day = showsDate ? [DayText.short(entry.date, today: today)] : []
        return (day + [status(entry, today: today)].compactMap(\.self) + details).joined(separator: " · ")
    }

    /// Who paid a shared row: "you paid $2,900" (whole units when the total is whole, as the card
    /// writes it), "Jo paid", or "Former member paid"; nil when the server sent no payer.
    static func paidText(_ entry: ReportEntry, currency: String) -> String? {
        switch entry.payer {
        case .you:
            let total =
                entry.total % 100 == 0
                ? MoneyFormat.whole(entry.total, currency: currency)
                : MoneyFormat.amount(entry.total, currency: currency)
            return "you paid \(total)"
        case .member(let name): return "\(name) paid"
        case nil: return nil
        }
    }

    /// The line under the amount: "your share" for a shared expense, "of $12.80" for a personal
    /// split, nil when the amount is the whole entry.
    static func amountNote(_ entry: ReportEntry, currency: String) -> String? {
        if entry.householdName != nil { return "your share" }
        guard entry.share != entry.total else { return nil }
        return "of \(MoneyFormat.amount(entry.total, currency: currency))"
    }

    /// The head count of an equal split, when the share is exactly what splitting the total
    /// that many ways gives (`Money.personalShare` rounds half up). Entries keep only the total
    /// and the share, so an amount or percentage share that isn't an equal split says nothing.
    static func equalSplit(_ entry: ReportEntry) -> Int64? {
        guard entry.share > 0, entry.share < entry.total else { return nil }
        let people = Money.divideRoundingHalfUp(entry.total, by: entry.share)
        guard (2...100).contains(people), Money.divideRoundingHalfUp(entry.total, by: people) == entry.share else {
            return nil
        }
        return people
    }

    /// The pending-sync line, which replaces the meta line: it keeps the status in words.
    static func waitingText(_ entry: ReportEntry, today: CalendarDate) -> String {
        ["Waiting to sync", status(entry, today: today)].compactMap(\.self).joined(separator: " · ")
    }
}

enum DayText {
    static func date(_ day: CalendarDate) -> Date {
        var parts = DateComponents()
        parts.year = day.year
        parts.month = day.month
        parts.day = day.day
        return Calendar(identifier: .gregorian).date(from: parts) ?? .distantPast
    }

    static func short(_ day: CalendarDate, today: CalendarDate) -> String {
        if day == today { return "Today" }
        if day == today.adding(days: -1) { return "Yesterday" }
        return date(day).formatted(.dateTime.month(.abbreviated).day())
    }

    /// "Friday, Nov 6", as the cards' day headers and detail lines read.
    static func long(_ day: CalendarDate, today: CalendarDate) -> String {
        if day == today { return "Today" }
        if day == today.adding(days: -1) { return "Yesterday" }
        return date(day).formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }

    /// "Fri, Nov 6": the day headers in narrower lists (iPad Activity, household history).
    static func medium(_ day: CalendarDate, today: CalendarDate) -> String {
        if day == today { return "Today" }
        if day == today.adding(days: -1) { return "Yesterday" }
        return date(day).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }
}

extension View {
    /// Leaves the title out of the navigation bar when the screen draws its own.
    @ViewBuilder
    func toolbarTitleHidden(_ hidden: Bool) -> some View {
        if hidden { toolbar(removing: .title) } else { self }
    }

    /// Inline navigation titles on iOS; nothing on the macOS host.
    func toolbarTitleDisplayModeInline() -> some View {
        #if os(iOS)
            navigationBarTitleDisplayMode(.inline)
        #else
            self
        #endif
    }

    /// A search field at the top of the page, always shown (on iOS a sheet would otherwise put
    /// it at the bottom).
    func searchableAtTop(text: Binding<String>, prompt: String) -> some View {
        #if os(iOS)
            searchable(text: text, placement: .navigationBarDrawer(displayMode: .always), prompt: Text(prompt))
        #else
            searchable(text: text, prompt: Text(prompt))
        #endif
    }

    func toolbarTitleDisplayModeLarge() -> some View {
        #if os(iOS)
            navigationBarTitleDisplayMode(.large)
        #else
            self
        #endif
    }
}
