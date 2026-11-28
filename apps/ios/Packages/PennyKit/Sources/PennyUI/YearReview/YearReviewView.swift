import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The year in review (MAZ-292, phase 2; `iphone-year-review`, `-trips`, `-shared` and `-facts`
/// cards): four pages in a full-screen cover, opened from the Insights card or the January banner.
/// Every number comes from `LedgerReport.yearReview` (the shared rule); the pages add only the
/// names of trips and households, from the ledger and the households Penny already loads. A
/// deleted payer reads "Former member", never their email. On iPad the iPhone layout shows,
/// centered, as the recap does.
///
/// Motion (docs/design/motion.md §7): a tap on the trailing side, or a swipe, goes to the next page;
/// the leading side to the previous one. The page fades out (`quick`) and the next fades in sliding
/// `shift` from the trailing edge (the previous from the leading edge), and its progress segment
/// fills (`standard`). A swipe follows the finger first. Pages never advance on their own. The first
/// time a page appears its numbers count up and its bars fill (`emphasized`). Under Reduce Motion
/// pages crossfade (`quick`), segments change at once, numbers and bars show their final values,
/// and the swipe doesn't follow the finger. Each page change plays a selection haptic.
struct YearReviewView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    let year: Int
    @State private var page: YearReviewText.Page = .categories
    /// The way the last page change went, for the side the new page comes from.
    @State private var forward = true
    /// Pages that have appeared, so their numbers count and their bars fill only the first time.
    @State private var shown: Set<YearReviewText.Page> = []
    /// The page following the finger during a swipe.
    @State private var dragOffset: CGFloat = 0
    @State private var sharing = false
    /// Bumped when Share your year opens, for its light impact.
    @State private var shareOpens = 0

    var body: some View {
        WorkspaceContent { ledger in
            let report = shell.report(ledger)
            let review = report.yearReview(year, today: shell.today, households: shell.yearReviewHouseholds)
            let currency = ledger.currency.rawValue
            content(review, ledger: ledger, currency: currency)
                .sheet(isPresented: $sharing) {
                    YearShareSheet(review: review, currency: currency).environment(shell)
                }
        }
        .background {
            PennyColor.background
                .overlay(alignment: .top) {
                    HeroGlow().frame(height: GlowBlob.height).padding(.horizontal, -80).offset(y: -160)
                }
                .ignoresSafeArea()
        }
        .pennyHaptic(.pageYearReview, trigger: page)
        .pennyHaptic(.openShare, trigger: shareOpens)
        .task { await shell.refreshYear(year) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.yearReview")
    }

    private func content(_ review: YearReview, ledger: Ledger, currency: String) -> some View {
        VStack(spacing: 0) {
            header
            ZStack(alignment: .top) {
                pageView(page, review: review, ledger: ledger, currency: currency)
                    .id(page)
                    .offset(x: dragOffset)
                    .transition(
                        Motion.monthTransition(
                            earlier: !forward, layoutDirection: layoutDirection, reduceMotion: reduceMotion))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .clipped()
            .simultaneousGesture(swipe)
            footer
        }
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
    }

    // MARK: Header and footer

    private var header: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 5) {
                ForEach(YearReviewText.Page.allCases, id: \.self) { item in
                    Capsule()
                        .fill(item.rawValue <= page.rawValue ? PennyColor.label : PennyColor.fill)
                        .frame(height: 3)
                }
            }
            .padding(.horizontal, 6)
            .animation(Motion.movement(.standard, reduceMotion: reduceMotion), value: page)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Page")
            .accessibilityValue("\(page.rawValue + 1) of \(YearReviewText.Page.allCases.count)")
            .accessibilityIdentifier("yearReview.progress")
            HStack {
                Text(YearReviewText.eyebrow(year))
                    .font(.footnote.weight(.semibold))
                    .kerning(0.5)
                    .textCase(.uppercase)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .padding(.leading, 6)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Button {
                    shell.yearReview = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(PennyColor.label)
                        .frame(width: ControlSize.glassButton, height: ControlSize.glassButton)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .pennyGlass(in: Circle())
                .accessibilityLabel("Close")
                .accessibilityIdentifier("yearReview.close")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }

    private var footer: some View {
        VStack(spacing: 12) {
            Text(page == .facts ? YearReviewText.lastPage : YearReviewText.tapForNext)
                .font(.footnote)
                .foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityHidden(true)
            Button {
                shareOpens += 1
                sharing = true
            } label: {
                Label("Share your year", systemImage: "square.and.arrow.up")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .pennyGlass(in: Capsule(), tinted: true)
            .accessibilityHint("Makes an image of your year to share")
            .accessibilityIdentifier("yearReview.share")
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    // MARK: Paging

    private func go(by step: Int) {
        guard let next = YearReviewText.Page(rawValue: page.rawValue + step) else {
            withAnimation(Motion.movement(.standard, reduceMotion: reduceMotion)) { dragOffset = 0 }
            return
        }
        forward = step > 0
        dragOffset = 0
        withAnimation(Motion.animation(.emphasized, reduceMotion: reduceMotion)) { page = next }
    }

    /// A horizontal swipe: the page follows the finger, then goes on or springs back.
    private var swipe: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                guard !reduceMotion, abs(value.translation.width) > abs(value.translation.height) else { return }
                var offset = value.translation.width
                // No page past the first or the last: the page resists.
                let toward = step(for: offset)
                if YearReviewText.Page(rawValue: page.rawValue + toward) == nil { offset /= 3 }
                dragOffset = offset
            }
            .onEnded { value in
                let width = value.translation.width
                guard abs(width) > abs(value.translation.height),
                    abs(width) > 60 || abs(value.predictedEndTranslation.width) > 160
                else {
                    withAnimation(Motion.movement(.standard, reduceMotion: reduceMotion)) { dragOffset = 0 }
                    return
                }
                go(by: step(for: width))
            }
    }

    /// A finger moving toward the leading edge goes forward (the trailing edge in right to left).
    private func step(for translation: CGFloat) -> Int {
        let towardLeft = translation < 0
        return towardLeft == (layoutDirection == .leftToRight) ? 1 : -1
    }

    /// A tap: the leading third goes back, the rest goes on.
    private func tap(at location: CGPoint, width: CGFloat) {
        let fromLeading = layoutDirection == .leftToRight ? location.x : width - location.x
        go(by: fromLeading < width / 3 ? -1 : 1)
    }

    private func progress(_ page: YearReviewText.Page) -> Double {
        reduceMotion || shown.contains(page) ? 1 : 0
    }

    // MARK: Pages

    @ViewBuilder
    private func pageView(_ page: YearReviewText.Page, review: YearReview, ledger: Ledger, currency: String)
        -> some View
    {
        let progress = progress(page)
        GeometryReader { proxy in
            ScrollView {
                Group {
                    switch page {
                    case .categories:
                        YearCategoriesPage(review: review, currency: currency, progress: progress)
                    case .trips:
                        YearTripsPage(
                            review: review, currency: currency, progress: progress, today: shell.today,
                            name: { tripName($0, review: review, ledger: ledger) })
                    case .shared:
                        YearSharedPage(
                            review: review, currency: currency, progress: progress, you: shell.accountFace,
                            householdName: householdName)
                    case .facts:
                        YearFactsPage(review: review, progress: progress)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 22)
                .padding(.bottom, 16)
                .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .topLeading)
                .contentShape(Rectangle())
                .onTapGesture(coordinateSpace: .local) { location in tap(at: location, width: proxy.size.width) }
            }
            .scrollBounceBehavior(.basedOnSize)
            .accessibilityActions {
                if page != .facts { Button("Next page") { go(by: 1) } }
                if page != .categories { Button("Previous page") { go(by: -1) } }
            }
            .accessibilityIdentifier("yearReview.page.\(page.name)")
        }
        .onAppear {
            withAnimation(Motion.movement(.emphasized, reduceMotion: reduceMotion)) { _ = shown.insert(page) }
        }
    }

    /// A trip's name: the personal trip's, or the shared trip's household name.
    private func tripName(_ id: String, review: YearReview, ledger: Ledger) -> String? {
        guard let trip = review.trips.list.first(where: { $0.id == id }) else { return nil }
        switch trip.kind {
        case .personal: return ledger.trips.first { $0.id == id }?.name
        case .shared: return householdName(id)
        }
    }

    private func householdName(_ id: String) -> String? {
        shell.households.households.first { $0.id == id }?.name
    }
}

// MARK: - Shared parts

/// A page's title and the line under it.
private struct YearPageTitle: View {
    let title: Text
    let lede: Text?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            title
                .font(.largeTitle.weight(.bold))
                .kerning(-1)
                .foregroundStyle(PennyColor.label)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let lede {
                lede
                    .font(.callout)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A row with a leading mark, a name and value on one line, and a bar under them.
private struct YearBarRow<Leading: View>: View {
    let name: String
    let value: String
    /// 0 to 1, already scaled by the page's progress.
    let fraction: Double
    let color: Color
    @ViewBuilder var leading: () -> Leading

    var body: some View {
        HStack(spacing: 12) {
            leading()
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(name).lineLimit(2)
                    Spacer(minLength: 8)
                    Text(value).monospacedDigit()
                }
                .font(.body.weight(.semibold))
                .foregroundStyle(PennyColor.label)
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(PennyColor.fill)
                        Capsule().fill(color)
                            .frame(width: fraction > 0 ? max(6, proxy.size.width * min(fraction, 1)) : 0)
                    }
                }
                .frame(height: 6)
                .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private func scaled(_ value: Int64, _ progress: Double) -> Int64 { Int64((Double(value) * progress).rounded()) }
private func scaled(_ value: Int, _ progress: Double) -> Int { Int((Double(value) * progress).rounded()) }

// MARK: - Categories and the busiest month

/// "Home took the biggest share of your year": the year's total, the top categories with their
/// shares, and the busiest month among the twelve.
struct YearCategoriesPage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let review: YearReview
    let currency: String
    let progress: Double

    var body: some View {
        let lede = YearReviewText.spentLede(review.year)
        let total = scaled(review.spent, progress)
        let amount = Text(MoneyFormat.whole(total, currency: currency)).fontWeight(.semibold)
            .foregroundStyle(PennyColor.label)
        VStack(alignment: .leading, spacing: 0) {
            YearPageTitle(
                title: Text(YearReviewText.leadTitle(review)), lede: Text("\(lede.lead)\(amount)\(lede.rest)")
            )
            .pennyCounting(Double(total))
            .accessibilityElement(children: .combine)
            .accessibilityValue(MoneyFormat.whole(review.spent, currency: currency))
            .accessibilityIdentifier("yearReview.total")
            VStack(spacing: 14) {
                ForEach(Array(review.topCategories.prefix(4).enumerated()), id: \.element.key) { index, category in
                    let color = PennyColor.category(CategoryStyle.tint(forCategoryID: "", hex: category.color))
                    YearBarRow(
                        name: category.name, value: "\(scaled(category.share, progress))%",
                        fraction: Double(category.share) / 100 * progress, color: color
                    ) {
                        HStack(spacing: 12) {
                            Text("\(index + 1)")
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(PennyColor.secondaryLabel)
                                .frame(minWidth: 18)
                            CategoryIcon(
                                symbol: CategoryStyle.symbol(forIonicon: category.icon), color: color, size: 34)
                        }
                    }
                    .pennyCounting(Double(scaled(category.share, progress)))
                    .accessibilityIdentifier("yearReview.category.\(OverviewText.identifier(category.key))")
                }
            }
            .padding(.top, 22)
            if let title = YearReviewText.busiestTitle(review), let busiest = review.busiestMonth {
                BusiestMonthPanel(
                    title: title, amount: MoneyFormat.whole(busiest.spent, currency: currency), review: review,
                    progress: progress
                )
                .padding(.top, 22)
            }
        }
        .animation(Motion.movement(.emphasized, reduceMotion: reduceMotion), value: progress)
    }
}

/// "Busiest month: December" with the twelve months as columns, the busiest in copper.
private struct BusiestMonthPanel: View {
    let title: String
    let amount: String
    let review: YearReview
    let progress: Double

    var body: some View {
        let most = Double(max(review.months.map(\.spent).max() ?? 0, 1))
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.body.weight(.semibold)).foregroundStyle(PennyColor.label)
                Spacer(minLength: 8)
                Text(amount).font(.subheadline.monospacedDigit()).foregroundStyle(PennyColor.secondaryLabel)
            }
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(review.months, id: \.month) { month in
                    let busiest = month.month == review.busiestMonth?.month
                    VStack(spacing: 5) {
                        UnevenRoundedRectangle(
                            topLeadingRadius: 4, bottomLeadingRadius: 2, bottomTrailingRadius: 2, topTrailingRadius: 4,
                            style: .continuous
                        )
                        .fill(busiest ? PennyColor.tint : PennyColor.label.opacity(0.22))
                        .frame(height: month.spent > 0 ? max(4, 56 * Double(month.spent) / most * progress) : 0)
                        .frame(height: 56, alignment: .bottom)
                        Text(YearReviewText.monthLetter(month.month))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(busiest ? PennyColor.tintText : PennyColor.secondaryLabel)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .accessibilityHidden(true)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(amount)
        .accessibilityIdentifier("yearReview.months")
    }
}

// MARK: - Trips

/// "3 trips, 14 days away": days away and your share on trips, then each trip with its dates, who
/// it was shared with, your share and its days.
struct YearTripsPage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let review: YearReview
    let currency: String
    let progress: Double
    let today: CalendarDate
    let name: (String) -> String?

    var body: some View {
        let days = scaled(review.trips.daysAway, progress)
        VStack(alignment: .leading, spacing: 0) {
            YearPageTitle(
                title: Text(
                    YearReviewText.tripsTitle(
                        review, trips: scaled(review.trips.list.count, progress), days: days)),
                lede: YearReviewText.tripsLede(review, name: name).map { Text($0) }
            )
            .pennyCounting(Double(days))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(YearReviewText.tripsTitle(review))
            if !review.trips.list.isEmpty {
                HStack(spacing: 12) {
                    stat("\(days)", caption: review.trips.daysAway == 1 ? "day away" : "days away", value: Double(days))
                        .accessibilityLabel("\(review.trips.daysAway) days away")
                        .accessibilityIdentifier("yearReview.daysAway")
                    let share = scaled(review.trips.share, progress)
                    stat(
                        MoneyFormat.whole(share, currency: currency), caption: "your share on trips",
                        value: Double(share)
                    )
                    .accessibilityLabel(
                        "\(MoneyFormat.whole(review.trips.share, currency: currency)), your share on trips"
                    )
                    .accessibilityIdentifier("yearReview.tripShare")
                }
                .padding(.top, 22)
                VStack(spacing: 0) {
                    ForEach(review.trips.list, id: \.id) { trip in
                        row(trip, divider: trip.id != review.trips.list.last?.id)
                    }
                }
                .background(
                    PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                )
                .padding(.top, 12)
            }
        }
        .animation(Motion.movement(.emphasized, reduceMotion: reduceMotion), value: progress)
    }

    private func stat(_ text: String, caption: String, value: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(text)
                .font(.title.weight(.bold))
                .kerning(-0.8)
                .foregroundStyle(PennyColor.label)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .pennyCounting(value)
            Text(caption).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .ignore)
    }

    private func row(_ trip: YearReview.Trip, divider: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                CategoryIcon.neutral(symbol: "airplane")
                VStack(alignment: .leading, spacing: 1) {
                    Text(name(trip.id) ?? "Trip").font(.body.weight(.semibold)).foregroundStyle(PennyColor.label)
                    Text(YearReviewText.tripLine(trip, today: today))
                        .font(.footnote)
                        .foregroundStyle(PennyColor.secondaryLabel)
                }
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(MoneyFormat.whole(trip.share, currency: currency))
                        .font(.body.weight(.semibold).monospacedDigit())
                        .foregroundStyle(PennyColor.label)
                    Text(YearReviewText.plural(trip.days, "day", "days"))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(PennyColor.secondaryLabel)
                }
                .fixedSize()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .frame(minHeight: ControlSize.row)
            if divider { Divider().padding(.leading, 64) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("yearReview.trip.\(OverviewText.identifier(trip.id))")
    }
}

// MARK: - Shared expenses

/// "You paid for 41 shared expenses": shared expenses counted by who paid, with bars on one scale
/// (the year's shared expenses), and what others paid of the ones you split.
struct YearSharedPage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let review: YearReview
    let currency: String
    let progress: Double
    /// Your picture or monogram.
    let you: PersonFace
    let householdName: (String) -> String?

    var body: some View {
        let yours = scaled(YearReviewText.yourCount(review), progress)
        VStack(alignment: .leading, spacing: 0) {
            YearPageTitle(
                title: Text(YearReviewText.sharedTitle(review, count: yours)),
                lede: YearReviewText.sharedLede(review, householdName: householdName).map { Text($0) }
            )
            .pennyCounting(Double(yours))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(YearReviewText.sharedTitle(review))
            if review.shared.count > 0 {
                VStack(spacing: 14) {
                    ForEach(review.shared.payers, id: \.key) { payer in
                        let count = scaled(payer.count, progress)
                        YearBarRow(
                            name: YearReviewText.payerName(payer), value: "\(count)",
                            fraction: Double(payer.count) / Double(max(review.shared.count, 1)) * progress,
                            color: payer.isYou ? PennyColor.tint : PennyColor.label.opacity(0.55)
                        ) {
                            avatar(payer)
                        }
                        .pennyCounting(Double(count))
                        .accessibilityIdentifier("yearReview.payer.\(OverviewText.identifier(payer.key))")
                    }
                }
                .padding(.top, 22)
                let foot = YearReviewText.sharedFoot(review)
                Group {
                    if let others = foot.othersPaid {
                        let amount = Text(MoneyFormat.whole(others, currency: currency)).fontWeight(.semibold)
                            .foregroundStyle(PennyColor.label)
                        Text("\(foot.counted) Others paid \(amount) of the ones you split.")
                    } else {
                        Text(foot.counted)
                    }
                }
                .font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 20)
                .accessibilityIdentifier("yearReview.sharedFoot")
            }
        }
        .animation(Motion.movement(.emphasized, reduceMotion: reduceMotion), value: progress)
    }

    @ViewBuilder
    private func avatar(_ payer: YearReview.Payer) -> some View {
        if payer.isYou {
            Text(you.initials)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Color.white)
                .frame(width: 34, height: 34)
                .background(PennyColor.tint, in: Circle())
                .accessibilityHidden(true)
        } else if let name = payer.name, name != HouseholdPeople.formerMember {
            Monogram(initials: HouseholdPeople.initials(name: name), size: 34)
        } else {
            Image(systemName: "person.2")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(PennyColor.secondaryLabel)
                .frame(width: 34, height: 34)
                .background(PennyColor.fill, in: Circle())
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Fun facts

/// "A few things about your year": days without spending, the longest run of them, expenses
/// recorded, the busiest weekday and the category that came up most often. Nothing from an
/// entry's text.
struct YearFactsPage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let review: YearReview
    let progress: Double

    var body: some View {
        let facts = YearReviewText.facts(review)
        VStack(alignment: .leading, spacing: 0) {
            YearPageTitle(title: Text(YearReviewText.factsTitle), lede: nil)
            Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                ForEach(Array(stride(from: 0, to: facts.count, by: 2)), id: \.self) { index in
                    GridRow {
                        tile(facts[index])
                        if index + 1 < facts.count {
                            tile(facts[index + 1])
                        } else {
                            Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                        }
                    }
                }
                if let category = review.facts.mostFrequentCategory {
                    GridRow {
                        frequent(category).gridCellColumns(2)
                    }
                }
            }
            // Each row as tall as its tallest tile, never stretched to fill the page.
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 22)
        }
        .animation(Motion.movement(.emphasized, reduceMotion: reduceMotion), value: progress)
    }

    private func tile(_ fact: YearReviewText.Fact) -> some View {
        let value: String =
            if let count = fact.count {
                fact.value.replacingOccurrences(of: "\(count)", with: "\(scaled(count, progress))")
            } else {
                fact.value
            }
        return VStack(alignment: .leading, spacing: 0) {
            Image(systemName: fact.symbol)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(PennyColor.tint)
                .frame(width: 34, height: 34)
                .background(
                    PaletteToken.tintSoft.value.color, in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .accessibilityHidden(true)
            Spacer(minLength: 12)
            Text(value)
                .font(.title.weight(.bold))
                .kerning(-0.8)
                .foregroundStyle(PennyColor.label)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .pennyCounting(Double(fact.count.map { scaled($0, progress) } ?? 0))
            Text(fact.caption)
                .font(.footnote)
                .foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, minHeight: 128, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(fact.value), \(fact.caption)")
        .accessibilityIdentifier("yearReview.fact.\(fact.key)")
    }

    private func frequent(_ category: YearReview.FrequentCategory) -> some View {
        HStack(spacing: 14) {
            CategoryIcon(
                symbol: CategoryStyle.symbol(forIonicon: category.icon),
                color: PennyColor.category(CategoryStyle.tint(forCategoryID: "", hex: category.color)))
            VStack(alignment: .leading, spacing: 4) {
                Text(category.name)
                    .font(.title3.weight(.bold))
                    .kerning(-0.5)
                    .foregroundStyle(PennyColor.label)
                Text(YearReviewText.frequentCaption(category))
                    .font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("yearReview.fact.category")
    }
}
