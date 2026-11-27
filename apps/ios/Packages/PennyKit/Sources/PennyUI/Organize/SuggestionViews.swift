import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Recurring suggestions (MAZ-290, `iphone-recurring-suggested`, `ipad-recurring-suggested`,
// `iphone-recurring-empty`, `iphone-suggestion-dismissed-toast`): personal entries that repeat,
// offered on Recurring as schedules. The rule is `RecurringSuggestions` (PennyDomain).

/// Wording for suggestions, shared by the rows, the iPad pane, the toast and the form.
enum SuggestionText {
    /// "Every month, around the 3rd", "Every week, on Wednesdays", "Every year, around March 14".
    static func cadence(_ suggestion: RecurringSuggestion) -> String {
        switch suggestion.frequency {
        case .weekly: "Every week, on \(ScheduleText.weekday(suggestion.nextDate))s"
        case .monthly: "Every month, around the \(ScheduleText.ordinal(suggestion.anchorDay))"
        case .yearly:
            "Every year, around \(ScheduleText.monthName(suggestion.nextDate.month)) \(suggestion.anchorDay)"
        }
    }

    /// "Seen 4 times since Aug 3" (with the year when it isn't this year's).
    static func seen(_ suggestion: RecurringSuggestion, today: CalendarDate) -> String {
        "Seen \(suggestion.count) times since \(day(suggestion.firstDate, today: today))"
    }

    /// "Aug 3", or "Feb 29, 2024" in another year.
    static func day(_ date: CalendarDate, today: CalendarDate) -> String {
        let format = Date.FormatStyle.dateTime.month(.abbreviated).day()
        return DayText.date(date).formatted(date.year == today.year ? format : format.year())
    }

    /// "every month", "every week", "every year".
    static func every(_ frequency: RecurrenceFrequency) -> String {
        switch frequency {
        case .weekly: "every week"
        case .monthly: "every month"
        case .yearly: "every year"
        }
    }

    /// "was $15.49" after a price step that held.
    static func was(_ suggestion: RecurringSuggestion, currency: String) -> String? {
        suggestion.previousShare.map { "was \(MoneyFormat.amount($0, currency: currency))" }
    }

    /// "was $15.49 until October": the month the new amount started.
    static func wasUntil(_ suggestion: RecurringSuggestion, ledger: Ledger, currency: String) -> String? {
        guard let previous = suggestion.previousShare, let was = was(suggestion, currency: currency) else {
            return nil
        }
        let entries = suggestion.entryIds.compactMap(ledger.entry(id:))
        // Newest first: the oldest entry at the new amount after the last one at the old amount.
        guard let last = entries.firstIndex(where: { $0.share == previous }), last > 0 else { return was }
        return "\(was) until \(ScheduleText.monthName(entries[last - 1].date.month))"
    }

    /// The toast after Dismiss: "Netflix · about $16.99 every month".
    static func dismissed(_ suggestion: RecurringSuggestion, currency: String) -> String {
        "\(suggestion.title) · about \(MoneyFormat.amount(suggestion.share, currency: currency)) "
            + every(suggestion.frequency)
    }

    /// "Monthly on the 3rd", "Weekly on Wednesdays", "Yearly on March 14" (the iPad's As a schedule).
    static func repeats(_ suggestion: RecurringSuggestion) -> String {
        switch suggestion.frequency {
        case .weekly: "Weekly on \(ScheduleText.weekday(suggestion.nextDate))s"
        case .monthly: "Monthly on the \(ScheduleText.ordinal(suggestion.anchorDay))"
        case .yearly: "Yearly on \(ScheduleText.monthName(suggestion.nextDate.month)) \(suggestion.anchorDay)"
        }
    }

    static func firstDate(_ date: CalendarDate) -> String {
        DayText.date(date).formatted(.dateTime.month(.abbreviated).day().year())
    }

    static let header = "Suggested"
    static let footer =
        "Penny found these repeating in your activity. A schedule counts them in Projected; "
        + "your past entries stay as they are."
}

/// What the suggestion rows do: open the filled-in form, or dismiss (with Undo on the toast).
@MainActor
enum SuggestionActions {
    static func dismiss(_ suggestion: RecurringSuggestion, shell: ShellModel) async -> SaveFailure? {
        await shell.commit(
            .dismissSuggestion(suggestion),
            summary: ChangeSummary(
                title: "Suggestion dismissed", detail: SuggestionText.dismissed(suggestion, currency: shell.currency),
                kind: suggestion.kind, categoryId: suggestion.categoryId),
            dismissing: true)
    }
}

/// A suggestion's icon, name, kind tag and cadence, with the newest amount (and "was …").
struct SuggestionSummary: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let suggestion: RecurringSuggestion
    let ledger: Ledger

    var body: some View {
        let category = ledger.category(id: suggestion.categoryId)
        let currency = ledger.currency.rawValue
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6)) : AnyLayout(HStackLayout(spacing: 12))
        layout {
            HStack(spacing: 12) {
                CategoryIcon(
                    symbol: ScheduleText.tileSymbol(suggestion.kind, category: category),
                    color: EntryText.tileColor(suggestion.kind, category: category, id: suggestion.categoryId))
                VStack(alignment: .leading, spacing: 1) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            title.lineLimit(1)
                            SuggestionKindTag(kind: suggestion.kind).fixedSize()
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            title.lineLimit(3)
                            SuggestionKindTag(kind: suggestion.kind)
                        }
                    }
                    Text(SuggestionText.cadence(suggestion)).font(.footnote)
                        .foregroundStyle(PennyColor.secondaryLabel)
                }
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: 2) {
                let meaning = ScheduleText.sign(suggestion.kind)
                Text(MoneyFormat.signed(suggestion.share, meaning: meaning, currency: currency))
                    .font(.callout.weight(.semibold).monospacedDigit())
                    .foregroundStyle(meaning.color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityLabel(MoneyFormat.spoken(suggestion.share, meaning: meaning, currency: currency))
                if let was = SuggestionText.was(suggestion, currency: currency) {
                    Text(was).font(.caption.weight(.medium)).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
        }
    }

    private var title: some View {
        Text(suggestion.title).font(.callout.weight(.semibold)).foregroundStyle(PennyColor.label)
    }
}

/// The card's `.tag.kind`: Expense, Income or Investment, in words beside the name.
struct SuggestionKindTag: View {
    let kind: EntryKind

    var body: some View {
        Text(OrganizeText.kind(kind))
            .font(.caption.weight(.semibold))
            .foregroundStyle(PennyColor.secondaryLabel)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// The iPhone's suggestion card (`.sug`): the summary, "Seen 4 times since Aug 3", then Make it a
/// schedule and Dismiss under the text.
struct SuggestionCard: View {
    @ScaledMetric(relativeTo: .body) private var inset = 48.0
    @ScaledMetric(relativeTo: .subheadline) private var buttonHeight = 36.0
    let suggestion: RecurringSuggestion
    let ledger: Ledger
    let today: CalendarDate
    let accept: () -> Void
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SuggestionSummary(suggestion: suggestion, ledger: ledger)
                .accessibilityElement(children: .combine)
            Text(SuggestionText.seen(suggestion, today: today))
                .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                .padding(.leading, inset).padding(.top, 4)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { buttons }
                VStack(alignment: .leading, spacing: 8) { buttons }
            }
            .padding(.leading, inset).padding(.top, 12)
        }
        .padding(.top, 4).padding(.bottom, 6)
        // A container, so the row's identifier stays off its buttons.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("suggestion.\(SuggestionID.token(suggestion.id))")
    }

    @ViewBuilder private var buttons: some View {
        Button(action: accept) {
            Text("Make it a schedule")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14).frame(minHeight: buttonHeight)
                .foregroundStyle(.white)
                .background(PennyColor.tint, in: Capsule())
                // The kit's tinted capsule glows in its own color (`.tinted`: 0 8px 22px, 40%).
                .shadow(color: PennyColor.tint.opacity(0.4), radius: 11, y: 8)
        }
        .accessibilityIdentifier("suggestionAccept.\(SuggestionID.token(suggestion.id))")
        Button(action: dismiss) {
            Text("Dismiss")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14).frame(minHeight: buttonHeight)
                .foregroundStyle(PennyColor.label)
                .background(PennyColor.fill, in: Capsule())
        }
        .accessibilityHint("Hides this suggestion. You can undo it.")
        .accessibilityIdentifier("suggestionDismiss.\(SuggestionID.token(suggestion.id))")
    }
}

/// A suggestion id in an identifier: `{kind}|{key}|{frequency}` with dots and underscores, as
/// `AccessibilityID.Organize.suggestion` writes it (AccessibilityIDTests keeps the two in step).
enum SuggestionID {
    static func token(_ id: String) -> String { String(id.map { $0 == "|" ? "." : $0 == " " ? "_" : $0 }) }
}

/// No schedules and nothing to suggest (`iphone-recurring-empty`): the repeat tile, "No schedules
/// yet", New schedule, and the note that Penny suggests entries that repeat.
struct RecurringEmptyState: View {
    @ScaledMetric(relativeTo: .largeTitle) private var tile = 64.0
    let add: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "repeat")
                .font(.system(size: tile * 0.42, weight: .semibold))
                .foregroundStyle(PennyColor.tintText)
                .frame(width: tile, height: tile)
                .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: tile * 0.3, style: .continuous))
                .accessibilityHidden(true)
            Text("No schedules yet").font(.title2.weight(.bold)).multilineTextAlignment(.center)
                .padding(.top, 18)
            Text(
                "Add your pay, rent and subscriptions once. Penny records them on their date and counts them "
                    + "in Projected."
            )
            .font(.body).foregroundStyle(PennyColor.secondaryLabel).multilineTextAlignment(.center)
            .padding(.top, 8)
            Button(action: add) {
                Label("New schedule", systemImage: "plus")
                    .font(.body.weight(.semibold))
                    .padding(.horizontal, 20).frame(minHeight: 44)
                    .foregroundStyle(.white)
                    .background(PennyColor.tint, in: Capsule())
            }
            .buttonStyle(.pennyPress)
            .padding(.top, 24)
            .accessibilityIdentifier("recurring.emptyAdd")
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "clock").font(.body).foregroundStyle(PennyColor.secondaryLabel)
                    .accessibilityHidden(true)
                Text(
                    "When an expense or income repeats in your activity, with the same name and a steady amount, "
                        + "Penny suggests it here."
                )
                .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)
            .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.top, 30)
        }
        .frame(maxWidth: 420)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("recurring.empty")
    }
}

/// The iPad detail pane beside Recurring (`ipad-recurring-suggested`): the suggestion's tile,
/// name and kind, the amount and cadence, what was seen, Make it a schedule and Dismiss, the
/// matched entries, and what the schedule would be.
struct SuggestionDetailPane: View {
    let suggestion: RecurringSuggestion
    let ledger: Ledger
    let today: CalendarDate
    let accept: () -> Void
    let dismiss: () -> Void

    var body: some View {
        let category = ledger.category(id: suggestion.categoryId)
        let currency = ledger.currency.rawValue
        let meaning = ScheduleText.sign(suggestion.kind)
        let account = suggestion.accountId.flatMap(ledger.account(id:))
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 16) {
                    CategoryIcon(
                        symbol: ScheduleText.tileSymbol(suggestion.kind, category: category),
                        color: EntryText.tileColor(suggestion.kind, category: category, id: suggestion.categoryId),
                        size: 56)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(suggestion.title).font(.title.weight(.bold))
                        Text(
                            "Suggested \(OrganizeText.kind(suggestion.kind).lowercased())"
                                + (category.map { " · \($0.name)" } ?? "")
                        )
                        .font(.body).foregroundStyle(PennyColor.secondaryLabel)
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(MoneyFormat.signed(suggestion.share, meaning: meaning, currency: currency))
                        .font(.system(size: 56, weight: .bold).monospacedDigit())
                        .foregroundStyle(meaning.color)
                        .minimumScaleFactor(0.5).lineLimit(1)
                    Text(SuggestionText.every(suggestion.frequency)).font(.title3)
                        .foregroundStyle(PennyColor.secondaryLabel)
                }
                .padding(.top, 18)
                .accessibilityElement(children: .combine)
                Text(
                    ([SuggestionText.seen(suggestion, today: today)]
                        + [SuggestionText.wasUntil(suggestion, ledger: ledger, currency: currency)].compactMap { $0 })
                        .joined(separator: " · ")
                )
                .font(.body).foregroundStyle(PennyColor.secondaryLabel)
                .padding(.top, 4)
                HStack(spacing: 12) {
                    Button(action: accept) {
                        Label("Make it a schedule", systemImage: "repeat")
                            .font(.body.weight(.semibold))
                            .padding(.horizontal, 18).frame(minHeight: 44)
                            .foregroundStyle(.white).background(PennyColor.tint, in: Capsule())
                            .shadow(color: PennyColor.tint.opacity(0.4), radius: 11, y: 8)
                    }
                    .accessibilityIdentifier("suggestionAccept.\(SuggestionID.token(suggestion.id))")
                    Button(action: dismiss) {
                        Text("Dismiss")
                            .font(.body.weight(.semibold))
                            .padding(.horizontal, 18).frame(minHeight: 44)
                            .foregroundStyle(PennyColor.label).background(PennyColor.surface, in: Capsule())
                    }
                    .accessibilityHint("Hides this suggestion. You can undo it.")
                    .accessibilityIdentifier("suggestionDismiss.\(SuggestionID.token(suggestion.id))")
                }
                .buttonStyle(.pennyPress)
                .padding(.top, 22)
                PaneCard {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Already in your activity").font(.title3.weight(.semibold))
                        Spacer()
                        Text("\(suggestion.count) entries").foregroundStyle(PennyColor.secondaryLabel)
                    }
                    .padding(.bottom, 6)
                    let entries = suggestion.entryIds.compactMap(ledger.entry(id:))
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { Divider() }
                        MatchedEntryRow(entry: entry, currency: currency, today: today)
                    }
                }
                .padding(.top, 22)
                PaneCard {
                    Text("As a schedule").font(.title3.weight(.semibold)).padding(.bottom, 6)
                    PaneRow("Repeats", SuggestionText.repeats(suggestion))
                    Divider()
                    PaneRow("First date", SuggestionText.firstDate(suggestion.nextDate))
                    Divider()
                    PaneRow("Account", account?.name ?? "None")
                    Text(
                        "A schedule counts \(suggestion.title) in Projected. The entries you already have stay "
                            + "as they are."
                    )
                    .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    .padding(.top, 10)
                }
                .padding(.top, 16)
            }
            .padding(.horizontal, 28).padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("screen.suggestion")
        }
        .heroGlow()
    }
}

private struct PaneCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.horizontal, 20).padding(.vertical, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

private struct PaneRow: View {
    let label: String
    let value: String

    init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
    }

    var body: some View {
        HStack {
            Text(label).foregroundStyle(PennyColor.secondaryLabel)
            Spacer()
            Text(value).fontWeight(.semibold)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

/// One matched entry, read-only: "Nov 3", its name and amount.
struct MatchedEntryRow: View {
    @ScaledMetric(relativeTo: .body) private var dateWidth = 64.0
    let entry: LedgerEntry
    let currency: String
    let today: CalendarDate

    var body: some View {
        let meaning = ScheduleText.sign(entry.kind)
        HStack(spacing: 12) {
            Text(SuggestionText.day(entry.date, today: today)).foregroundStyle(PennyColor.secondaryLabel)
                .frame(minWidth: dateWidth, alignment: .leading)
            Text(entry.title).lineLimit(1)
            Spacer(minLength: 8)
            Text(MoneyFormat.signed(entry.share, meaning: meaning, currency: currency))
                .fontWeight(.semibold).monospacedDigit()
                .foregroundStyle(meaning.color)
                .accessibilityLabel(MoneyFormat.spoken(entry.share, meaning: meaning, currency: currency))
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
