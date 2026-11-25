import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// One button of a Penny confirmation (`delete-confirm`, `sign-out`, `sign-out-plain` cards):
/// full-width capsules, the first one leading.
struct ConfirmationAction: Identifiable {
    enum Style {
        /// Copper with white text ("Sync, then sign out").
        case primary
        /// Red with white text ("Delete for everyone").
        case destructiveFilled
        /// Red text on the neutral fill ("Sign out anyway", "Sign out").
        case destructive
        /// Label text on the neutral fill ("Cancel").
        case cancel
    }

    let title: String
    let style: Style
    let identifier: String
    let action: () -> Void

    var id: String { identifier }

    init(_ title: String, style: Style, identifier: String, action: @escaping () -> Void = {}) {
        self.title = title
        self.style = style
        self.identifier = identifier
        self.action = action
    }
}

/// The buttons of a confirmation, stacked. Each one runs its action and closes the confirmation.
struct ConfirmationButtons: View {
    @ScaledMetric(relativeTo: .body) private var height = ControlSize.button
    let actions: [ConfirmationAction]
    let close: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            ForEach(actions) { item in
                Button {
                    close()
                    item.action()
                } label: {
                    Self.label(item.title, style: item.style, height: height)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(item.identifier)
            }
        }
    }

    static func label(_ title: String, style: ConfirmationAction.Style, height: Double) -> some View {
        Text(title)
            .font(.body.weight(.semibold))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: height)
            .foregroundStyle(foreground(style))
            .background(background(style), in: Capsule())
            .contentShape(Capsule())
    }

    static func foreground(_ style: ConfirmationAction.Style) -> Color {
        switch style {
        case .primary, .destructiveFilled: .white
        case .destructive: PennyColor.danger
        case .cancel: PennyColor.label
        }
    }

    static func background(_ style: ConfirmationAction.Style) -> Color {
        switch style {
        case .primary: PennyColor.tint
        case .destructiveFilled: PennyColor.danger
        case .destructive, .cancel: PennyColor.fill
        }
    }
}

/// The centered confirmation of the `sign-out` and `sign-out-plain` cards: an icon tile, a title,
/// the message and the buttons on a rounded card over a dimmed screen. A system alert can't show
/// the tile or a copper action, so Penny draws it. It is presented without the cover's slide, as
/// a dialog appears, and the background stays visible under the dim.
struct CenteredConfirmation<Item>: ViewModifier {
    @Binding var item: Item?
    let content: (Item) -> CenteredConfirmationContent

    func body(content base: Content) -> some View {
        let presented = Binding(get: { item != nil }, set: { if !$0 { item = nil } })
        #if os(iOS)
            base
                .fullScreenCover(isPresented: presented) { card }
                .transaction(value: item != nil) { $0.disablesAnimations = true }
        #else
            base.sheet(isPresented: presented) { card }
        #endif
    }

    @ViewBuilder private var card: some View {
        if let item {
            CenteredConfirmationCard(content: content(item)) { self.item = nil }
                .presentationBackground(.clear)
        }
    }
}

struct CenteredConfirmationContent {
    let symbol: String
    let tone: Tone
    let title: String
    let message: String
    let actions: [ConfirmationAction]
    let identifier: String

    enum Tone {
        case pending, danger

        var color: Color {
            switch self {
            case .pending: PennyColor.pending
            case .danger: PennyColor.danger
            }
        }

        var soft: Color {
            switch self {
            case .pending: PaletteToken.pendingSoft.value.color
            case .danger: PaletteToken.dangerSoft.value.color
            }
        }
    }
}

private struct CenteredConfirmationCard: View {
    @ScaledMetric(relativeTo: .title) private var tile: Double = 48
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    let content: CenteredConfirmationContent
    let close: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(shown ? 0.28 : 0)
                .ignoresSafeArea()
                .accessibilityHidden(true)
            ScrollView {
                VStack(spacing: 0) {
                    Image(systemName: content.symbol)
                        .font(.system(size: tile * 0.46, weight: .medium))
                        .foregroundStyle(content.tone.color)
                        .frame(width: tile, height: tile)
                        .background(
                            content.tone.soft, in: RoundedRectangle(cornerRadius: tile * 0.28, style: .continuous)
                        )
                        .accessibilityHidden(true)
                    Text(content.title)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(PennyColor.label)
                        .padding(.top, 16)
                        .accessibilityAddTraits(.isHeader)
                    Text(content.message)
                        .font(.subheadline)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .padding(.top, 8)
                    ConfirmationButtons(actions: content.actions, close: close)
                        .padding(.top, 20)
                }
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 20)
                .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
                .frame(maxWidth: 340)
                .padding(.horizontal, 40)
                .frame(maxWidth: .infinity)
                // As the web dialog: it fades in while rising `nudge`; under Reduce Motion it only fades.
                .offset(y: shown || reduceMotion ? 0 : Motion.Distance.nudge)
                .opacity(shown ? 1 : 0)
            }
            .scrollBounceBehavior(.basedOnSize)
            .defaultScrollAnchor(.center)
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier(content.identifier)
        // A sign-out or leave with pending changes is destructive: the warning haptic (MAZ-287).
        .pennyHaptic(.destructiveConfirmation, trigger: shown && content.tone == .danger)
        .onAppear { withAnimation(Motion.animation(.standard, reduceMotion: reduceMotion)) { shown = true } }
    }
}

extension View {
    /// Shows Penny's centered confirmation while `item` is set (`sign-out` cards).
    func centeredConfirmation<Item>(
        _ item: Binding<Item?>, content: @escaping (Item) -> CenteredConfirmationContent
    ) -> some View {
        modifier(CenteredConfirmation(item: item, content: content))
    }
}

/// The bottom confirmation of the `delete-confirm` card: what is deleted (its tile, name and
/// "$2,900.00 · Nov 1 · Apartment", with the members of a shared expense), a note on what
/// deleting does, then the destructive action and Cancel. A system confirmation dialog can't show
/// any of that, so it is a short sheet sized to its content.
struct DeleteConfirmationSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .body) private var tile: Double = 40
    @ScaledMetric(relativeTo: .body) private var buttonHeight = ControlSize.button
    @State private var height: Double = 320
    @State private var warned = false

    struct Subject {
        let title: String
        let detail: String
        let symbol: String
        let color: Color
        /// A shared expense's members, as pictures or monograms.
        var members: [PersonFace] = []
        let noteSymbol: String
        let note: String
        let confirmTitle: String
    }

    let subject: Subject
    let confirm: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: subject.symbol)
                    .font(.system(size: tile * 0.48, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: tile, height: tile)
                    .background(subject.color, in: RoundedRectangle(cornerRadius: tile * 0.27, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Delete “\(subject.title)”?")
                        .font(.headline)
                        .foregroundStyle(PennyColor.label)
                        .accessibilityAddTraits(.isHeader)
                    Text(subject.detail)
                        .font(.subheadline)
                        .foregroundStyle(PennyColor.secondaryLabel)
                }
                Spacer(minLength: 8)
                if !subject.members.isEmpty {
                    MonogramStack(faces: subject.members, size: 30)
                }
            }
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: subject.noteSymbol)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                Text(subject.note)
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.label)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(14)
            .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            VStack(spacing: 10) {
                Button {
                    dismiss()
                    confirm()
                } label: {
                    ConfirmationButtons.label(subject.confirmTitle, style: .destructiveFilled, height: buttonHeight)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("deleteEntry.confirm")
                Button {
                    dismiss()
                } label: {
                    ConfirmationButtons.label("Cancel", style: .cancel, height: buttonHeight)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("deleteEntry.cancel")
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 12)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: Double.self) {
            $0.size.height
        } action: {
            height = $0
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(PennyColor.surface)
        .presentationDetents([.height(height)])
        .presentationDragIndicator(.hidden)
        .presentationBackground(PennyColor.surface)
        // A container, so the screen identifier doesn't replace the buttons' own.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.deleteConfirm")
        // A destructive confirmation appears: the warning haptic (MAZ-287).
        .pennyHaptic(.destructiveConfirmation, trigger: warned)
        .onAppear { warned = true }
    }
}
