import Foundation
import XCTest

/// Trips as another device writes them (MAZ-76): a personal trip with an expense in the
/// account's ledger, through the real ledger API.
extension Stack {
    /// Adds a personal trip and one expense assigned to it, in one ledger write.
    func addTrip(
        token: String, id: String, name: String, start: String, end: String, expenseID: String, expenseTitle: String,
        cents: Int, expenseDate: String
    ) async throws {
        let current = try await ledger(token: token)
        var ledger = current.ledger
        var trips = ledger["trips"] as? [[String: Any]] ?? []
        trips.append(["id": id, "name": name, "startDate": start, "endDate": end])
        ledger["trips"] = trips
        var transactions = ledger["transactions"] as? [[String: Any]] ?? []
        transactions.append([
            "id": expenseID, "title": expenseTitle, "kind": "expense", "total": cents, "share": cents,
            "categoryId": "groceries", "tripId": id, "date": expenseDate, "note": "",
        ])
        ledger["transactions"] = transactions
        _ = try await send(
            "PUT", configuration.apiURL.appending(path: "api/ledger"),
            body: ["revision": current.revision, "ledger": ledger], token: token)
    }
}
