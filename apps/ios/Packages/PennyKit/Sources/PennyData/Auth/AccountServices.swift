/// What sign-out and account changes need from the account's local data. The offline ledger
/// and pending-change queue (MAZ-71) implement this; until then `NoLocalAccountData` stands
/// in. Everything is keyed by `AccountScope`, so one account's data is never read, synced or
/// removed on behalf of another.
public protocol AccountLocalData: Sendable {
    /// Changes saved on this device that the server has not acknowledged yet.
    func pendingChangeCount(for scope: AccountScope) async -> Int
    /// Sends pending changes now ("Sync, then sign out"). Throws when they could not all be
    /// sent; nothing is removed in that case.
    func syncPendingChanges(for scope: AccountScope, using client: APIClient) async throws
    /// Removes the account's entries from this device after sign-out. Synced entries stay
    /// on the server. When it throws, `AuthController.unremovedLocalData` names the scope
    /// so the person can try again.
    func removeLocalData(for scope: AccountScope) async throws
    /// Re-keys everything stored under `old` (entries and pending changes) to `new`, merging
    /// into whatever `new` already holds. Called when the server reports a new email for the
    /// same token: it is the same account, so its unsynced work must follow it. Throw to keep
    /// everything under `old`; the app then stays on `old` and tries again at the next launch.
    func moveLocalData(from old: AccountScope, to new: AccountScope) async throws
}

/// No local data yet (before MAZ-71): nothing is ever pending.
public struct NoLocalAccountData: AccountLocalData {
    public init() {}
    public func pendingChangeCount(for scope: AccountScope) async -> Int { 0 }
    public func syncPendingChanges(for scope: AccountScope, using client: APIClient) async throws {}
    public func removeLocalData(for scope: AccountScope) async throws {}
    public func moveLocalData(from old: AccountScope, to new: AccountScope) async throws {}
}

/// The push registration of the current session (MAZ-79). Sign-out calls `unregister` while
/// the session is still valid, so the `DELETE /api/push/devices` request is authenticated.
/// It must not throw: sign-out continues offline, and server logout also drops the
/// session's devices.
public protocol DeviceRegistration: Sendable {
    func unregister(using client: APIClient) async
}

/// No push registration yet (before MAZ-79).
public struct NoDeviceRegistration: DeviceRegistration {
    public init() {}
    public func unregister(using client: APIClient) async {}
}
