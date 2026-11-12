import Foundation
import XCTest

/// Ledger reads and writes as "another device" (MAZ-82): whole-ledger compare-and-swap through
/// the real `GET`/`PUT /api/ledger`, the same contract the app syncs with. Amounts are cents.
extension Stack {
    /// A synthetic transaction as the ledger wire format writes it.
    struct Transaction {
        var id: String
        var title: String
        var kind = "expense"
        var cents: Int
        var share: Int?
        var date = Stack.defaultToday
        var categoryID = "groceries"
        var accountID: String?

        var json: [String: Any] {
            var value: [String: Any] = [
                "id": id, "title": title, "kind": kind, "total": cents, "share": share ?? cents,
                "categoryId": categoryID, "date": date, "note": "",
            ]
            if let accountID { value["accountId"] = accountID }
            return value
        }
    }

    /// Reads the ledger, lets `change` edit it, and writes it on the revision just read.
    func updateLedger(token: String, _ change: (inout [String: Any]) -> Void) async throws {
        let current = try await ledger(token: token)
        var ledger = current.ledger
        change(&ledger)
        _ = try await send(
            "PUT", configuration.apiURL.appending(path: "api/ledger"),
            body: ["revision": current.revision, "ledger": ledger], token: token)
    }

    /// Adds many transactions in one write (large-ledger baselines and search fixtures).
    func addTransactions(token: String, _ transactions: [Transaction]) async throws {
        try await updateLedger(token: token) { ledger in
            var list = ledger["transactions"] as? [[String: Any]] ?? []
            list.append(contentsOf: transactions.map(\.json))
            ledger["transactions"] = list
        }
    }

    /// Changes one transaction's fields, as an edit on another device.
    func editTransaction(token: String, id: String, _ fields: [String: Any]) async throws {
        try await updateLedger(token: token) { ledger in
            var list = ledger["transactions"] as? [[String: Any]] ?? []
            guard let index = list.firstIndex(where: { $0["id"] as? String == id }) else { return }
            list[index].merge(fields) { _, new in new }
            ledger["transactions"] = list
        }
    }

    /// Deletes one transaction, as another device would.
    func deleteTransaction(token: String, id: String) async throws {
        try await updateLedger(token: token) { ledger in
            let list = ledger["transactions"] as? [[String: Any]] ?? []
            ledger["transactions"] = list.filter { $0["id"] as? String != id }
        }
    }
}

/// Typed reads of a wire ledger (`[String: Any]` from `Stack.ledger`).
enum LedgerJSON {
    static func transactions(_ ledger: [String: Any]) -> [[String: Any]] {
        ledger["transactions"] as? [[String: Any]] ?? []
    }

    static func transaction(_ ledger: [String: Any], id: String) -> [String: Any]? {
        transactions(ledger).first { $0["id"] as? String == id }
    }

    static func transaction(_ ledger: [String: Any], title: String) -> [String: Any]? {
        transactions(ledger).first { $0["title"] as? String == title }
    }

    static func categories(_ ledger: [String: Any]) -> [[String: Any]] {
        ledger["categories"] as? [[String: Any]] ?? []
    }

    static func accounts(_ ledger: [String: Any]) -> [[String: Any]] {
        ledger["accounts"] as? [[String: Any]] ?? []
    }

    static func recurring(_ ledger: [String: Any]) -> [[String: Any]] {
        ledger["recurring"] as? [[String: Any]] ?? []
    }

    /// The sum of your shares of one kind: the recorded total Home and Activity show for it.
    static func shareTotal(_ ledger: [String: Any], kind: String) -> Int {
        transactions(ledger).filter { $0["kind"] as? String == kind }.reduce(0) { $0 + ($1["share"] as? Int ?? 0) }
    }
}
