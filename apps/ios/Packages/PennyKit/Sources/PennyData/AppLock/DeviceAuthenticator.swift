import Foundation
import LocalAuthentication

/// Which biometric sensor the device has, for labels ("Face ID lock").
public enum BiometryKind: Equatable, Sendable {
    case faceID, touchID, opticID
    /// No biometrics (or none enrolled): the device passcode is the only way in.
    case none

    public var name: String {
        switch self {
        case .faceID: "Face ID"
        case .touchID: "Touch ID"
        case .opticID: "Optic ID"
        case .none: "Passcode"
        }
    }
}

/// Why the app asks the person to authenticate.
public enum AuthenticationPurpose: Equatable, Sendable {
    /// Opening a locked app: biometrics, with the device passcode as the backup.
    case unlock
    /// Turning the lock on: biometrics only, so the person proves the sensor works for them
    /// before relying on it (the legacy app did the same).
    case enable
    /// Turning the lock off: biometrics or the passcode.
    case disable
}

public enum AuthenticationResult: Equatable, Sendable {
    case success
    /// The person, the system or the app cancelled the prompt.
    case cancelled
    /// The face or finger did not match.
    case failed
    /// Too many failed attempts; the device passcode unlocks biometrics again.
    case lockout
    case notEnrolled
    /// The device has no passcode, so it cannot verify anyone.
    case passcodeNotSet
    case unavailable
}

/// The device's biometric and passcode check. `LocalDeviceAuthenticator` is the real one;
/// tests use a scripted fake.
@MainActor
public protocol DeviceAuthenticator: AnyObject {
    var biometry: BiometryKind { get }
    /// Whether the lock can be turned on (biometrics enrolled and usable).
    func canEnable() -> AuthenticationResult
    func authenticate(_ purpose: AuthenticationPurpose, reason: String) async -> AuthenticationResult
    /// Cancels a prompt in progress, for example when the app goes to the background. Its
    /// result then arrives as `.cancelled`.
    func cancel()
}

/// `DeviceAuthenticator` on LocalAuthentication. Each prompt uses a new `LAContext`, so a
/// success is never reused for a later unlock.
@MainActor
public final class LocalDeviceAuthenticator: DeviceAuthenticator {
    private var context: LAContext?

    public init() {}

    public var biometry: BiometryKind {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return .none
        }
    }

    public func canEnable() -> AuthenticationResult {
        var error: NSError?
        if LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) { return .success }
        return Self.failure(error)
    }

    public func authenticate(_ purpose: AuthenticationPurpose, reason: String) async -> AuthenticationResult {
        cancel()
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"
        if purpose == .enable { context.localizedFallbackTitle = "" }
        self.context = context
        let policy: LAPolicy =
            purpose == .enable ? .deviceOwnerAuthenticationWithBiometrics : .deviceOwnerAuthentication
        var error: NSError?
        guard context.canEvaluatePolicy(policy, error: &error) else { return Self.failure(error) }
        let result = await withCheckedContinuation { (continuation: CheckedContinuation<AuthenticationResult, Never>) in
            context.evaluatePolicy(policy, localizedReason: reason) { success, error in
                continuation.resume(returning: success ? .success : Self.failure(error))
            }
        }
        if self.context === context { self.context = nil }
        return result
    }

    public func cancel() {
        context?.invalidate()
        context = nil
    }

    /// The result of a check that did not succeed (`canEvaluatePolicy` false, or
    /// `evaluatePolicy` answering `success == false`). Never `.success`: with no error to say
    /// why, the check is treated as unavailable, so a missing error can never unlock.
    nonisolated static func failure(_ error: (any Error)?) -> AuthenticationResult {
        guard let error else { return .unavailable }
        guard let error = error as? LAError else { return .failed }
        switch error.code {
        case .userCancel, .systemCancel, .appCancel, .userFallback, .notInteractive: return .cancelled
        case .authenticationFailed: return .failed
        case .biometryLockout: return .lockout
        case .biometryNotEnrolled: return .notEnrolled
        case .passcodeNotSet: return .passcodeNotSet
        default: return .unavailable
        }
    }
}
