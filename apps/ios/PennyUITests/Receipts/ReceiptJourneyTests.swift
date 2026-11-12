import PennyAccessibility
import XCTest

/// Receipt picking, upload, preview and sharing (MAZ-78) against the real .NET API and
/// PostgreSQL, with the system photo and file pickers and synthetic files seeded by `ios.sh`
/// (`ReceiptFixtures`). Every round trip compares the server's bytes with the fixture's SHA-256.
final class ReceiptJourneyTests: PennyUITestCase {
    /// Photo library → upload with progress → preview (zoomable photo) → share sheet → save;
    /// the server stores the original bytes, and another account can't read them.
    @MainActor
    func test_whenPhotoIsAttached_Receipt_ShouldUploadPreviewShareAndKeepItsBytesPrivate() async throws {
        let fixtures = try ReceiptFixtures.load()
        let stack = try await stack()
        let account = try await makeAccount("receipt-photo")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)

        let title = "Receipt photo \(Device.name)"
        try penny.startExpense(amount: "12.80", title: title)
        try penny.pickPhoto()
        try penny.waitForAttachedReceipt()
        screenshot("entry-extras-photo-attached")

        // Preview from the form: the bytes this device just sent, no download.
        try penny.tap(AccessibilityID.Receipt.attached)
        try penny.wait(for: AccessibilityID.Receipt.screen)
        try penny.wait(for: AccessibilityID.Receipt.viewerImage, timeout: 20)
        screenshot("receipt-photo")
        try penny.shareAndDismiss()
        try penny.tap(AccessibilityID.Receipt.viewerClose)
        try penny.waitForAbsence(of: AccessibilityID.Receipt.screen)

        try penny.tap(AccessibilityID.EntryForm.save)
        try penny.waitForAbsence(of: AccessibilityID.Screen.addEntry)

        let receipt = try await stack.waitForReceipt(token: account.token, title: title)
        let uri = try XCTUnwrap(receipt["uri"] as? String)
        XCTAssertEqual(receipt["mime"] as? String, "image/png")
        let stored = try await stack.receiptBytes(token: account.token, uri: uri)
        XCTAssertEqual(stored.status, 200)
        XCTAssertEqual(ReceiptFixtures.sha256(of: stored.data), try fixtures.sha256(ReceiptFixtures.photo))

        // Private: another account gets the same 404 as for a missing receipt.
        let other = try await makeAccount("receipt-outsider")
        let outsider = try await stack.receiptBytes(token: other.token, uri: uri)
        XCTAssertEqual(outsider.status, 404)
    }

    /// File picker → PDF → save → entry detail → authenticated download → both pages in
    /// PDFKit → share; the server's bytes match the fixture.
    @MainActor
    func test_whenPDFIsAttached_Receipt_ShouldRoundTripAndShowBothPagesFromTheEntry() async throws {
        let fixtures = try ReceiptFixtures.load()
        let stack = try await stack()
        let account = try await makeAccount("receipt-pdf")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)

        let title = "Receipt PDF \(Device.name)"
        try penny.startExpense(amount: "48.90", title: title)
        try penny.pickFile(ReceiptFixtures.pdf)
        try penny.waitForAttachedReceipt()
        try penny.tap(AccessibilityID.EntryForm.save)
        try penny.waitForAbsence(of: AccessibilityID.Screen.addEntry)

        let receipt = try await stack.waitForReceipt(token: account.token, title: title)
        let uri = try XCTUnwrap(receipt["uri"] as? String)
        XCTAssertEqual(receipt["name"] as? String, ReceiptFixtures.pdf)
        XCTAssertEqual(receipt["mime"] as? String, "application/pdf")
        let stored = try await stack.receiptBytes(token: account.token, uri: uri)
        XCTAssertEqual(ReceiptFixtures.sha256(of: stored.data), try fixtures.sha256(ReceiptFixtures.pdf))

        // From the entry: a fresh authenticated download.
        let entryID = try await entryID(stack, token: account.token, title: title)
        try penny.openActivity()
        try penny.waitForEntry(entryID).tap()
        try penny.tap(AccessibilityID.Receipt.detailRow)
        try penny.wait(for: AccessibilityID.Receipt.viewerPDF, timeout: 30)
        let pages = try penny.wait(for: AccessibilityID.Receipt.viewerPageCount)
        XCTAssertEqual(pages.label, "2 pages")
        XCTAssertFalse(penny.element(AccessibilityID.Receipt.viewerRemove).exists, "the entry detail can't remove")
        screenshot("receipt-pdf")
        try penny.shareAndDismiss()
        try penny.tap(AccessibilityID.Receipt.viewerClose)
        try penny.waitForAbsence(of: AccessibilityID.Receipt.screen)
    }

    /// A failed upload keeps the draft and the file: Try again sends it and attaches it.
    @MainActor
    func test_whenUploadFails_Receipt_ShouldKeepTheDraftAndAttachOnTryAgain() async throws {
        _ = try ReceiptFixtures.load()
        let stack = try await stack()
        let account = try await makeAccount("receipt-retry")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)

        let title = "Receipt retry \(Device.name)"
        try penny.startExpense(amount: "7.25", title: title)
        try await stack.setFaults([FaultRule(method: "POST", pathPrefix: "/api/receipts", status: 503, times: 1)])
        try penny.pickFile(ReceiptFixtures.pdf)
        try penny.wait(for: AccessibilityID.Receipt.error, timeout: 30)
        screenshot("receipt-upload-failed")
        XCTAssertFalse(penny.element(AccessibilityID.Receipt.attached).exists)

        try penny.tap(AccessibilityID.Receipt.retry)
        try penny.waitForAttachedReceipt()
        try penny.waitForAbsence(of: AccessibilityID.Receipt.error)

        // The rest of the draft is as typed.
        penny.closeDetails()
        XCTAssertEqual(try penny.value(of: AccessibilityID.EntryForm.title), title)
        try penny.tap(AccessibilityID.EntryForm.save)
        _ = try await stack.waitForReceipt(token: account.token, title: title)
    }

    /// Files the rules refuse never upload, say why, and offer no Try again: larger than 10 MB,
    /// and a photo renamed to .pdf.
    @MainActor
    func test_whenFileIsOversizedOrRenamed_Receipt_ShouldRefuseItWithoutUploading() async throws {
        _ = try ReceiptFixtures.load()
        let account = try await makeAccount("receipt-refused")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.startExpense(amount: "3.10", title: "Receipt refused")

        for name in [ReceiptFixtures.oversized, ReceiptFixtures.renamed] {
            try penny.pickFile(name)
            let error = try penny.wait(for: AccessibilityID.Receipt.error, timeout: 20)
            XCTAssertFalse(penny.element(AccessibilityID.Receipt.retry).exists, "\(name) offered Try again")
            XCTAssertFalse(penny.element(AccessibilityID.Receipt.progress).exists)
            screenshot("receipt-refused-\(name)")
            _ = error
            try penny.tap(AccessibilityID.Receipt.dismiss)
            try penny.waitForAbsence(of: AccessibilityID.Receipt.error)
        }
        XCTAssertFalse(penny.element(AccessibilityID.Receipt.attached).exists)
    }

    /// Closing either picker without choosing changes nothing, at the largest text size.
    @MainActor
    func test_whenPickersAreCancelledAtLargeText_Receipt_ShouldKeepTheDraftAsTyped() async throws {
        _ = try ReceiptFixtures.load()
        let account = try await makeAccount("receipt-cancel")
        try await launch().signIn(email: account.email, password: account.password)
        // Signed in, relaunch at the largest accessibility text size (the session is kept).
        app.terminate()
        var options = LaunchOptions()
        options.resetsState = false
        options.contentSize = "UICTContentSizeCategoryAccessibilityXL"
        let penny = try await launch(options)
        try penny.waitForShell()

        let title = "Receipt cancel"
        try penny.startExpense(amount: "9.99", title: title)
        try penny.cancelPhotoPicker()
        try penny.wait(for: AccessibilityID.Screen.entryExtras)
        try penny.cancelFilePicker()
        try penny.wait(for: AccessibilityID.Screen.entryExtras)
        XCTAssertFalse(penny.element(AccessibilityID.Receipt.error).exists)
        XCTAssertFalse(penny.element(AccessibilityID.Receipt.attached).exists)
        screenshot("receipt-pickers-cancelled-xl")

        penny.closeDetails()
        XCTAssertEqual(try penny.value(of: AccessibilityID.EntryForm.title), title)
        XCTAssertEqual(penny.element(AccessibilityID.EntryForm.amount).value as? String, "9.99")
    }

    /// A 401 during the upload ends the session; after signing in again the unsaved entry
    /// comes back with its values.
    @MainActor
    func test_whenSessionEndsDuringUpload_Receipt_ShouldAskToSignInAndBringTheDraftBack() async throws {
        _ = try ReceiptFixtures.load()
        let stack = try await stack()
        let account = try await makeAccount("receipt-expired")
        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)

        let title = "Receipt expired"
        try penny.startExpense(amount: "15.00", title: title)
        try await stack.setFaults([FaultRule(method: "POST", pathPrefix: "/api/receipts", status: 401, times: 1)])
        try penny.pickFile(ReceiptFixtures.pdf)
        try penny.wait(for: AccessibilityID.Auth.notice, timeout: 30)
        XCTAssertEqual(try penny.value(of: AccessibilityID.Auth.email), account.email)
        screenshot("receipt-session-ended")
        try await stack.clearFaults()

        try penny.type(account.password, into: AccessibilityID.Auth.password)
        try penny.tap(AccessibilityID.Auth.signIn)
        try penny.waitForShell()
        try penny.openAddEntry()
        try penny.wait(for: "entryForm.restoredDraft")
        XCTAssertEqual(try penny.value(of: AccessibilityID.EntryForm.title), title)
    }

    /// The viewer on a receipt the server won't serve (404: missing or not this account's) says
    /// so; offline it offers Try again, which loads it once the server answers.
    @MainActor
    func test_whenReceiptCantBeRead_Viewer_ShouldExplainAndRecoverWhenOnline() async throws {
        let fixtures = try ReceiptFixtures.load()
        let stack = try await stack()
        let account = try await makeAccount("receipt-viewer")
        let uploaded = try await stack.uploadReceipt(
            token: account.token, name: ReceiptFixtures.pdf, mime: "application/pdf",
            data: try fixtures.data(ReceiptFixtures.pdf))
        let entryID = "receipt-\(stack.configuration.runID)-\(Device.name)"
        try await stack.addTransaction(
            token: account.token, id: entryID, title: "Receipt from the web", cents: 2_500, receipt: uploaded)

        let penny = try await launch()
        try penny.signIn(email: account.email, password: account.password)
        try penny.openActivity()
        try penny.waitForEntry(entryID).tap()

        try await stack.setFaults([FaultRule(method: "GET", pathPrefix: "/api/receipts/", status: 404)])
        try penny.tap(AccessibilityID.Receipt.detailRow)
        try penny.wait(for: AccessibilityID.Receipt.viewerError, timeout: 30)
        XCTAssertFalse(penny.element(AccessibilityID.Receipt.viewerRetry).exists, "404 is not retryable")
        screenshot("receipt-not-available")
        try penny.tap(AccessibilityID.Receipt.viewerClose)

        try await stack.setFaults([FaultRule.offline("/api/receipts/")])
        try penny.tap(AccessibilityID.Receipt.detailRow)
        try penny.wait(for: AccessibilityID.Receipt.viewerRetry, timeout: 60)
        try await stack.clearFaults()
        try penny.tap(AccessibilityID.Receipt.viewerRetry)
        try penny.wait(for: AccessibilityID.Receipt.viewerPDF, timeout: 30)
        try penny.tap(AccessibilityID.Receipt.viewerClose)
    }

    @MainActor
    private func entryID(_ stack: Stack, token: String, title: String) async throws -> String {
        let ledger = try await stack.ledger(token: token).ledger
        let entry = (ledger["transactions"] as? [[String: Any]] ?? []).first { $0["title"] as? String == title }
        return try XCTUnwrap(entry?["id"] as? String)
    }
}
