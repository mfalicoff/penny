import PennyData
import PennyDesign
import SwiftUI

/// "What should people call you?" (`iphone-name-prompt` card, MAZ-171): asked once of an account
/// without a name, over Home. Save name stores it; Not now tells the server to stop asking.
struct NamePromptSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var failure: String?
    @State private var saving = false
    @FocusState private var focused: Bool

    var body: some View {
        let email = shell.account?.email ?? ""
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center, spacing: 14) {
                    Monogram(face: shell.accountFace, size: 52)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("What should people call you?")
                            .font(.title.weight(.bold))
                            .foregroundStyle(PennyColor.label)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text(email).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    }
                }
                Text(
                    "Your households and trips show this name instead of your email. You can add a picture later in "
                        + "Settings › Profile."
                )
                .font(.body)
                .foregroundStyle(PennyColor.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 16)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Name").font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.secondaryLabel)
                    TextField("Name", text: $name, prompt: Text("Your name"))
                        .personNameEntry()
                        .submitLabel(.done)
                        .focused($focused)
                        .onSubmit(save)
                        .accessibilityIdentifier("namePrompt.name")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(PennyColor.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.top, 18)
                Text(failure ?? "Up to 60 characters.")
                    .font(.footnote)
                    .foregroundStyle(failure == nil ? PennyColor.secondaryLabel : PennyColor.danger)
                    .padding(.horizontal, 8)
                    .padding(.top, 8)
                    .accessibilityIdentifier(failure == nil ? "namePrompt.hint" : "namePrompt.error")
                PrimaryButton(title: saving ? "Saving…" : "Save name", busy: saving, action: save)
                    .disabled(saving || DisplayName.validate(name) == .empty)
                    .padding(.top, 22)
                    .accessibilityIdentifier("namePrompt.save")
                Button("Not now") {
                    Task { await shell.profile.dismissNamePrompt() }
                    dismiss()
                }
                .font(.headline)
                .foregroundStyle(PennyColor.label)
                .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                .padding(.top, 8)
                .disabled(saving)
                .accessibilityIdentifier("namePrompt.skip")
            }
            .padding(Metrics.gutter)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(PennyColor.surface)
        .presentationDetents([.medium, .large])
        .presentationBackground(PennyColor.surface)
        .accessibilityIdentifier("screen.namePrompt")
    }

    private func save() {
        guard !saving else { return }
        if case .empty = DisplayName.validate(name) { return }
        failure = nil
        saving = true
        Task {
            failure = await shell.profile.saveName(name)
            saving = false
            if failure == nil { dismiss() }
        }
    }
}
