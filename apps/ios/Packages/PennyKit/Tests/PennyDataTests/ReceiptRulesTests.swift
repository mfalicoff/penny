import Foundation
import PennyData
import PennyDomain
import Testing

/// Synthetic receipt bytes, built here so nothing personal is committed (the same shapes as
/// the browser's `e2e/fixtures/receipts.ts`).
enum ReceiptBytes {
    static let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    static let jpeg = Data([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1])
    static let pdf = Data("%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF\n".utf8)
    static let gif87 = Data("GIF87a".utf8) + Data([1, 0, 1, 0, 0, 0])
    static let gif89 = Data("GIF89a".utf8) + Data([1, 0, 1, 0, 0, 0])
    static let webp = Data("RIFF".utf8) + Data([0x24, 0, 0, 0]) + Data("WEBPVP8 ".utf8)
    static let heic = Data([0, 0, 0, 0x18]) + Data("ftypheic".utf8) + Data([0, 0, 0, 0])
    static let heif = Data([0, 0, 0, 0x18]) + Data("ftypmif1".utf8) + Data([0, 0, 0, 0])

    /// `prefix` padded with zeros to `size` bytes.
    static func padded(_ prefix: Data, to size: Int) -> Data {
        prefix + Data(count: max(0, size - prefix.count))
    }
}

@Suite("Receipt file rules")
struct ReceiptRulesTests {
    @Test(
        "whenFileHasTheSignatureOfItsType_Check_ShouldAccept",
        arguments: [
            ("a.png", "image/png", ReceiptBytes.png), ("a.jpg", "image/jpeg", ReceiptBytes.jpeg),
            ("a.pdf", "application/pdf", ReceiptBytes.pdf), ("a.gif", "image/gif", ReceiptBytes.gif87),
            ("b.gif", "image/gif", ReceiptBytes.gif89), ("a.webp", "image/webp", ReceiptBytes.webp),
            ("a.heic", "image/heic", ReceiptBytes.heic), ("a.heif", "image/heif", ReceiptBytes.heif),
        ])
    func accepted(name: String, mime: String, data: Data) throws {
        let candidate = try ReceiptRules.check(name: name, declaredMime: mime, data: data)
        #expect(candidate == ReceiptCandidate(name: name, mime: mime, data: data))
    }

    @Test(
        "whenBytesDontMatchTheType_Check_ShouldRefuseAsMismatch",
        arguments: [
            ("application/pdf", ReceiptBytes.png), ("image/png", ReceiptBytes.jpeg), ("image/jpeg", ReceiptBytes.pdf),
            ("image/webp", Data("RIFF0000AVI ".utf8)), ("image/gif", Data("GIF88a000000".utf8)),
            ("image/heic", Data("0000mdat0000".utf8)),
        ])
    func mismatch(mime: String, data: Data) {
        #expect(throws: ReceiptRefusal.mismatch) { try ReceiptRules.check(name: "x", declaredMime: mime, data: data) }
    }

    @Test("whenTypeIsNotAReceiptType_Check_ShouldRefuseAsUnsupported")
    func unsupported() {
        #expect(throws: ReceiptRefusal.unsupported) {
            try ReceiptRules.check(name: "notes.txt", declaredMime: "text/plain", data: Data("hi".utf8))
        }
        #expect(throws: ReceiptRefusal.unsupported) {
            try ReceiptRules.check(name: "x", declaredMime: nil, data: Data("plain text!!".utf8))
        }
    }

    @Test("whenFileIsEmpty_Check_ShouldRefuseAsEmpty")
    func empty() {
        #expect(throws: ReceiptRefusal.empty) {
            try ReceiptRules.check(name: "a.pdf", declaredMime: ReceiptRules.pdf, data: Data())
        }
        #expect(throws: ReceiptRefusal.empty) { try ReceiptRules.check(name: "photo", declaredMime: nil, data: Data()) }
    }

    @Test("whenFileIsAtOrOverTenMebibytes_Check_ShouldAcceptTheLimitAndRefuseOneByteMore")
    func sizeLimit() throws {
        let limit = ReceiptBytes.padded(ReceiptBytes.png, to: ReceiptRules.maxBytes)
        #expect(try ReceiptRules.check(name: "a.png", declaredMime: "image/png", data: limit).byteCount == 10_485_760)
        let over = ReceiptBytes.padded(ReceiptBytes.png, to: ReceiptRules.maxBytes + 1)
        #expect(throws: ReceiptRefusal.tooLarge) {
            try ReceiptRules.check(name: "a.png", declaredMime: "image/png", data: over)
        }
    }

    @Test("whenPhotoComesWithoutAType_Sniff_ShouldReadTheSignature")
    func sniff() {
        #expect(ReceiptRules.sniff(ReceiptBytes.png) == "image/png")
        #expect(ReceiptRules.sniff(ReceiptBytes.jpeg) == "image/jpeg")
        #expect(ReceiptRules.sniff(ReceiptBytes.heic) == "image/heic")
        #expect(ReceiptRules.sniff(ReceiptBytes.heif) == "image/heif")
        #expect(ReceiptRules.sniff(ReceiptBytes.webp) == "image/webp")
        #expect(ReceiptRules.sniff(Data("hello world!".utf8)) == nil)
    }

    @Test("whenExtensionIsAnyCase_MimeForExtension_ShouldMatchTheBrowser")
    func extensions() {
        #expect(ReceiptRules.mime(forExtension: "PDF") == "application/pdf")
        #expect(ReceiptRules.mime(forExtension: "JPEG") == "image/jpeg")
        #expect(ReceiptRules.mime(forExtension: "Heic") == "image/heic")
        #expect(ReceiptRules.mime(forExtension: "txt") == nil)
        #expect(ReceiptRules.fileExtension(for: "image/jpeg") == "jpg")
    }

    @Test("whenNameIsBlankLongOrHasControlCharacters_Name_ShouldMakeItStorable")
    func names() {
        #expect(ReceiptRules.name("  lunch.pdf  ", mime: ReceiptRules.pdf) == "lunch.pdf")
        #expect(ReceiptRules.name("", mime: "image/png") == "receipt.png")
        #expect(ReceiptRules.name("a\u{0}b\u{7}.jpg", mime: "image/jpeg") == "ab.jpg")
        let long = String(repeating: "x", count: 300) + ".pdf"
        let short = ReceiptRules.name(long, mime: ReceiptRules.pdf)
        #expect(short.utf16.count == 255)
        #expect(short.hasSuffix(".pdf"))
        // Counted in UTF-16 units, like the server: each emoji is two.
        let emoji = String(repeating: "🧾", count: 200) + ".png"
        let cut = ReceiptRules.name(emoji, mime: "image/png")
        #expect(cut.utf16.count <= 255 && cut.hasSuffix(".png") && !cut.contains("\u{FFFD}"))
    }

    @Test("whenSizeIsShown_FormatBytes_ShouldMatchTheBrowser")
    func bytes() {
        #expect(ReceiptRules.formatBytes(512) == "512 B")
        #expect(ReceiptRules.formatBytes(48 * 1024) == "48 KB")
        #expect(ReceiptRules.formatBytes(1_258_291) == "1.2 MB")
        #expect(ReceiptRules.formatBytes(ReceiptRules.maxBytes) == "10.0 MB")
    }

    @Test("whenLinkIsServedOrNot_ServedID_ShouldReturnTheIdOnlyForServedLinks")
    func servedID() {
        func reference(_ uri: String) -> ReceiptReference {
            ReceiptReference(id: "r", name: "n", uri: uri, mime: ReceiptRules.pdf)
        }
        #expect(ReceiptRules.servedID(reference("/api/receipts/0a1b")) == "0a1b")
        #expect(ReceiptRules.servedID(reference("/api/receipts/receipt")) == "receipt")
        #expect(ReceiptRules.servedID(reference("file:///var/mobile/receipt.jpg")) == nil)
        #expect(ReceiptRules.servedID(reference("/api/receipts/a/b")) == nil)
        #expect(ReceiptRules.servedID(reference("/api/receipts/a?x=1")) == nil)
        #expect(ReceiptRules.servedID(reference("/api/receipts/")) == nil)
    }

    // MARK: Files

    @Test("whenFileIsOversized_CheckFile_ShouldRefuseBeforeReadingIt")
    func oversizedFile() throws {
        let folder = try TemporaryFolder()
        let url = folder.url.appending(path: "huge.pdf")
        #expect(FileManager.default.createFile(atPath: url.path(), contents: Data("%PDF-".utf8)))
        let handle = try FileHandle(forWritingTo: url)
        // A sparse file: 10 MiB + 1 without writing them.
        try handle.truncate(atOffset: UInt64(ReceiptRules.maxBytes + 1))
        try handle.close()
        #expect(throws: ReceiptRefusal.tooLarge) { try ReceiptRules.check(fileAt: url) }
    }

    @Test("whenFileIsRenamed_CheckFile_ShouldGoByItsExtensionAndRefuseTheMismatch")
    func renamedFile() throws {
        let folder = try TemporaryFolder()
        let url = folder.url.appending(path: "receipt.pdf")
        try ReceiptBytes.png.write(to: url)
        #expect(throws: ReceiptRefusal.mismatch) { try ReceiptRules.check(fileAt: url) }
        let text = folder.url.appending(path: "notes.txt")
        try Data("hello".utf8).write(to: text)
        #expect(throws: ReceiptRefusal.unsupported) { try ReceiptRules.check(fileAt: text) }
    }

    @Test("whenFileIsMissingOrValid_CheckFile_ShouldRefuseUnreadableOrReadIt")
    func readFile() throws {
        let folder = try TemporaryFolder()
        #expect(throws: ReceiptRefusal.unreadable) {
            try ReceiptRules.check(fileAt: folder.url.appending(path: "gone.pdf"))
        }
        let photo = folder.url.appending(path: "IMG_0001")
        try ReceiptBytes.heic.write(to: photo)
        let candidate = try ReceiptRules.check(fileAt: photo, sniffs: true)
        #expect(candidate.mime == "image/heic" && candidate.name == "IMG_0001" && candidate.data == ReceiptBytes.heic)
    }

    @Test("whenEveryRefusal_Message_ShouldNameTheNextStep")
    func messages() {
        let all: [ReceiptRefusal] = [.empty, .tooLarge, .unsupported, .mismatch, .unreadable, .notPermitted]
        for refusal in all {
            #expect(refusal.message.contains("Choose"), "\(refusal) does not say what to do next")
        }
        #expect(ReceiptRefusal.tooLarge.message == "This file is larger than 10 MB. Choose a smaller photo or PDF.")
    }
}

/// A folder under the temporary directory, removed when the test ends.
final class TemporaryFolder {
    let url: URL

    init() throws {
        url = FileManager.default.temporaryDirectory.appending(path: "penny-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit {
        try? FileManager.default.removeItem(at: url)
    }
}
