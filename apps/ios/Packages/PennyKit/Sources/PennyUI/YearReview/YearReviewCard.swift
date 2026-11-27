import PennyDesign
import PennyDomain
import SwiftUI

/// "2026 in review · Your year in Penny" (`iphone-insights-year-review`, MAZ-292): Insights' entry
/// to the year in review from December 26 to January 31, above the month's summary, on the copper
/// glow the card draws. The whole card opens the year in review (a selection haptic, from the shell).
/// It arrives and leaves with the page's content (the parent animates `year`).
struct YearReviewCard: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The year offered (`YearReviewText.offeredYear`); nil hides the card.
    let year: Int?

    var body: some View {
        if let year {
            Button {
                shell.openYearReview(year)
            } label: {
                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(YearReviewText.eyebrow(year))
                            .font(.caption.weight(.semibold))
                            .kerning(0.5)
                            .textCase(.uppercase)
                            .foregroundStyle(PennyColor.tintText)
                        Text(YearReviewText.cardTitle)
                            .font(.title3.weight(.bold))
                            .kerning(-0.4)
                            .foregroundStyle(PennyColor.label)
                        Text(YearReviewText.cardMessage)
                            .font(.subheadline)
                            .foregroundStyle(PennyColor.secondaryLabel)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.white)
                        .frame(width: 40, height: 40)
                        .background(PennyColor.tint, in: Circle())
                        .accessibilityHidden(true)
                }
                .padding(EdgeInsets(top: 16, leading: 18, bottom: 16, trailing: 16))
                .background {
                    ZStack(alignment: .top) {
                        PennyColor.surface
                        // The card's glow: blurred copper and amber, drawn behind its text.
                        HeroGlow(opacity: 0.8, blur: 34).frame(height: 220).padding(.horizontal, -40).offset(y: -90)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
            }
            .buttonStyle(.pennyPress)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Opens your year in review")
            .accessibilityIdentifier("insights.yearReview")
            .transition(Motion.transition(edge: .top, reduceMotion: reduceMotion))
        }
    }
}

extension View {
    /// Presents the year in review over everything: a full-screen cover on iOS (a sheet on the
    /// macOS test host).
    func yearReviewCover<Content: View>(
        _ item: Binding<YearReviewRequest?>, @ViewBuilder content: @escaping (YearReviewRequest) -> Content
    ) -> some View {
        #if os(iOS)
            fullScreenCover(item: item, content: content)
        #else
            sheet(item: item, content: content)
        #endif
    }
}
