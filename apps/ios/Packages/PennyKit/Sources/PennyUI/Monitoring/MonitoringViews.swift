import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The words of the crash and performance report screens (MAZ-129), from the
/// `iphone-monitoring-prompt` and `iphone-privacy` cards.
enum MonitoringText {
    static let promptTitle = "Help fix problems faster?"
    static func promptLede(host: String) -> String {
        "\(host) can collect crash reports and how long screens take to load, so its operator can find and fix problems."
    }
    static let collected = "Crashes, errors and loading times"
    static let collectedDetail = "With the device model and app version"
    static let neverCollected = "Never your entries, amounts, titles, notes, names, emails or searches"
    static let share = "Share reports"
    static let decline = "Don't share"
    static let promptFooter = "Off until you choose. Change it anytime in Settings › Privacy."

    static func reportsHeader(host: String) -> String { "Reports to \(host)" }
    static let crashes = "Share crash reports"
    static let crashesDetail = "Crashes and errors, with the device model and app version"
    static let performance = "Share performance data"
    static let performanceDetail = "How long screens and requests take"
    static let never =
        "Reports never include your entries, amounts, titles, notes, names, emails or searches. "
        + "The sample data never sends reports."
    static let policies = "Policies"
    static let policyFooter = "Opens in Safari. Your server's operator publishes it."
}

/// "Help fix problems faster?" (`iphone-monitoring-prompt` card): asked once per install, over
/// Home after sign-in, when the server takes reports. Share reports turns on crash reports and
/// performance data; Don't share keeps both off. Either answer is final until Settings › Privacy.
struct MonitoringPromptSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(ClientTelemetry.self) private var telemetry
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .title) private var iconSize = 52

    var body: some View {
        let host = shell.account.map { ServerText.host($0.server) } ?? ""
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: iconSize * 0.54, weight: .medium))
                    .foregroundStyle(PennyColor.tint)
                    .frame(width: iconSize, height: iconSize)
                    .background(
                        PaletteToken.tintSoft.value.color,
                        in: RoundedRectangle(cornerRadius: iconSize * 0.31, style: .continuous)
                    )
                    .accessibilityHidden(true)
                Text(MonitoringText.promptTitle)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(PennyColor.label)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 14)
                    .accessibilityAddTraits(.isHeader)
                Text(MonitoringText.promptLede(host: host))
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
                VStack(spacing: 0) {
                    item(symbol: "checkmark", style: PennyColor.label) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(MonitoringText.collected)
                            Text(MonitoringText.collectedDetail).font(.footnote)
                                .foregroundStyle(PennyColor.secondaryLabel)
                        }
                    }
                    Divider().overlay(PennyColor.separator).padding(.leading, 44)
                    item(symbol: "xmark", style: PennyColor.secondaryLabel) {
                        Text(MonitoringText.neverCollected)
                    }
                }
                .padding(.vertical, 2)
                .background(PennyColor.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.top, 16)
                VStack(spacing: 8) {
                    PennyButton(MonitoringText.share) { answer(share: true) }
                        .accessibilityIdentifier("monitoringPrompt.share")
                    PennyButton(MonitoringText.decline, role: .secondary) { answer(share: false) }
                        .accessibilityIdentifier("monitoringPrompt.decline")
                }
                .padding(.top, 18)
                footer
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
            }
            .padding(.horizontal, 22)
            .padding(.top, 20)
            .padding(.bottom, Metrics.gutter)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(PennyColor.surface)
        .presentationDetents([.fraction(0.72), .large])
        .presentationBackground(PennyColor.surface)
        // Only the buttons answer: swiping it away asks again next time.
        .interactiveDismissDisabled()
        .accessibilityIdentifier("screen.monitoringPrompt")
    }

    @ViewBuilder private var footer: some View {
        if let policy = shell.auth?.server?.privacyPolicy {
            Text(Self.footer(policy: policy))
                .accessibilityIdentifier("monitoringPrompt.privacyPolicy")
        } else {
            Text(MonitoringText.promptFooter).foregroundStyle(PennyColor.secondaryLabel)
        }
    }

    /// The footnote with the policy as a copper link, as on the card.
    static func footer(policy: URL) -> AttributedString {
        var text = AttributedString(MonitoringText.promptFooter + " ")
        text.foregroundColor = PennyColor.secondaryLabel
        var link = AttributedString(PrivacyPolicyText.title)
        link.link = policy
        link.foregroundColor = PennyColor.tintText
        link.inlinePresentationIntent = .stronglyEmphasized
        text.append(link)
        return text
    }

    private func item<Content: View>(symbol: String, style: Color, @ViewBuilder content: () -> Content)
        -> some View
    {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(style)
                .frame(width: 18)
                .accessibilityHidden(true)
            content()
                .font(.subheadline)
                .foregroundStyle(PennyColor.label)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }

    private func answer(share: Bool) {
        telemetry.answerPrompt(share: share)
        dismiss()
    }
}

/// Settings › Privacy (`iphone-privacy` card): a switch for each kind of report, what reports
/// never include, and the server's privacy policy. Shown while the server takes reports.
struct PrivacySettingsView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(ClientTelemetry.self) private var telemetry: ClientTelemetry?

    var body: some View {
        let host = shell.account.map { ServerText.host($0.server) } ?? ""
        List {
            if let telemetry {
                Section {
                    switchRow(
                        MonitoringText.crashes, detail: MonitoringText.crashesDetail,
                        isOn: Binding(get: { telemetry.choices.crashes }, set: { telemetry.setCrashes($0) })
                    )
                    .accessibilityIdentifier("privacy.crashes")
                    switchRow(
                        MonitoringText.performance, detail: MonitoringText.performanceDetail,
                        isOn: Binding(get: { telemetry.choices.performance }, set: { telemetry.setPerformance($0) })
                    )
                    .accessibilityIdentifier("privacy.performance")
                } header: {
                    Text(MonitoringText.reportsHeader(host: host)).cardSectionHeader()
                } footer: {
                    Text(MonitoringText.never)
                }
            }
            if let policy = shell.auth?.server?.privacyPolicy {
                Section {
                    Link(destination: policy) {
                        HStack {
                            Label(PrivacyPolicyText.title, systemImage: "doc.text")
                            Spacer()
                            Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold))
                                .foregroundStyle(PennyColor.secondaryLabel)
                                .accessibilityHidden(true)
                        }
                        .foregroundStyle(PennyColor.label)
                    }
                    .cardSettingsRow()
                    .accessibilityHint("Opens in Safari")
                    .accessibilityIdentifier("privacy.policy")
                } header: {
                    Text(MonitoringText.policies).cardSectionHeader()
                } footer: {
                    Text(MonitoringText.policyFooter)
                }
            }
        }
        .labelStyle(.settingsRow)
        .insetGroupedList()
        .background(PennyColor.background)
        .navigationTitle(SettingsRoute.privacy.title)
        .accessibilityIdentifier("screen.privacy")
    }

    /// A switch with a title and a line under it (the card's `.sr` with `small`).
    private func switchRow(_ title: String, detail: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(PennyColor.tint)
        .cardSettingsRow()
    }
}
