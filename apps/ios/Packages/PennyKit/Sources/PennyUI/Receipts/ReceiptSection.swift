import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The Receipt group of More details (`entry-extras` and `receipt-upload` cards): the linked
/// receipt (tap to preview, × to remove), an upload in progress with Cancel, a failure with
/// Try again or Dismiss, and the Photo and File or PDF buttons. Expenses only.
///
/// The draft keeps everything else while a file is chosen, uploaded, refused or fails. Offline,
/// the buttons are disabled and the footer says why; the entry itself still saves offline, and
/// a receipt uploaded earlier stays linked.
struct ReceiptAttachmentSection: View {
    @Environment(ShellModel.self) private var shell
    @Binding var receipt: ReceiptReference?
    let upload: ReceiptUploadModel
    /// The entry the receipt belongs to, for the viewer's footer card.
    let context: ReceiptPreviewContext?
    @State private var picker: ReceiptPickerKind?
    @State private var previewing: ReceiptPreviewRequest?
    @State private var choosingFromInbox = false

    var body: some View {
        Section {
            if let receipt { attached(receipt) }
            switch upload.phase {
            case .idle: EmptyView()
            case .reading: reading
            case .uploading(let name, let fraction): uploading(name, fraction: fraction)
            case .failed(let failure): failed(failure)
            }
            if upload.isSupported { buttons }
        } header: {
            Text("Receipt").cardSectionHeader()
        } footer: {
            Text(footer).accessibilityIdentifier("entryExtras.receiptHint")
        }
    }

    private var footer: String {
        if !upload.isSupported { return ReceiptText.demo }
        if !upload.isAvailable { return ReceiptText.offline }
        if let receipt {
            let text = "Removing the receipt detaches it from this entry when you save."
            // An emailed receipt (MAZ-184) isn't lost: it returns to the receipt inbox.
            return shell.receiptInbox.isInboxReceipt(receipt.id) ? "\(text) \(InboxText.returnsToInbox)" : text
        }
        return ReceiptText.supported
    }

    /// From inbox is offered when the server takes emailed receipts and there is something to
    /// attach (MAZ-184).
    private var offersInbox: Bool {
        shell.receiptInbox.isEnabled && shell.receiptInbox.toAttachCount > 0
    }

    private func attached(_ receipt: ReceiptReference) -> some View {
        HStack(spacing: 12) {
            Button {
                previewing = ReceiptPreviewRequest(receipt: receipt)
            } label: {
                HStack(spacing: 12) {
                    ReceiptThumbnail(mime: receipt.mime)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(receipt.name)
                            .font(.headline)
                            .foregroundStyle(PennyColor.label)
                            .lineLimit(2)
                            .truncationMode(.middle)
                        Text(ReceiptText.detail(mime: receipt.mime, bytes: upload.sizes[receipt.id]))
                            .font(.subheadline)
                            .foregroundStyle(PennyColor.secondaryLabel)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Opens the receipt")
            .accessibilityIdentifier("entryExtras.receipt")
            Button("Remove receipt", systemImage: "xmark") { self.receipt = nil }
                .labelStyle(.iconOnly)
                .font(.footnote.weight(.bold))
                .foregroundStyle(PennyColor.secondaryLabel)
                .frame(width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
                .background(PennyColor.fill, in: Circle().inset(by: 6))
                .buttonStyle(.plain)
                .accessibilityIdentifier("entryExtras.removeReceipt")
        }
        .receiptViewer($previewing) { request in
            ReceiptPreviewView(
                receipt: request.receipt, transfers: shell.receipts,
                localData: upload.localData(for: request.receipt.id),
                context: context, onRemove: { self.receipt = nil })
        }
    }

    private var reading: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text("Reading the file…").foregroundStyle(PennyColor.secondaryLabel)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("receiptUpload.reading")
    }

    private func uploading(_ name: String, fraction: Double) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                ReceiptThumbnail(mime: nil)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.headline).lineLimit(1).truncationMode(.middle)
                    Text("Uploading… \(ReceiptText.percent(fraction)) · Save waits for it")
                        .font(.subheadline)
                        .foregroundStyle(PennyColor.secondaryLabel)
                }
                Spacer(minLength: 0)
                Button("Cancel upload", systemImage: "xmark") { upload.cancel() }
                    .labelStyle(.iconOnly)
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .frame(width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
                    .background(PennyColor.fill, in: Circle().inset(by: 6))
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("receiptUpload.cancel")
            }
            ProgressView(value: fraction)
                .tint(PennyColor.tint)
                .accessibilityLabel("Uploading \(name)")
                .accessibilityValue(ReceiptText.percent(fraction))
                .accessibilityIdentifier("receiptUpload.progress")
        }
        .padding(.vertical, 4)
    }

    private func failed(_ failure: ReceiptUploadFailure) -> some View {
        StatusBanner(tone: .error, title: "Couldn't attach the receipt", message: failure.message) {
            HStack(spacing: 8) {
                if failure.canRetry {
                    InlineActionButton("Try again") { upload.retry() }
                        .accessibilityIdentifier("receiptUpload.retry")
                }
                Button("Dismiss") { upload.dismiss() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .buttonStyle(.plain)
                    .frame(minHeight: Metrics.minTouchTarget)
                    .accessibilityIdentifier("receiptUpload.dismiss")
            }
        }
        .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
        .accessibilityIdentifier("receiptUpload.error")
    }

    private var buttons: some View {
        HStack(spacing: 0) {
            pickerButton(receipt == nil ? "Photo" : "Replace with photo", short: "Photo", systemImage: "photo", .photo)
                .accessibilityIdentifier("entryExtras.receiptPhoto")
            Divider()
            pickerButton(
                receipt == nil ? "File or PDF" : "Replace with a file or PDF", short: "File or PDF",
                systemImage: "doc", .file
            )
            .accessibilityIdentifier("entryExtras.receiptFile")
            if offersInbox {
                Divider()
                Button {
                    choosingFromInbox = true
                } label: {
                    Label("From inbox", systemImage: "tray.and.arrow.down")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
                }
                .foregroundStyle(PennyColor.tintText)
                .disabled(!shell.receiptInbox.isAvailable)
                .accessibilityLabel(receipt == nil ? "From inbox" : "Replace with a receipt from your inbox")
                .accessibilityIdentifier("entryExtras.receiptInbox")
            }
        }
        .buttonStyle(.borderless)
        .disabled(upload.isBusy || !upload.isAvailable)
        .receiptPickers($picker, upload: upload)
        .sheet(isPresented: $choosingFromInbox) {
            ReceiptInboxPicker { file in
                upload.cancel()
                receipt = ReceiptInboxRules.reference(file)
            }
            .environment(shell)
        }
        .task {
            // Which receipts came from the inbox, for the removal hint (MAZ-184).
            await shell.receiptInbox.refresh()
            if shell.receiptInbox.isEnabled, receipt != nil { await shell.receiptInbox.refresh(.attached) }
        }
    }

    private func pickerButton(_ label: String, short: String, systemImage: String, _ kind: ReceiptPickerKind)
        -> some View
    {
        Button {
            picker = kind
        } label: {
            Label(short, systemImage: systemImage)
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
        }
        .foregroundStyle(PennyColor.tintText)
        .accessibilityLabel(label)
    }
}

/// The small tile beside a receipt's name: a photo or a document.
struct ReceiptThumbnail: View {
    /// Nil while uploading (the type isn't confirmed yet).
    let mime: String?

    var body: some View {
        Image(systemName: mime == nil ? "arrow.up.doc" : ReceiptText.symbol(mime ?? ""))
            .font(.title3)
            .foregroundStyle(PennyColor.secondaryLabel)
            .frame(width: 44, height: 52)
            .background(
                PennyColor.secondarySurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PennyColor.separator)
            )
            .accessibilityHidden(true)
    }
}

/// Opens the receipt viewer for one receipt.
struct ReceiptPreviewRequest: Identifiable {
    let receipt: ReceiptReference
    var id: String { receipt.id }
}

/// Text for receipts.
enum ReceiptText {
    static let supported = "A photo (JPEG, PNG, WebP, GIF or HEIC) or a PDF, up to 10 MB."
    static let offline = "Connect to the internet to attach a receipt. The rest of the entry still saves offline."
    static let demo = "Receipts are kept on your server, so the demo can't attach one. Sign in to add receipts."

    /// "Photo · 1.2 MB", or "PDF" when the size isn't known.
    static func detail(mime: String, bytes: Int?) -> String {
        let kind = ReceiptRules.kind(mime)
        guard let bytes else { return kind }
        return "\(kind) · \(ReceiptRules.formatBytes(bytes))"
    }

    static func symbol(_ mime: String) -> String {
        mime == ReceiptRules.pdf ? "doc.text" : "photo"
    }

    static func percent(_ fraction: Double) -> String {
        "\(Int((min(max(fraction, 0), 1) * 100).rounded()))%"
    }
}
