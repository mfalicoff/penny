import PennyDesign
import SwiftUI

/// iOS keyboard and navigation traits for the sign-in screens. PennyUI also compiles for the
/// macOS host (package tests), where these modifiers do not exist.
extension View {
    /// An email field: email keyboard, no capitalization or autocorrection, and the
    /// username content type so Password AutoFill offers saved accounts.
    func emailEntry() -> some View {
        #if os(iOS)
            textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        #else
            autocorrectionDisabled()
        #endif
    }

    /// A password field: AutoFill for an existing password, or a strong-password
    /// suggestion when creating an account.
    func passwordEntry(new: Bool) -> some View {
        #if os(iOS)
            textContentType(new ? .newPassword : .password)
        #else
            self
        #endif
    }

    /// A server address field: URL keyboard, no capitalization or autocorrection.
    func urlEntry() -> some View {
        #if os(iOS)
            textContentType(.URL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        #else
            autocorrectionDisabled()
        #endif
    }

    func inlineNavigationTitle() -> some View {
        #if os(iOS)
            navigationBarTitleDisplayMode(.inline)
        #else
            self
        #endif
    }

    func hiddenNavigationBar() -> some View {
        #if os(iOS)
            toolbar(.hidden, for: .navigationBar)
        #else
            self
        #endif
    }

    /// The app background behind a signed-out page, including a pushed page's container, which
    /// is otherwise the system white where the keyboard was while it goes away.
    func signedOutBackground() -> some View {
        #if os(iOS)
            background { PennyColor.background.ignoresSafeArea() }
                .containerBackground(PennyColor.background, for: .navigation)
        #else
            background { PennyColor.background.ignoresSafeArea() }
        #endif
    }
}

extension View {
    /// A person's name (MAZ-171): AutoFill's name, words capitalized, no autocorrection.
    func personNameEntry() -> some View {
        #if os(iOS)
            textContentType(.name)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
        #else
            autocorrectionDisabled()
        #endif
    }
}
