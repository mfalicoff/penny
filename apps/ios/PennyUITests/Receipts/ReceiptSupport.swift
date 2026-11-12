import CryptoKit
import Foundation
import PennyAccessibility
import XCTest

/// The synthetic receipt files `scripts/receipt-fixtures.mjs` wrote and `ios.sh` seeded into
/// the simulator (photo library and Files › On My iPhone/iPad), with their checksums.
struct ReceiptFixtures {
    let folder: URL
    let manifest: [String: [String: Any]]

    static let photo = "penny-receipt-photo.png"
    static let pdf = "penny-receipt.pdf"
    static let damaged = "penny-damaged.pdf"
    static let renamed = "penny-renamed.pdf"
    static let oversized = "penny-oversized.png"

    /// From `PENNY_RECEIPT_FIXTURES` (ios.sh), else `.cache/ios/receipt-fixtures` in this checkout.
    static func load() throws -> ReceiptFixtures {
        let root = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let folder =
            ProcessInfo.processInfo.environment["PENNY_RECEIPT_FIXTURES"].map { URL(filePath: $0) }
            ?? root.appending(path: ".cache/ios/receipt-fixtures")
        guard let data = try? Data(contentsOf: folder.appending(path: "manifest.json")),
            let manifest = try JSONSerialization.jsonObject(with: data) as? [String: [String: Any]]
        else {
            throw XCTSkip("No receipt fixtures: run through `apps/ios/scripts/ios.sh ui-test`, which seeds them.")
        }
        return ReceiptFixtures(folder: folder, manifest: manifest)
    }

    func sha256(_ name: String) throws -> String {
        guard let value = manifest[name]?["sha256"] as? String else {
            throw UIExpectationFailed(description: "\(name) is not in the fixture manifest")
        }
        return value
    }

    func data(_ name: String) throws -> Data {
        try Data(contentsOf: folder.appending(path: name))
    }

    static func sha256(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

/// Receipt calls a second device would make, against the real API.
extension Stack {
    /// `POST /api/receipts` as `token`; returns `{id, name, mime, uri}`.
    func uploadReceipt(token: String, name: String, mime: String, data: Data) async throws -> [String: Any] {
        let body: [String: Any] = ["name": name, "mime": mime, "base64": data.base64EncodedString()]
        let (status, answer) = try await receiptRequest("POST", path: "api/receipts", token: token, body: body)
        guard status == 201, let receipt = try JSONSerialization.jsonObject(with: answer) as? [String: Any] else {
            throw StackError.status("POST /api/receipts", status, String(decoding: answer, as: UTF8.self))
        }
        return receipt
    }

    /// `GET <uri>` as `token`: the status and the bytes.
    func receiptBytes(token: String, uri: String) async throws -> (status: Int, data: Data) {
        try await receiptRequest("GET", path: String(uri.drop { $0 == "/" }), token: token)
    }

    /// Adds an expense that links `receipt` (the upload's answer), from "another device".
    func addTransaction(token: String, id: String, title: String, cents: Int, receipt: [String: Any]) async throws {
        let current = try await ledger(token: token)
        var ledger = current.ledger
        var transactions = ledger["transactions"] as? [[String: Any]] ?? []
        transactions.append([
            "id": id, "title": title, "kind": "expense", "total": cents, "share": cents, "categoryId": "groceries",
            "date": Stack.defaultToday, "note": "", "receipt": receipt,
        ])
        ledger["transactions"] = transactions
        let (status, answer) = try await receiptRequest(
            "PUT", path: "api/ledger", token: token, body: ["revision": current.revision, "ledger": ledger])
        guard (200..<300).contains(status) else {
            throw StackError.status("PUT /api/ledger", status, String(decoding: answer, as: UTF8.self))
        }
    }

    /// Waits until the server has an entry titled `title` with a receipt, and returns that receipt.
    func waitForReceipt(token: String, title: String, timeout: TimeInterval = 30) async throws -> [String: Any] {
        let ledger = try await waitForLedger(token: token, timeout: timeout) { ledger in
            (ledger["transactions"] as? [[String: Any]] ?? []).contains {
                $0["title"] as? String == title && $0["receipt"] is [String: Any]
            }
        }
        let entry = (ledger["transactions"] as? [[String: Any]] ?? []).first { $0["title"] as? String == title }
        guard let receipt = entry?["receipt"] as? [String: Any] else {
            throw UIExpectationFailed(description: "\(title) has no receipt on the server")
        }
        return receipt
    }

    private func receiptRequest(
        _ method: String, path: String, token: String, body: [String: Any]? = nil
    ) async throws -> (Int, Data) {
        var request = URLRequest(url: configuration.apiURL.appending(path: path), timeoutInterval: 60)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request)
        return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    }
}

/// Driving the system pickers and the receipt group.
extension Penny {
    /// Opens Add entry with an amount and a name, then More details.
    func startExpense(amount: String, title: String) throws {
        try openAddEntry()
        try enterAmount(amount)
        try type(title, into: AccessibilityID.EntryForm.title)
        try openDetails()
    }

    func openDetails() throws {
        try tap(AccessibilityID.Receipt.moreDetails)
        try wait(for: AccessibilityID.Screen.entryExtras)
    }

    /// Back from More details to the form.
    func closeDetails() {
        app.navigationBars.buttons.matching(identifier: "BackButton").firstMatch.tap()
    }

    /// Chooses the seeded photo in the system photo picker.
    func pickPhoto() throws {
        try tap(AccessibilityID.Receipt.photo)
        // The picker runs out of process; its grid is exposed to the app's element tree.
        // The grid is newest first, so the first cell is the photo `ios.sh` just added.
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        guard photo.waitForExistence(timeout: 20) else {
            throw UIExpectationFailed(description: "The photo picker showed no photo")
        }
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        // Pickers that need a confirmation (multi-select layouts) have an Add button.
        let add = app.buttons["Add"]
        if add.waitForExistence(timeout: 2) { add.tap() }
    }

    /// Closes the photo picker without choosing.
    func cancelPhotoPicker() throws {
        try tap(AccessibilityID.Receipt.photo)
        let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "Close"])).firstMatch
        guard cancel.waitForExistence(timeout: 20) else {
            throw UIExpectationFailed(description: "The photo picker has no Cancel")
        }
        cancel.tap()
    }

    /// Chooses `name` (without its extension, as Files shows it) from On My iPhone/iPad.
    func pickFile(_ name: String) throws {
        try tap(AccessibilityID.Receipt.file)
        let file = try browseOnDevice(name)
        file.tap()
    }

    /// Opens the file picker and closes it without choosing.
    func cancelFilePicker() throws {
        try tap(AccessibilityID.Receipt.file)
        let cancel = app.buttons["Cancel"]
        guard cancel.waitForExistence(timeout: 20) else {
            throw UIExpectationFailed(description: "The file picker has no Cancel")
        }
        cancel.tap()
    }

    /// In the document picker: Browse › On My iPhone/iPad, then the file's cell.
    private func browseOnDevice(_ name: String) throws -> XCUIElement {
        let stem = (name as NSString).deletingPathExtension
        let match = NSPredicate(format: "label BEGINSWITH %@", stem)
        let file = app.cells.matching(match).firstMatch
        if file.waitForExistence(timeout: 5) { return file }
        let browse = app.buttons["Browse"]
        if browse.waitForExistence(timeout: 10) {
            browse.tap()
            // Tapping Browse while already browsing goes back to its root.
            if !app.cells["On My iPhone"].exists, !app.cells["On My iPad"].exists { browse.tap() }
        }
        let location = app.cells.matching(NSPredicate(format: "label IN %@", ["On My iPhone", "On My iPad"]))
            .firstMatch
        if location.waitForExistence(timeout: 10) {
            location.tap()
        } else {
            let link = app.buttons.matching(NSPredicate(format: "label IN %@", ["On My iPhone", "On My iPad"]))
                .firstMatch
            guard link.waitForExistence(timeout: 5) else {
                throw UIExpectationFailed(description: "The file picker has no On My iPhone/iPad")
            }
            link.tap()
        }
        guard file.waitForExistence(timeout: 15) else {
            throw UIExpectationFailed(description: "The file picker has no \(stem)")
        }
        return file
    }

    /// Waits for the uploaded receipt's row in More details.
    func waitForAttachedReceipt(timeout: TimeInterval = 40) throws {
        try wait(for: AccessibilityID.Receipt.attached, timeout: timeout)
    }

    /// Opens the share sheet from the viewer and closes it again.
    func shareAndDismiss() throws {
        try tap(AccessibilityID.Receipt.viewerShare)
        // The share sheet is a system popover: wait for it, check it offers actions on the
        // file (Print for both photos and PDFs; Save to Files for a PDF), and close it from outside (its own
        // controls have no identifiers).
        try wait(for: "ActivityListView", timeout: 15)
        let save = app.cells.matching(NSPredicate(format: "label IN %@", ["Save to Files", "Print"])).firstMatch
        guard save.waitForExistence(timeout: 10) else {
            throw UIExpectationFailed(description: "The share sheet offers no actions for the receipt")
        }
        let outside = app.otherElements["PopoverDismissRegion"]
        if outside.exists {
            outside.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)).tap()
        } else {
            app.otherElements["ActivityListView"].swipeDown(velocity: .fast)
        }
        try waitForAbsence(of: "ActivityListView", timeout: 10)
    }
}
