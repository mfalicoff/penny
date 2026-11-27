import Foundation
import PennyDesign
import PennyDomain
import SwiftUI

#if canImport(UIKit)
    import LinkPresentation
    import UIKit
#endif

/// The share image (`iphone-year-review-share*` cards, MAZ-292): "My 2026", the top three
/// categories, and tiles for the busiest month, trips, who paid and days without spending, from
/// `YearShareContent` only. It is always light: a picture people send elsewhere doesn't follow the
/// app's appearance.
struct YearShareImage: View {
    let content: YearShareContent

    static let size = CGSize(width: 236, height: 420)
    /// The rendered PNG's scale: 944 × 1680 pixels, about a phone screen.
    static let scale: CGFloat = 4

    static let ink = Color(red: 0x16 / 255, green: 0x12 / 255, blue: 0x0F / 255)
    static let muted = Color(red: 0x57 / 255, green: 0x52 / 255, blue: 0x4D / 255)
    static let faint = Color(red: 0xA9 / 255, green: 0xA4 / 255, blue: 0x9D / 255)
    static let paper = Color(red: 0xFB / 255, green: 0xF7 / 255, blue: 0xF2 / 255)
    static let brand = Color(red: 0xE4 / 255, green: 0x57 / 255, blue: 0x2E / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "leaf.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.white)
                    .frame(width: 18, height: 18)
                    .background(Self.brand, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                Text(YearShareContent.brand).font(.system(size: 12, weight: .bold))
            }
            Text(content.title)
                .font(.system(size: 26, weight: .heavy))
                .kerning(-0.8)
                .padding(.top, 12)
            Group {
                if let total = content.total {
                    Text("\(Text(total).fontWeight(.bold).foregroundStyle(Self.ink))\(content.subtitle)")
                } else {
                    Text(content.subtitle)
                }
            }
            .font(.system(size: 13))
            .foregroundStyle(Self.muted)
            .padding(.top, 4)
            if !content.categories.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(content.categories, id: \.rank) { category in
                        HStack(spacing: 7) {
                            Text("\(category.rank)").foregroundStyle(Self.muted).frame(width: 12, alignment: .leading)
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(PennyColor.category(category.color))
                                .frame(width: 8, height: 8)
                            Text(category.name).lineLimit(1)
                            Spacer(minLength: 4)
                            if let amount = category.amount {
                                Text(amount).font(.system(size: 11, weight: .medium)).foregroundStyle(Self.muted)
                            }
                            Text(category.percent)
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .monospacedDigit()
                    }
                }
                .padding(.top, 14)
            }
            tiles.padding(.top, 14)
            Spacer(minLength: 0)
            Text(content.footer).font(.system(size: 10)).foregroundStyle(Self.faint)
        }
        .foregroundStyle(Self.ink)
        .padding(.horizontal, 18)
        .padding(.top, 20)
        .padding(.bottom, 14)
        .frame(width: Self.size.width, height: Self.size.height, alignment: .topLeading)
        .background {
            ZStack(alignment: .top) {
                Self.paper
                // The card's warm glow, the same in every appearance.
                HeroGlow(blur: 36, blobs: GlowBlob.shareImage).frame(height: 300).padding(.horizontal, -60).offset(
                    y: -90)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .environment(\.colorScheme, .light)
    }

    private var tiles: some View {
        // Half tiles in pairs, wide tiles across.
        var rows: [[YearShareContent.Tile]] = []
        for tile in content.tiles {
            if !tile.wide, let last = rows.last, last.count == 1, last.first?.wide == false {
                rows[rows.count - 1].append(tile)
            } else {
                rows.append([tile])
            }
        }
        return VStack(spacing: 7) {
            ForEach(rows, id: \.first?.key) { row in
                HStack(spacing: 7) {
                    ForEach(row, id: \.key) { tile in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(tile.title)
                                .font(.system(size: 15, weight: .bold))
                                .kerning(-0.3)
                                .foregroundStyle(Self.ink)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            Text(tile.subtitle).font(.system(size: 10.5)).foregroundStyle(Self.muted).lineLimit(2)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 8)
                        .background(
                            Color.white.opacity(0.75), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
                // Tiles side by side are as tall as each other.
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// Renders the image at `scale`, as shared; nil if it can't be drawn.
    @MainActor
    static func render(_ content: YearShareContent, scale: CGFloat = scale) -> CGImage? {
        let renderer = ImageRenderer(content: YearShareImage(content: content))
        renderer.scale = scale
        renderer.isOpaque = false
        return renderer.cgImage
    }

    /// "My 2026 in Penny": the shared PNG's name.
    static func title(_ year: Int) -> String { "My \(year) in Penny" }
}

/// Share your year (`iphone-year-review-share`, `iphone-year-review-share-amounts`, MAZ-292): the
/// image made on the device, a switch for amounts and names (off by default), what the image never
/// holds, and Share…, which opens the system share sheet with the PNG ("My 2026 in Penny").
/// Nothing is uploaded.
///
/// Motion (docs/design/motion.md §7): the image is made as the sheet opens; until it's ready a
/// placeholder of the same size shows the system spinner, then the image crossfades in. The switch
/// crossfades to the other version in place (`quick`). The share sheet opening plays a light
/// impact; a completed share (never a cancelled one) a success.
struct YearShareSheet: View {
    @Environment(\.dismiss) private var dismiss
    let review: YearReview
    let currency: String
    @State private var showsAmounts = false
    @State private var images: [Bool: CGImage] = [:]
    @State private var shareOpens = 0
    @State private var completions = 0

    private var content: YearShareContent {
        YearShareContent(review, currency: currency, showsAmounts: showsAmounts)
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Text("Share your year").font(.headline).foregroundStyle(PennyColor.label)
                    .accessibilityAddTraits(.isHeader)
                HStack {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(PennyColor.label)
                            .frame(width: ControlSize.glassButton, height: ControlSize.glassButton)
                            .background(PennyColor.fill, in: Circle())
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                    .accessibilityIdentifier("yearReviewShare.close")
                    Spacer()
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 18)
            ScrollView {
                VStack(spacing: 0) {
                    preview.padding(.top, 14)
                    amountsRow
                        .padding(.top, 18)
                    Text(Self.privacy)
                        .font(.footnote)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
            .scrollBounceBehavior(.basedOnSize)
            Button {
                share()
            } label: {
                Label("Share…", systemImage: "square.and.arrow.up")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .pennyGlass(in: Capsule(), tinted: true)
            .disabled(images[showsAmounts] == nil)
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
            .accessibilityIdentifier("yearReviewShare.send")
        }
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
        .background(PennyColor.background.ignoresSafeArea())
        .presentationBackground(PennyColor.background)
        .pennyHaptic(.openShare, trigger: shareOpens)
        .pennyHaptic(.shareCompleted, trigger: completions)
        .task {
            // Both versions, the default first, so the switch swaps them in place.
            for amounts in [false, true] where images[amounts] == nil {
                let image = YearShareImage.render(YearShareContent(review, currency: currency, showsAmounts: amounts))
                withAnimation(Motion.animation(.quick, reduceMotion: true)) { images[amounts] = image }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.yearReviewShare")
    }

    static var privacy: String {
        "Penny makes this image on your \(Self.device) and uploads nothing. It never includes entry names, notes or receipts."
    }

    private static var device: String {
        #if canImport(UIKit)
            UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #else
            "device"
        #endif
    }

    private var preview: some View {
        ZStack {
            if let image = images[showsAmounts] {
                Image(decorative: image, scale: YearShareImage.scale)
                    .resizable()
                    .frame(width: YearShareImage.size.width, height: YearShareImage.size.height)
                    .id(showsAmounts)
                    .transition(.opacity)
            } else {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(YearShareImage.paper)
                    .frame(width: YearShareImage.size.width, height: YearShareImage.size.height)
                    .overlay { ProgressView().tint(YearShareImage.muted) }
                    .transition(.opacity)
            }
        }
        .animation(Motion.animation(.quick, reduceMotion: true), value: images[showsAmounts] == nil)
        .animation(Motion.animation(.quick, reduceMotion: true), value: showsAmounts)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(PennyColor.separator, lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.16), radius: 20, y: 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Image of your year")
        .accessibilityValue(content.lines.joined(separator: ", "))
        .accessibilityIdentifier("yearReviewShare.image")
    }

    private var amountsRow: some View {
        Toggle(isOn: $showsAmounts) {
            HStack(spacing: 12) {
                Image(systemName: showsAmounts ? "eye" : "eye.slash")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(PennyColor.label)
                    .frame(width: 30, height: 30)
                    .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Show amounts and names").foregroundStyle(PennyColor.label)
                    Text(
                        showsAmounts ? "Amounts and who paid are on the image" : "Only percentages, rankings and counts"
                    )
                    .font(.footnote)
                    .foregroundStyle(PennyColor.secondaryLabel)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(PennyColor.tint)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(minHeight: 58)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityIdentifier("yearReviewShare.amounts")
    }

    private func share() {
        guard let image = images[showsAmounts] else { return }
        #if canImport(UIKit)
            shareOpens += 1
            YearSharePresenter.share(image, title: YearShareImage.title(review.year)) { completed in
                if completed { completions += 1 }
            }
        #endif
    }
}

#if canImport(UIKit)
    /// The system share sheet with the image as a PNG file named "My 2026 in Penny", written to this
    /// app's temporary folder and removed once the sheet closes. Nothing is uploaded: what happens
    /// next is the person's choice in the share sheet.
    @MainActor
    enum YearSharePresenter {
        static func share(_ image: CGImage, title: String, completion: @escaping @MainActor @Sendable (Bool) -> Void) {
            let picture = UIImage(cgImage: image)
            guard let data = picture.pngData(), let presenter = topController() else { return }
            let folder = FileManager.default.temporaryDirectory.appending(
                path: "year-review", directoryHint: .isDirectory)
            let file = folder.appending(path: "\(title).png")
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try data.write(to: file, options: [.atomic, .completeFileProtection])
            } catch {
                return
            }
            let item = YearShareItem(file: file, title: title, image: picture)
            let controller = UIActivityViewController(activityItems: [item], applicationActivities: nil)
            // Called by the share sheet, possibly off the main thread.
            controller.completionWithItemsHandler = { @Sendable _, completed, _, _ in
                try? FileManager.default.removeItem(at: file)
                Task { @MainActor in completion(completed) }
            }
            if let popover = controller.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(
                    x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 60, width: 1, height: 1)
                popover.permittedArrowDirections = [.down]
            }
            presenter.present(controller, animated: true)
        }

        /// The view controller on top: the Share your year sheet.
        private static func topController() -> UIViewController? {
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            var top = scene?.keyWindow?.rootViewController
            while let presented = top?.presentedViewController { top = presented }
            return top
        }
    }

    /// The shared file, with its title and the image as the share sheet's preview. The share sheet
    /// asks for the item off the main thread, so nothing here is isolated to it; every property is
    /// set once and never changes.
    final class YearShareItem: NSObject, UIActivityItemSource, @unchecked Sendable {
        nonisolated let file: URL
        nonisolated let title: String
        nonisolated let image: UIImage

        init(file: URL, title: String, image: UIImage) {
            self.file = file
            self.title = title
            self.image = image
        }

        nonisolated func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any { file }

        nonisolated func activityViewController(
            _ controller: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?
        ) -> Any? { file }

        nonisolated func activityViewController(
            _ controller: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?
        ) -> String { title }

        nonisolated func activityViewControllerLinkMetadata(_ controller: UIActivityViewController) -> LPLinkMetadata? {
            let metadata = LPLinkMetadata()
            metadata.title = title
            metadata.originalURL = file
            metadata.url = file
            metadata.imageProvider = NSItemProvider(object: image)
            metadata.iconProvider = NSItemProvider(object: image)
            return metadata
        }
    }
#endif
