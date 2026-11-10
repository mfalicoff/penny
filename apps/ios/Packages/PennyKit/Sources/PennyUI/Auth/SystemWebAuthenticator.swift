import AuthenticationServices
import Foundation
import PennyData
import SwiftUI

/// Single sign-on in the system authentication session (`ASWebAuthenticationSession`
/// through SwiftUI's `WebAuthenticationSession`). The callback is the `penny` scheme, which
/// the session intercepts itself, so the callback never goes through `onOpenURL`.
///
/// The browser session is **ephemeral**: no cookies are shared with Safari or kept between
/// attempts. On a shared device, signing out of Penny and handing it to someone else must
/// not sign them straight back in to the previous person's provider account (and so their
/// Penny data). The legacy app shared Safari's cookies; this is a deliberate difference.
nonisolated struct SystemWebAuthenticator: WebAuthenticator {
    let session: WebAuthenticationSession

    func authenticate(at url: URL, callbackScheme: String) async throws -> URL {
        do {
            return try await session.authenticate(
                using: url, callback: .customScheme(callbackScheme), preferredBrowserSession: .ephemeral,
                additionalHeaderFields: [:])
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            throw CancellationError()
        }
    }
}
