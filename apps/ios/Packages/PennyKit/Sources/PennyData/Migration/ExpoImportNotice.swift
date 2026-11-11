/// What Settings says when this launch's Expo import (MAZ-72) needs the person to act: what
/// happened and what to do. Nil when nothing needs attention (nothing to import, imported,
/// waiting for sync, finished). Nothing in the report is ever deleted; the wording says so.
public struct ExpoImportNotice: Equatable, Sendable {
    public var title: String
    public var message: String

    public init?(_ report: ExpoMigrationReport) {
        let outcomes = report.accounts.map(\.outcome)
        let blocked = outcomes.contains { if case .blocked = $0 { true } else { false } }
        if report.status == .retryLater || report.notes.contains(.storeUnavailable) {
            title = "Earlier entries not imported yet"
            message =
                "Penny couldn't open the entries saved by its previous version. Unlock this device and reopen Penny to import them."
        } else if blocked {
            title = "Earlier entries not imported yet"
            message =
                "Penny couldn't save entries from its previous version on this device. Free some space, then reopen Penny. They're kept until then."
        } else if outcomes.contains(.unknownServer) {
            title = "Some earlier entries need a server"
            message =
                "Penny couldn't tell which server some entries from its previous version belong to. Choose the server you used, then reopen Penny. They're kept until then."
        } else if outcomes.contains(.unreadable) || report.notes.contains(.storeCorrupt)
            || report.status == .needsAttention
        {
            title = "Some earlier entries couldn't be imported"
            message =
                "Some entries saved by Penny's previous version are damaged or from a newer version. They're kept on this device, untouched; updating Penny may import them."
        } else {
            return nil
        }
    }
}
