import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// What the recap banner offers: last month's recap, or in January last year's review (MAZ-292).
enum RecapBannerItem: Hashable {
    case month(MonthKey)
    case year(Int)
}

/// "Your October recap is ready" (`iphone-home-recap`, `iphone-insights-recap` cards, MAZ-292): on
/// Home and Insights during the first 7 days of a month, when last month's recap isn't empty,
/// until it's dismissed on this device. The banner opens the recap; its close button dismisses it.
/// In January the same banner offers last year's review instead ("Your 2026 in review is ready"),
/// opening it in a full-screen cover; it has no card of its own.
///
/// Motion (docs/design/motion.md §7): it arrives sliding down `nudge` and fading in while the
/// content below makes room (the parent animates `item`); dismissed, it fades out (`quick`, exit),
/// then the space closes (`standard`). Under Reduce Motion it fades in and out (`quick`) and the
/// space opens and closes at once. Dismissing plays a light impact; opening a selection.
struct RecapBanner: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The banner on show, from `MonthlyRecap.banner`; nil hides it.
    let item: RecapBannerItem?
    /// The banner fading out after its close button.
    @State private var closing: RecapBannerItem?
    @State private var dismissals = 0

    var body: some View {
        Group {
            if let item {
                banner(item)
                    .opacity(closing == item ? 0 : 1)
                    // In: down `nudge` and a fade. Out: it has already faded, so only the space closes.
                    .transition(
                        .asymmetric(
                            insertion: Motion.transition(edge: .top, reduceMotion: reduceMotion), removal: .identity))
            }
        }
        .pennyHaptic(.dismissRecap, trigger: dismissals)
    }

    private func banner(_ item: RecapBannerItem) -> some View {
        let isYear: Bool
        if case .year = item { isYear = true } else { isYear = false }
        return HStack(alignment: .center, spacing: 12) {
            Button {
                open(item)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(PennyColor.tint)
                        .frame(width: 40, height: 40)
                        .background(
                            PaletteToken.tintSoft.value.color,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                        )
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Self.title(item))
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(PennyColor.label)
                        Text(isYear ? YearReviewText.bannerMessage : RecapText.bannerMessage)
                            .font(.footnote)
                            .foregroundStyle(PennyColor.secondaryLabel)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.forward")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(PennyColor.tertiaryLabel)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.pennyPress)
            .accessibilityElement(children: .combine)
            .accessibilityHint(isYear ? "Opens your year in review" : "Opens the recap")
            .accessibilityIdentifier(isYear ? "home.yearReviewBanner" : "home.recapBanner")
            Button {
                close(item)
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .frame(width: 28, height: 28)
                    .background(PennyColor.fill, in: Circle())
                    // A 44-point tap area around the 28-point circle.
                    .contentShape(Rectangle().inset(by: -8))
            }
            .buttonStyle(.plain)
            .frame(maxHeight: .infinity, alignment: .top)
            .accessibilityLabel("Dismiss")
            .accessibilityHint(isYear ? "Hides this year's review banner" : "Hides this month's recap banner")
            .accessibilityIdentifier(isYear ? "home.yearReviewBannerDismiss" : "home.recapBannerDismiss")
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .padding(.vertical, 14)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    static func title(_ item: RecapBannerItem) -> String {
        switch item {
        case .month(let month): RecapText.bannerTitle(month)
        case .year(let year): YearReviewText.bannerTitle(year)
        }
    }

    private func open(_ item: RecapBannerItem) {
        switch item {
        case .month(let month): shell.openRecap(month)
        case .year(let year): shell.openYearReview(year)
        }
    }

    /// Fades the banner out, then closes its space, and keeps it dismissed for that month or year.
    private func close(_ item: RecapBannerItem) {
        dismissals += 1
        withAnimation(Motion.animation(.quick, exit: true, reduceMotion: reduceMotion)) { closing = item }
        Task {
            try? await Task.sleep(for: .seconds(Motion.Duration.quick.rawValue))
            withAnimation(Motion.movement(.standard, reduceMotion: reduceMotion)) {
                switch item {
                case .month(let month): shell.dismissRecapBanner(month)
                case .year(let year): shell.dismissYearReviewBanner(year)
                }
            }
        }
    }
}
