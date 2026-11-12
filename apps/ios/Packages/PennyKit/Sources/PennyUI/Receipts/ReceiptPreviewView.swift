import Foundation
import PDFKit
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// The entry a receipt belongs to, for the viewer's footer card.
struct ReceiptPreviewContext: Equatable {
    var title: String
    /// "$12.80 total · Mon, Nov 9".
    var detail: String
    var symbol: String
    var color: Color
}

/// The receipt viewer (`receipt` card, MAZ-78): a dark full-screen cover with the receipt's
/// name and type, Share, and in the entry form Remove. The receipt is downloaded with the
/// session into a temporary file (`ReceiptPreviewModel`), shown as a zoomable photo or a PDF
/// (PDFKit; links and forms in the PDF do nothing), and shared from that file, so "Save to
/// Files" and "Open in…" get the original bytes under the original name. Closing removes the
/// file and cancels a download in flight. The app lock covers it like everything else.
struct ReceiptPreviewView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: ReceiptPreviewModel
    private let context: ReceiptPreviewContext?
    private let onRemove: (() -> Void)?

    init(
        receipt: ReceiptReference, transfers: (any ReceiptTransfers)?, localData: Data? = nil,
        context: ReceiptPreviewContext?, onRemove: (() -> Void)? = nil
    ) {
        _model = State(initialValue: ReceiptPreviewModel(receipt: receipt, transfers: transfers, localData: localData))
        self.context = context
        self.onRemove = onRemove
    }

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .safeAreaInset(edge: .bottom) {
                    if let context { ReceiptEntryCard(context: context).padding(.horizontal, Metrics.gutter) }
                }
                .background(PennyColor.background.ignoresSafeArea())
                .toolbar { toolbar }
                .toolbarTitleDisplayModeInline()
                #if os(iOS)
                    .toolbarColorScheme(.dark, for: .navigationBar)
                    .toolbarBackground(.hidden, for: .navigationBar)
                #endif
        }
        .environment(\.colorScheme, .dark)
        .onAppear { model.load() }
        .onDisappear { model.close() }
        .accessibilityIdentifier("screen.receipt")
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Close", systemImage: "xmark") { dismiss() }
                .accessibilityIdentifier("receipt.close")
        }
        ToolbarItem(placement: .principal) {
            VStack(spacing: 0) {
                Text(model.receipt.name).font(.headline).lineLimit(1).truncationMode(.middle)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("receipt.title")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if case .ready(let file) = model.state {
                ShareLink(item: file.url, preview: SharePreview(model.receipt.name)) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("receipt.share")
            }
            if let onRemove {
                Button("Remove receipt", systemImage: "trash", role: .destructive) {
                    onRemove()
                    dismiss()
                }
                .tint(PennyColor.danger)
                .accessibilityIdentifier("receipt.remove")
            }
        }
    }

    private var subtitle: String {
        if case .ready(let file) = model.state {
            return ReceiptText.detail(mime: file.mime, bytes: file.byteCount)
        }
        return ReceiptRules.kind(model.receipt.mime)
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            VStack(spacing: 12) {
                ProgressView()
                Text("Loading the receipt…").font(.subheadline).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("receipt.loading")
        case .ready(let file):
            if file.mime == ReceiptRules.pdf {
                ReceiptPDFView(url: file.url)
            } else {
                ReceiptPhotoView(url: file.url)
            }
        case .failed(let failure):
            ContentUnavailableView {
                Label(
                    failure == .notAvailable ? "Receipt not available" : "Couldn't show the receipt",
                    systemImage: failure == .notAvailable ? "lock.doc" : "exclamationmark.triangle")
            } description: {
                Text(failure.message)
            } actions: {
                if failure.canRetry {
                    Button("Try again") { model.load() }
                        .buttonStyle(.borderedProminent)
                        .tint(PennyColor.tint)
                        .accessibilityIdentifier("receipt.retry")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("receipt.error")
        }
    }
}

/// A photo receipt: fits the screen, pinch or double-tap to zoom, drag to pan when zoomed.
/// A photo the system can't decode says so and keeps Share.
private struct ReceiptPhotoView: View {
    let url: URL
    @State private var image: Image?
    @State private var undecodable = false
    @State private var scale = 1.0
    @State private var settledScale = 1.0
    @State private var offset = CGSize.zero
    @State private var settledOffset = CGSize.zero

    var body: some View {
        Group {
            if let image {
                VStack(spacing: 12) {
                    image
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(scale)
                        .offset(offset)
                        .gesture(zoom.simultaneously(with: pan))
                        .onTapGesture(count: 2) { toggleZoom() }
                        .accessibilityLabel("Receipt photo")
                        .accessibilityAddTraits(.isImage)
                        .accessibilityIdentifier("receipt.image")
                    Text("Pinch to zoom").font(.footnote).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .padding(Metrics.gutter)
            } else if undecodable {
                ContentUnavailableView(
                    "This photo can't be shown", systemImage: "photo.badge.exclamationmark",
                    description: Text("Penny can't display this photo format. Share it to open it in another app.")
                )
                .accessibilityIdentifier("receipt.undecodable")
            } else {
                ProgressView()
            }
        }
        .task(id: url) {
            let path = url.path(percentEncoded: false)
            let decoded = await Task.detached { ReceiptImageDecoder.decode(path) }.value
            image = decoded
            undecodable = decoded == nil
        }
    }

    private var zoom: some Gesture {
        MagnifyGesture()
            .onChanged { value in scale = min(max(settledScale * value.magnification, 1), 6) }
            .onEnded { _ in
                settledScale = scale
                if scale == 1 { resetPan() }
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                guard scale > 1 else { return }
                offset = CGSize(
                    width: settledOffset.width + value.translation.width,
                    height: settledOffset.height + value.translation.height)
            }
            .onEnded { _ in settledOffset = offset }
    }

    private func toggleZoom() {
        scale = scale > 1 ? 1 : 2.5
        settledScale = scale
        if scale == 1 { resetPan() }
    }

    private func resetPan() {
        offset = .zero
        settledOffset = .zero
    }
}

/// Decodes a receipt photo off the main actor, ready to draw.
nonisolated enum ReceiptImageDecoder {
    static func decode(_ path: String) -> Image? {
        #if os(iOS)
            guard let image = UIImage(contentsOfFile: path) else { return nil }
            return Image(uiImage: image.preparingForDisplay() ?? image)
        #else
            guard let image = NSImage(contentsOfFile: path) else { return nil }
            return Image(nsImage: image)
        #endif
    }
}

/// A PDF receipt through PDFKit, one continuous column, zoomable. A PDF that can't be opened
/// (damaged, password-protected) says so and keeps Share.
private struct ReceiptPDFView: View {
    let url: URL
    @State private var document: PDFDocument?
    @State private var damaged = false

    var body: some View {
        Group {
            if let document {
                VStack(spacing: 8) {
                    PDFDocumentView(document: document)
                        .accessibilityLabel(
                            "Receipt PDF, \(document.pageCount == 1 ? "1 page" : "\(document.pageCount) pages")"
                        )
                        .accessibilityIdentifier("receipt.pdf")
                    Text(document.pageCount == 1 ? "1 page" : "\(document.pageCount) pages")
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("receipt.pageCount")
                }
            } else if damaged {
                ContentUnavailableView(
                    "This PDF can't be shown", systemImage: "doc.badge.exclamationmark",
                    description: Text(
                        "It may be damaged or protected with a password. Share it to open it in another app.")
                )
                .accessibilityIdentifier("receipt.undecodable")
            } else {
                ProgressView()
            }
        }
        .task(id: url) {
            let opened = PDFDocument(url: url)
            // A locked PDF opens but shows nothing; treat it like a damaged one.
            if let opened, opened.pageCount > 0, !opened.isLocked {
                document = opened
            } else {
                damaged = true
            }
        }
    }
}

#if os(iOS)
    private struct PDFDocumentView: UIViewRepresentable {
        let document: PDFDocument

        func makeUIView(context: Context) -> PDFView {
            let view = PDFView()
            view.autoScales = true
            view.displayMode = .singlePageContinuous
            view.displayDirection = .vertical
            view.backgroundColor = .black
            // Links inside a receipt never open anything.
            view.delegate = context.coordinator
            view.document = document
            return view
        }

        func updateUIView(_ view: PDFView, context: Context) {
            if view.document !== document { view.document = document }
        }

        func makeCoordinator() -> Coordinator { Coordinator() }

        final class Coordinator: NSObject, PDFViewDelegate {
            func pdfViewWillClick(onLink sender: PDFView, with url: URL) {}
        }
    }
#else
    private struct PDFDocumentView: NSViewRepresentable {
        let document: PDFDocument

        func makeNSView(context: Context) -> PDFView {
            let view = PDFView()
            view.autoScales = true
            view.document = document
            return view
        }

        func updateNSView(_ view: PDFView, context: Context) {}
    }
#endif

/// The entry under the receipt: category icon, title, total and date.
private struct ReceiptEntryCard: View {
    let context: ReceiptPreviewContext

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(symbol: context.symbol, color: context.color, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.title).font(.headline).lineLimit(2)
                Text(context.detail).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous).strokeBorder(PennyColor.separator)
        )
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("receipt.entry")
    }
}

extension View {
    /// Presents the receipt viewer over everything: a full-screen cover on iOS (a sheet on the
    /// macOS test host).
    func receiptViewer<Content: View>(
        _ item: Binding<ReceiptPreviewRequest?>, @ViewBuilder content: @escaping (ReceiptPreviewRequest) -> Content
    ) -> some View {
        #if os(iOS)
            fullScreenCover(item: item, content: content)
        #else
            sheet(item: item, content: content)
        #endif
    }
}
