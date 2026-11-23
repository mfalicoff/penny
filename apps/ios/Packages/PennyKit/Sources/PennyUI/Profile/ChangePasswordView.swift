import PennyData
import PennyDesign
import SwiftUI

/// Settings › Profile › Change password (MAZ-171): the current and the new password. On success
/// this device stays signed in and the server signs the others out. A wrong current password
/// clears and refocuses that field.
struct ChangePasswordView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let changed: () -> Void

    enum Field: Hashable { case current, new }

    @State private var current = ""
    @State private var new = ""
    @State private var failure: String?
    @State private var saving = false
    @FocusState private var focus: Field?

    private var ready: Bool { !current.isEmpty && new.utf16.count >= PasswordRules.minLength && !saving }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    SecureField("Current password", text: $current)
                        .passwordEntry(new: false)
                        .submitLabel(.next)
                        .focused($focus, equals: .current)
                        .onSubmit { focus = .new }
                        .cardSettingsRow()
                        .accessibilityIdentifier("changePassword.current")
                    SecureField("New password", text: $new, prompt: Text("At least 10 characters"))
                        .passwordEntry(new: true)
                        .submitLabel(.done)
                        .focused($focus, equals: .new)
                        .onSubmit(save)
                        .cardSettingsRow()
                        .accessibilityIdentifier("changePassword.new")
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        if let failure {
                            Text(failure).foregroundStyle(PennyColor.danger)
                                .accessibilityIdentifier("changePassword.error")
                        }
                        Text(
                            "Use at least 10 characters. Other devices are signed out and need the new password; "
                                + "this \(SyncBanner.deviceName) stays signed in.")
                    }
                }
            }
            .disabled(saving)
            .insetGroupedList()
            .background(PennyColor.background)
            .navigationTitle("Change password")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                        .accessibilityIdentifier("changePassword.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Change password", systemImage: "checkmark", action: save)
                            .disabled(!ready)
                            .accessibilityIdentifier("changePassword.save")
                    }
                }
            }
            .onAppear { focus = .current }
        }
        .accessibilityIdentifier("screen.changePassword")
    }

    private func save() {
        guard ready else { return }
        failure = nil
        saving = true
        Task {
            let outcome = await shell.profile.changePassword(current: current, new: new)
            saving = false
            switch outcome {
            case .changed:
                changed()
                dismiss()
            case .wrongCurrentPassword(let message):
                failure = message
                current = ""
                focus = .current
            case .invalidNewPassword(let message):
                failure = message
                focus = .new
            case .notAllowed(let message), .failed(let message):
                failure = message
            }
        }
    }
}
