import Foundation
import PennyData
import PennyDomain
import Testing

@testable import PennyUI

@Suite("Receipt screens (MAZ-78)")
struct ReceiptViewTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest

    @Test("whenReceiptIsShown_ReceiptText_ShouldNameItsKindAndSize")
    func detail() {
        #expect(ReceiptText.detail(mime: "image/jpeg", bytes: 1_258_291) == "Photo · 1.2 MB")
        #expect(ReceiptText.detail(mime: ReceiptRules.pdf, bytes: nil) == "PDF")
        #expect(ReceiptText.symbol(ReceiptRules.pdf) == "doc.text")
        #expect(ReceiptText.percent(0.456) == "46%")
        #expect(ReceiptText.percent(2) == "100%")
    }

    @Test("whenInTheDemo_ShellModel_ShouldHaveNoReceiptUploads")
    func demoHasNone() {
        let shell = ShellModel(workspace: DemoWorkspace(today: today), session: .demo, today: today, leaveDemo: {})
        #expect(shell.receipts == nil)
        let upload = ReceiptUploadModel(transfers: shell.receipts) { _ in }
        #expect(!upload.isSupported)
    }

    @Test("whenPickersOffered_FileTypes_ShouldBeTheSevenReceiptTypes")
    func fileTypes() {
        #expect(ReceiptPickers.fileTypes.count == ReceiptRules.mimes.count)
        for type in ReceiptPickers.fileTypes {
            let mime = type.preferredMIMEType ?? ""
            #expect(ReceiptRules.mimes.contains(mime), "\(type) is \(mime)")
        }
    }

    @Test("whenTheSpecimenPDFIsChecked_ReceiptRules_ShouldAcceptIt")
    @MainActor
    func specimenPDF() throws {
        let pdf = SpecimenReceipts.pdf()
        let candidate = try ReceiptRules.check(name: "sample.pdf", declaredMime: ReceiptRules.pdf, data: pdf)
        #expect(candidate.byteCount == pdf.count)
    }
}
