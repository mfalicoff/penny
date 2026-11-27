import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// "Your October recap is ready" (`iphone-home-recap`, `iphone-insights-recap` cards, MAZ-292): on
/// Home and Insights during the first 7 days of a month, when last month's recap isn't empty,
/// until it's dismissed on this device. The banner opens the recap; its close button dismisses it.
///
/// Motion (docs/design/motion.md §7): it arrives sliding down `nudge` and fading in while the
/// content below makes room (the parent animates `month`); dismissed, it fades out (`quick`, exit),
/// then the space closes (`standard`). Under Reduce Motion it fades in and out (`quick`) and the
/// space opens and closes at once. Dismissing plays a light impact; opening the recap a selection.
struct RecapBanner: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The month on show, from `MonthlyRecap.bannerMonth`; nil hides the banner.
    let month: MonthKey?
    /// The month whose banner is fading out after its close button.
    @State private var closing: MonthKey?
    @State private var dismissals = 0

    var body: some View {
        Group {
            if let month {
                banner(month)
                    .opacity(closing == month ? 0 : 1)
                    // In: down `nudge` and a fade. Out: it has already faded, so only the space closes.
                    .transition(
                        .asymmetric(
                            insertion: Motion.transition(edge: .top, reduceMotion: reduceMotion), removal: .identity))
            }
        }
        .pennyHaptic(.dismissRecap, trigger: dismissals)
    }

    private func banner(_ month: MonthKey) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Button {
                shell.openRecap(month)
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
                        Text(RecapText.bannerTitle(month))
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(PennyColor.label)
                        Text(RecapText.bannerMessage)
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
            .accessibilityHint("Opens the recap")
            .accessibilityIdentifier("home.recapBanner")
            Button {
                close(month)
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
            .accessibilityHint("Hides this month's recap banner")
            .accessibilityIdentifier("home.recapBannerDismiss")
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .padding(.vertical, 14)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    /// Fades the banner out, then closes its space, and keeps it dismissed for that month.
    private func close(_ month: MonthKey) {
        dismissals += 1
        withAnimation(Motion.animation(.quick, exit: true, reduceMotion: reduceMotion)) { closing = month }
        Task {
            try? await Task.sleep(for: .seconds(Motion.Duration.quick.rawValue))
            withAnimation(Motion.movement(.standard, reduceMotion: reduceMotion)) {
                shell.dismissRecapBanner(month)
            }
        }
    }
}
