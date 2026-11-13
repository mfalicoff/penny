import Foundation
public import PennyDomain

/// Push device registration (MAZ-61 on the server, MAZ-79 here): `POST` and `DELETE
/// /api/push/devices`. Both need a session; the registration belongs to the session that
/// made it, and server logout removes it. A token the server cannot use is refused with
/// `400 Invalid push device.` (docs/reference/push.md).
extension APIClient {
    private struct RegisterBody: Encodable {
        var token: String
        var platform = "ios"
        var provider = "apns"
        var environment: String
    }

    private struct RemoveBody: Encodable { var token: String }

    /// Registers this device's APNs token for the signed-in session, for the gateway that
    /// issued it. Registering the same token again moves it to this session and account.
    public func registerPushDevice(_ token: PushDeviceToken, environment: PushEnvironment) async throws {
        let ok: WireOk = try await json(
            .post, "/api/push/devices", body: RegisterBody(token: token.hex, environment: environment.rawValue))
        guard ok.ok else { throw APIError.malformedResponse }
    }

    /// Removes the token, when this session registered it (otherwise the server answers 200
    /// and changes nothing).
    public func unregisterPushDevice(_ token: PushDeviceToken) async throws {
        let ok: WireOk = try await json(.delete, "/api/push/devices", body: RemoveBody(token: token.hex))
        guard ok.ok else { throw APIError.malformedResponse }
    }
}
