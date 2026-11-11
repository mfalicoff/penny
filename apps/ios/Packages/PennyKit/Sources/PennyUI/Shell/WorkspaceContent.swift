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

/// One entry: category icon, title, date and account (or "Waiting to sync"), and the amount
/// with its meaning's sign and color. A shared or split entry shows the person's share.
struct EntryRow: View {
    @Environment(ShellModel.self) private var shell
    let entry: ReportEntry
    let report: LedgerReport
    let currency: String

    var body: some View {
        let category = report.categories.first { $0.id == entry.categoryId }
        let waiting = shell.workspace.pendingEntryIDs.contains(entry.id)
        // MAZ-136: a preview, or income dated after today, is expected: an amber ring, and the
        // word in the meta line so the meaning is never color alone.
        let expected = entry.isExpected(today: shell.today)
        HStack(spacing: 12) {
            CategoryIcon(
                symbol: CategoryStyle.symbol(forIonicon: category?.icon ?? "pricetag"),
                color: PennyColor.category(
                    category?.paletteColor ?? CategoryStyle.color(forCategoryID: entry.categoryId))
            )
            .overlay {
                if expected { Circle().strokeBorder(PennyColor.pending, lineWidth: 2).accessibilityHidden(true) }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title).font(.body.weight(.semibold)).foregroundStyle(PennyColor.label).lineLimit(2)
                if waiting {
                    Label("Waiting to sync", systemImage: "clock")
                        .font(.footnote).foregroundStyle(PennyColor.pending)
                } else {
                    Text(meta(category: category, expected: expected)).font(.footnote)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            MoneyText(entry.share, meaning: Self.meaning(entry, today: shell.today), currency: currency)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
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

    private func meta(category: LedgerCategory?, expected: Bool) -> String {
        var parts = [DayText.short(entry.date, today: shell.today)]
        if expected { parts.append("Expected") }
        if let account = entry.accountId.flatMap(report.ledger.account(id:)) { parts.append(account.name) }
        if entry.share != entry.total { parts.append("your share") }
        if parts.count == 1, let category { parts.append(category.name) }
        return parts.joined(separator: " · ")
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

    static func long(_ day: CalendarDate, today: CalendarDate) -> String {
        if day == today { return "Today" }
        if day == today.adding(days: -1) { return "Yesterday" }
        return date(day).formatted(.dateTime.weekday(.wide).month(.wide).day())
    }
}

extension View {
    /// Inline navigation titles on iOS; nothing on the macOS host.
    func toolbarTitleDisplayModeInline() -> some View {
        #if os(iOS)
            navigationBarTitleDisplayMode(.inline)
        #else
            self
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
