public import Foundation
public import PennyDomain

/// The receipt file rules (MAZ-78), the same as the server's `ReceiptFormat` and the browser's
/// `apps/web/src/api/receipts.ts` (docs/reference/receipts.md, docs/ios-receipts.md): seven
/// types, 1 byte to 10 MiB, the type's signature in the first bytes, and a name of at most 255
/// UTF-16 units. The app checks them before uploading, so a bad file fails at once and sends
/// nothing; the server checks them all again.
public enum ReceiptRules {
    /// The decoded size limit, 10 MiB (`ReceiptFormat.MaxBytes`).
    public static let maxBytes = 10 * 1024 * 1024
    public static let maxNameLength = 255
    public static let pdf = "application/pdf"
    /// The contract's MIME types, in the server's order.
    public static let mimes = [pdf, "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]

    static let byExtension: [String: String] = [
        "pdf": pdf, "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp",
        "gif": "image/gif", "heic": "image/heic", "heif": "image/heif",
    ]

    /// The receipt type for a file extension (any case), or nil when it isn't one.
    public static func mime(forExtension pathExtension: String) -> String? {
        byExtension[pathExtension.lowercased()]
    }

    /// The usual extension for a receipt type.
    public static func fileExtension(for mime: String) -> String {
        switch mime {
        case pdf: "pdf"
        case "image/jpeg": "jpg"
        case "image/png": "png"
        case "image/webp": "webp"
        case "image/gif": "gif"
        case "image/heic": "heic"
        case "image/heif": "heif"
        default: "bin"
        }
    }

    /// What the person sees for a type: "PDF" or "Photo".
    public static func kind(_ mime: String) -> String { mime == pdf ? "PDF" : "Photo" }

    /// "512 B", "48 KB", "1.2 MB", as the browser shows sizes.
    public static func formatBytes(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return "\(Int((Double(bytes) / 1024).rounded())) KB" }
        let megabytes = Double(bytes) / (1024 * 1024)
        return "\((megabytes * 10).rounded() / 10) MB"
    }

    /// Whether `header` (the file's first bytes, 12 are enough) starts with `mime`'s signature.
    public static func matchesSignature(_ mime: String, header: Data) -> Bool {
        let bytes = [UInt8](header.prefix(12))
        func starts(_ prefix: [UInt8], at offset: Int = 0) -> Bool {
            bytes.count >= offset + prefix.count && Array(bytes[offset..<offset + prefix.count]) == prefix
        }
        switch mime {
        case pdf: return starts(Array("%PDF-".utf8))
        case "image/jpeg": return starts([0xFF, 0xD8, 0xFF])
        case "image/png": return starts([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        case "image/gif": return starts(Array("GIF87a".utf8)) || starts(Array("GIF89a".utf8))
        case "image/webp": return starts(Array("RIFF".utf8)) && starts(Array("WEBP".utf8), at: 8)
        case "image/heic", "image/heif": return starts(Array("ftyp".utf8), at: 4)
        default: return false
        }
    }

    /// The type a file's signature says it is, for photos from the photo library, which come
    /// without a reliable name. HEIF brands (`mif1`, `msf1`) are `image/heif`; every other
    /// `ftyp` box is taken as HEIC.
    public static func sniff(_ header: Data) -> String? {
        for mime in [pdf, "image/jpeg", "image/png", "image/gif", "image/webp"]
        where matchesSignature(mime, header: header) {
            return mime
        }
        guard matchesSignature("image/heic", header: header) else { return nil }
        let brand = String(decoding: header.dropFirst(8).prefix(4), as: UTF8.self)
        return ["mif1", "msf1"].contains(brand) ? "image/heif" : "image/heic"
    }

    /// The name to upload: trimmed, without control characters (the server refuses NUL),
    /// "receipt.<ext>" when nothing is left, and shortened to 255 UTF-16 units keeping its
    /// extension.
    public static func name(_ raw: String, mime: String) -> String {
        let cleaned = String(
            String.UnicodeScalarView(raw.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) })
        )
        .trimmingCharacters(in: .whitespacesAndNewlines)
        let name = cleaned.isEmpty ? "receipt.\(fileExtension(for: mime))" : cleaned
        guard name.utf16.count > maxNameLength else { return name }
        let pathExtension = (name as NSString).pathExtension
        let suffix = pathExtension.isEmpty || pathExtension.utf16.count > 8 ? "" : ".\(pathExtension)"
        var stem = suffix.isEmpty ? name : String(name.dropLast(suffix.count))
        while stem.utf16.count + suffix.utf16.count > maxNameLength { stem.removeLast() }
        return stem + suffix
    }

    /// Checks a picked file the way the server will.
    ///
    /// - Parameters:
    ///   - declaredMime: the type the picker or the file's extension gave, or nil to go by the
    ///     signature alone (photo library items).
    public static func check(name: String, declaredMime: String?, data: Data) throws(ReceiptRefusal) -> ReceiptCandidate
    {
        let mime: String
        if let declaredMime {
            guard mimes.contains(declaredMime) else { throw .unsupported }
            mime = declaredMime
        } else {
            guard let sniffed = sniff(data.prefix(12)) else { throw data.isEmpty ? .empty : .unsupported }
            mime = sniffed
        }
        guard !data.isEmpty else { throw .empty }
        guard data.count <= maxBytes else { throw .tooLarge }
        guard matchesSignature(mime, header: data.prefix(12)) else { throw .mismatch }
        return ReceiptCandidate(name: self.name(name, mime: mime), mime: mime, data: data)
    }

    /// Reads and checks the file at `url`. The size is checked before anything is read, so an
    /// oversized file never loads into memory. Call off the main actor.
    ///
    /// - Parameters:
    ///   - name: the name to upload; the file's own name when nil.
    ///   - declaredMime: as in `check(name:declaredMime:data:)`; the file's extension when it
    ///     is one of the receipt types and this is nil and `sniffs` is false.
    ///   - sniffs: go by the signature alone (photo library items).
    public static func check(
        fileAt url: URL, name: String? = nil, declaredMime: String? = nil, sniffs: Bool = false
    ) throws(ReceiptRefusal) -> ReceiptCandidate {
        let mime: String?
        if sniffs {
            mime = nil
        } else {
            guard let typed = declaredMime ?? self.mime(forExtension: url.pathExtension) else { throw .unsupported }
            mime = typed
        }
        let size: Int
        do {
            size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        } catch {
            throw ReceiptRefusal(reading: error)
        }
        if size > maxBytes { throw .tooLarge }
        let data: Data
        do {
            data = try Data(contentsOf: url, options: .mappedIfSafe)
        } catch {
            throw ReceiptRefusal(reading: error)
        }
        return try check(name: name ?? url.lastPathComponent, declaredMime: mime, data: data)
    }

    /// The receipt id in a served receipt link (`/api/receipts/<id>`), or nil for a link this
    /// server doesn't serve (such as a device file path), which can only be shown by name.
    public static func servedID(_ receipt: ReceiptReference) -> String? {
        let prefix = "/api/receipts/"
        guard receipt.uri.hasPrefix(prefix) else { return nil }
        let segment = receipt.uri.dropFirst(prefix.count)
        guard !segment.isEmpty, !segment.contains(where: { "/?#".contains($0) }),
            let id = String(segment).removingPercentEncoding, !id.isEmpty
        else { return nil }
        return id
    }
}

/// A checked file, ready to upload.
public struct ReceiptCandidate: Equatable, Sendable {
    public let name: String
    public let mime: String
    public let data: Data

    public var byteCount: Int { data.count }

    public init(name: String, mime: String, data: Data) {
        self.name = name
        self.mime = mime
        self.data = data
    }
}

/// Why a picked file can't be attached. Nothing was uploaded; the person chooses another file.
public enum ReceiptRefusal: Error, Equatable, Sendable {
    case empty
    case tooLarge
    case unsupported
    /// The bytes don't match the type (damaged, or renamed).
    case mismatch
    /// The file couldn't be read (an iCloud file that isn't downloaded, a provider error).
    case unreadable
    /// The system refused access to the file (a provider or security-scope denial).
    case notPermitted

    init(reading error: any Error) {
        let cocoa = error as? CocoaError
        self = cocoa?.code == .fileReadNoPermission ? .notPermitted : .unreadable
    }

    /// The browser's wording (`RECEIPT_MESSAGES`), with the next step.
    public var message: String {
        switch self {
        case .empty: "This file is empty. Choose a photo or PDF."
        case .tooLarge: "This file is larger than 10 MB. Choose a smaller photo or PDF."
        case .unsupported: "Penny can attach photos (JPEG, PNG, WebP, GIF, HEIC) and PDFs. Choose one of those."
        case .mismatch: "This file isn't a valid photo or PDF. It may be damaged or renamed. Choose another file."
        case .unreadable: "Penny couldn't read this file. Choose it again."
        case .notPermitted:
            "Penny wasn't allowed to open this file. Choose it again, or save a copy to On My iPhone in Files first."
        }
    }
}
