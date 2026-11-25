import AuthenticationServices
import Foundation
import PennyData

#if os(iOS)
    import UIKit
#endif

/// Native Sign in with Apple (MAZ-170) for a provider the server marks `native`: the system's
/// Apple ID sheet, with the server's nonce on the request. Apple returns the ID token and, only
/// the first time someone signs in to the app, their name.
///
/// It needs the Sign in with Apple capability and entitlement, which the app gets only once a
/// human adds them to the App ID and profiles (docs/ios/ipa.md). Until the `PennySignInWithApple`
/// Info.plist value is YES, `isEnabled` is false and Apple signs in through the browser sheet.
nonisolated struct AppleSignInAuthenticator: NativeSignInAuthenticator {
    /// Whether this build may use the native sheet (`PENNY_SIGN_IN_WITH_APPLE`, Penny.xcconfig).
    static var isEnabled: Bool { isEnabled(Bundle.main.object(forInfoDictionaryKey: "PennySignInWithApple")) }

    static func isEnabled(_ value: Any?) -> Bool {
        switch value {
        case let flag as Bool: flag
        case let text as String: ["yes", "true", "1"].contains(text.lowercased())
        default: false
        }
    }

    func authorize(nonce: String) async throws -> NativeSignInCredential {
        try await Self.present(nonce: nonce)
    }

    /// The Apple ID sheet runs on the main actor.
    @MainActor
    private static func present(nonce: String) async throws -> NativeSignInCredential {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonce
        let delegate = AppleSignInDelegate()
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = delegate
        controller.presentationContextProvider = delegate
        let authorization = try await withCheckedThrowingContinuation { continuation in
            delegate.continuation = continuation
            controller.performRequests()
        }
        withExtendedLifetime(delegate) {}
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let data = credential.identityToken, let token = String(data: data, encoding: .utf8)
        else { throw ASAuthorizationError(.invalidResponse) }
        return NativeSignInCredential(
            idToken: token, givenName: credential.fullName?.givenName, familyName: credential.fullName?.familyName)
    }
}

/// Bridges `ASAuthorizationController`'s delegate to async/await, and presents over the key window.
private final class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding
{
    var continuation: CheckedContinuation<ASAuthorization, any Error>?

    func authorizationController(
        controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        continuation?.resume(returning: authorization)
        continuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
        if let error = error as? ASAuthorizationError, error.code == .canceled {
            continuation?.resume(throwing: CancellationError())
        } else {
            continuation?.resume(throwing: error)
        }
        continuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        #if os(iOS)
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let windows = scenes.flatMap(\.windows)
            if let window = windows.first(where: \.isKeyWindow) ?? windows.first { return window }
            // Penny only signs in from a visible screen, so a scene is always connected.
            guard let scene = scenes.first else { preconditionFailure("Sign in with Apple needs a window scene.") }
            return ASPresentationAnchor(windowScene: scene)
        #else
            // The package tests build PennyUI for the macOS host; the app is iPhone and iPad only.
            return ASPresentationAnchor()
        #endif
    }
}
