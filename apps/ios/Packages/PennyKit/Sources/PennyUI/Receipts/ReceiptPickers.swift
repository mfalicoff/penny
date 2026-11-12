import Foundation
import PennyData
import PennyDomain
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Which system picker a receipt comes from.
enum ReceiptPickerKind: String, Identifiable {
    case photo, file
    var id: String { rawValue }
}

/// The system photo picker and file picker for receipts (MAZ-78). Both run outside Penny's
/// process: Penny gets only the item the person chose, so neither needs photo library or file
/// access permission, and there is nothing to deny up front. What can still fail is reading
/// the chosen item (an iCloud photo that can't download, a file provider that refuses access);
/// that is reported as a refusal, and closing a picker without choosing changes nothing.
///
/// A chosen item is copied into `ReceiptFileCache`, checked with `ReceiptRules` (type,
/// signature, size before reading) off the main actor, removed again, and handed to the
/// upload model.
struct ReceiptPickers: ViewModifier {
    @Binding var presented: ReceiptPickerKind?
    let upload: ReceiptUploadModel
    @State private var photo: PhotosPickerItem?

    /// The file picker's types: the seven receipt types.
    static let fileTypes: [UTType] = [.pdf, .jpeg, .png, .webP, .gif, .heic, .heif]

    func body(content: Content) -> some View {
        content
            .photosPicker(
                isPresented: binding(.photo), selection: $photo, matching: .images,
                // The original bytes (HEIC stays HEIC): what was photographed is what is kept.
                preferredItemEncoding: .current
            )
            .fileImporter(isPresented: binding(.file), allowedContentTypes: Self.fileTypes) { result in
                switch result {
                case .success(let url): read { Self.readFile(url) }
                case .failure(let error): upload.refuse(ReceiptRefusal(picking: error))
                }
            }
            .onChange(of: photo) {
                guard let item = photo else { return }
                photo = nil
                read { await Self.readPhoto(item) }
            }
    }

    private func binding(_ kind: ReceiptPickerKind) -> Binding<Bool> {
        Binding(get: { presented == kind }, set: { if !$0, presented == kind { presented = nil } })
    }

    private func read(_ load: @escaping @Sendable () async -> Result<ReceiptCandidate, ReceiptRefusal>) {
        upload.beginReading()
        let upload = upload
        Task {
            let result = await Task.detached { await load() }.value
            // Cancelled or replaced while reading.
            guard upload.phase == .reading else { return }
            switch result {
            case .success(let candidate): upload.upload(candidate)
            case .failure(let refusal): upload.refuse(refusal)
            }
        }
    }

    /// A file from the file picker: read inside its security scope, typed by its extension.
    nonisolated static func readFile(_ url: URL) -> Result<ReceiptCandidate, ReceiptRefusal> {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return Result { () throws(ReceiptRefusal) in try ReceiptRules.check(fileAt: url) }
    }

    /// A photo from the photo library: copied out of the picker, typed by its signature.
    nonisolated static func readPhoto(_ item: PhotosPickerItem) async -> Result<ReceiptCandidate, ReceiptRefusal> {
        let picked: PickedReceiptFile?
        do {
            picked = try await item.loadTransferable(type: PickedReceiptFile.self)
        } catch {
            return .failure(.unreadable)
        }
        guard let picked else { return .failure(.unsupported) }
        defer { ReceiptFileCache.standard.remove(picked.url) }
        return Result { () throws(ReceiptRefusal) in try ReceiptRules.check(fileAt: picked.url, sniffs: true) }
    }
}

/// A photo the picker handed over as a file, copied into the receipt cache (the picker removes
/// its own copy as soon as the import returns).
nonisolated struct PickedReceiptFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            PickedReceiptFile(url: try ReceiptFileCache.standard.copy(received.file))
        }
    }
}

extension ReceiptRefusal {
    /// A picker that failed to hand over the file: a denied provider or an unreadable one.
    init(picking error: any Error) {
        let cocoa = error as? CocoaError
        self = cocoa?.code == .fileReadNoPermission ? .notPermitted : .unreadable
    }
}

extension View {
    func receiptPickers(_ presented: Binding<ReceiptPickerKind?>, upload: ReceiptUploadModel) -> some View {
        modifier(ReceiptPickers(presented: presented, upload: upload))
    }
}
