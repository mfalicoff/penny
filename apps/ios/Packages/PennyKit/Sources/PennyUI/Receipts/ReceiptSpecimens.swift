import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Xcode previews of the redesign cards MAZ-78 owns, named after their cards: `receipt` (the
// viewer), `receipt-upload` (an upload in progress, and a failed one), `entry-extras` with a
// receipt attached, and `save-error` while a receipt is still uploading. Made-up data only:
// the receipt is a generated two-page PDF.

/// Stands in for the API in previews: answers with a generated PDF, or reports some progress
/// and then waits forever (an upload in flight), or fails.
@MainActor
final class SpecimenReceipts: ReceiptTransfers {
    enum Behavior { case succeed, hang, fail }
    let behavior: Behavior
    var isAvailable = true

    init(_ behavior: Behavior = .succeed) {
        self.behavior = behavior
    }

    func upload(_ candidate: ReceiptCandidate, progress: @escaping @Sendable (Double) -> Void) async throws
        -> ReceiptReference
    {
        switch behavior {
        case .succeed:
            progress(1)
            return Self.reference
        case .hang:
            progress(0.45)
            try await Task.sleep(for: .seconds(3600))
            throw CancellationError()
        case .fail:
            throw APIError.unavailable(retryAfter: nil, message: nil)
        }
    }

    func download(id: String) async throws -> ReceiptFile {
        if behavior == .fail { throw APIError.notFound(message: nil) }
        return ReceiptFile(data: Self.pdf(), mime: ReceiptRules.pdf, filename: Self.reference.name)
    }

    static let reference = ReceiptReference(
        id: "0123456789abcdef0123456789abcdef", name: "cafe-receipt.pdf",
        uri: "/api/receipts/0123456789abcdef0123456789abcdef", mime: ReceiptRules.pdf)

    /// A minimal valid PDF with `pages` pages saying "Penny sample receipt".
    static func pdf(pages: Int = 2) -> Data {
        var objects: [Int: String] = [
            1: "<< /Type /Catalog /Pages 2 0 R >>",
            3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ]
        let pageIDs = (0..<pages).map { 4 + $0 * 2 }
        objects[2] = "<< /Type /Pages /Kids [\(pageIDs.map { "\($0) 0 R" }.joined(separator: " "))] /Count \(pages) >>"
        for (index, id) in pageIDs.enumerated() {
            let text =
                "BT /F1 18 Tf 30 340 Td (Penny sample receipt) Tj 0 -28 Td (Page \(index + 1) of \(pages)) Tj ET"
            objects[id] =
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 3 0 R >> >> /Contents \(id + 1) 0 R >>"
            objects[id + 1] = "<< /Length \(text.utf8.count) >>\nstream\n\(text)\nendstream"
        }
        let count = (objects.keys.max() ?? 0) + 1
        var body = "%PDF-1.4\n"
        var offsets: [Int: Int] = [:]
        for id in 1..<count {
            offsets[id] = body.utf8.count
            body += "\(id) 0 obj\n\(objects[id] ?? "")\nendobj\n"
        }
        let xref = body.utf8.count
        body += "xref\n0 \(count)\n0000000000 65535 f \n"
        for id in 1..<count {
            let offset = String(offsets[id] ?? 0)
            body += String(repeating: "0", count: 10 - offset.count) + offset + " 00000 n \n"
        }
        body += "trailer\n<< /Size \(count) /Root 1 0 R >>\nstartxref\n\(xref)\n%%EOF\n"
        return Data(body.utf8)
    }
}

@MainActor
private enum ReceiptSpecimen {
    static func shell(_ receipts: SpecimenReceipts?) -> ShellModel {
        let shell = Specimen.shell(DemoWorkspace(today: Specimen.today), demo: true)
        shell.receipts = receipts
        return shell
    }

    static func extras(_ receipts: SpecimenReceipts?, attached: Bool, uploading: Bool = false) -> some View {
        let shell = shell(receipts)
        var editor = EntryEditor(new: .expense, today: Specimen.today, ledger: Specimen.ledger())
        editor.draft.title = "Coffee with Mira"
        editor.draft.amount = "12.80"
        if attached { editor.draft.receipt = SpecimenReceipts.reference }
        let model = EntryFormModel(editor: editor) { _, _ in nil }
        let upload = ReceiptUploadModel(transfers: receipts) { model.editor.draft.receipt = $0 }
        if uploading {
            upload.upload(ReceiptCandidate(name: "receipt.jpg", mime: "image/jpeg", data: Data([0xFF, 0xD8, 0xFF])))
        }
        return SpecimenHost(shell: shell) {
            NavigationStack { EntryExtrasView(model: model, upload: upload, ledger: Specimen.ledger(), save: {}) }
        }
    }
}

#Preview("iphone-receipt · receipt") {
    ReceiptPreviewView(
        receipt: SpecimenReceipts.reference, transfers: SpecimenReceipts(),
        context: ReceiptPreviewContext(
            title: "Coffee with Mira", detail: "$12.80 total · Mon, Nov 9", symbol: "cup.and.saucer",
            color: PennyColor.category(.food)),
        onRemove: {})
}

#Preview("receipt (not available)") {
    ReceiptPreviewView(receipt: SpecimenReceipts.reference, transfers: SpecimenReceipts(.fail), context: nil)
}

#Preview("iphone-entry-extras · entry-extras (receipt attached)") {
    ReceiptSpecimen.extras(SpecimenReceipts(), attached: true)
}

#Preview("receipt-upload (uploading)") {
    ReceiptSpecimen.extras(SpecimenReceipts(.hang), attached: false, uploading: true)
}

#Preview("receipt-upload (failed)") {
    ReceiptSpecimen.extras(SpecimenReceipts(.fail), attached: false, uploading: true)
}

#Preview("receipt-upload (offline)") {
    let receipts = SpecimenReceipts()
    receipts.isAvailable = false
    return ReceiptSpecimen.extras(receipts, attached: false)
}

#Preview("entry-extras (demo)") {
    ReceiptSpecimen.extras(nil, attached: false)
}
