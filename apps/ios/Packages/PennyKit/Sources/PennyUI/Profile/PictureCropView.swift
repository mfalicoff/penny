import Foundation
import PennyData
import PennyDesign
import SwiftUI

#if canImport(UIKit)
    import UIKit
    typealias PlatformImage = UIImage
#else
    import AppKit
    typealias PlatformImage = NSImage
#endif

/// A picked picture, decoded (orientation applied), waiting for "Move and scale".
struct CropSource: Identifiable {
    let id = UUID()
    let image: PlatformImage

    init?(data: Data) {
        guard let image = PlatformImage(data: data), image.size.width >= 1, image.size.height >= 1 else { return nil }
        self.image = image
    }

    init(image: PlatformImage) { self.image = image }

    var size: CGSize { image.size }
}

/// Presents "Move and scale" over everything (a full-screen cover on iOS).
struct CropPresenter: ViewModifier {
    @Binding var source: CropSource?
    let choose: (Data) -> Void

    func body(content: Content) -> some View {
        #if os(iOS)
            content.fullScreenCover(item: $source) { source in
                PictureCropView(source: source, choose: choose)
            }
        #else
            content.sheet(item: $source) { source in
                PictureCropView(source: source, choose: choose)
            }
        #endif
    }
}

/// The geometry of the crop: the picture fills the circle at scale 1 and may zoom to 5×; it can
/// never leave a gap inside the circle.
struct CropGeometry: Equatable {
    static let maxZoom: Double = 5

    var imageSize: CGSize
    var diameter: Double
    var zoom: Double = 1
    var offset: CGSize = .zero

    /// The picture's displayed size at the current zoom (its short side equals the circle at 1×).
    var displayed: CGSize {
        let base = diameter / min(imageSize.width, imageSize.height)
        return CGSize(width: imageSize.width * base * zoom, height: imageSize.height * base * zoom)
    }

    /// Keeps the circle covered.
    func clamped(_ proposed: CGSize, zoom: Double) -> CGSize {
        var copy = self
        copy.zoom = zoom
        let size = copy.displayed
        let maxX = max(0, (size.width - diameter) / 2)
        let maxY = max(0, (size.height - diameter) / 2)
        return CGSize(width: min(max(proposed.width, -maxX), maxX), height: min(max(proposed.height, -maxY), maxY))
    }

    /// The square of the picture under the circle, in the picture's points.
    var cropRect: CGRect {
        let size = displayed
        let scale = imageSize.width / size.width
        let side = diameter * scale
        let originX = ((size.width - diameter) / 2 - offset.width) * scale
        let originY = ((size.height - diameter) / 2 - offset.height) * scale
        return CGRect(x: originX, y: originY, width: side, height: side)
    }
}

/// "Move and scale" (`iphone-profile-photo` card, MAZ-171): the picture under a circle, pinch to
/// zoom and drag to move, the privacy note, Cancel and Choose. Choose sends a square JPEG of what
/// the circle shows; the server re-encodes it and strips the location and other details.
struct PictureCropView: View {
    let source: CropSource
    let choose: (Data) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var zoom: Double = 1
    @State private var offset: CGSize = .zero
    @State private var gestureZoom: Double = 1
    @State private var gestureOffset: CGSize = .zero

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                Text("Move and scale").font(.headline).foregroundStyle(.white)
                    .accessibilityAddTraits(.isHeader)
                Text("Pinch to zoom, drag to move").font(.subheadline).foregroundStyle(.white.opacity(0.6))
            }
            .padding(.top, 24)
            .padding(.bottom, 14)
            // Below the status bar, where the card puts the title, even when the cover reports no inset.
            .safeAreaPadding(.top, 54)
            GeometryReader { proxy in
                // The card's circle is about 69% of the width, with room above and below.
                let diameter = min(proxy.size.width * 0.69, proxy.size.height - 40)
                let geometry = CropGeometry(imageSize: source.size, diameter: diameter)
                cropArea(geometry: geometry, size: proxy.size)
            }
            Text(
                "People in your households and trips see this picture. Penny removes the photo's location and other "
                    + "details before saving it."
            )
            .font(.subheadline)
            .foregroundStyle(.white.opacity(0.6))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 24)
            .padding(.top, 14)
            HStack {
                Button("Cancel") { dismiss() }
                    .font(.headline)
                    .foregroundStyle(PennyColor.label)
                    .padding(.horizontal, 22)
                    .frame(minHeight: 48)
                    .background(.white.opacity(0.6), in: Capsule())
                    .accessibilityIdentifier("profilePhoto.cancel")
                Spacer()
                Button("Choose", action: finish)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 22)
                    .frame(minHeight: 48)
                    .background(PennyColor.tint, in: Capsule())
                    .shadow(color: PennyColor.tint.opacity(0.45), radius: 12)
                    .accessibilityIdentifier("profilePhoto.choose")
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20)
            .padding(.vertical, 20)
        }
        .background(Color.black.ignoresSafeArea())
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.profilePhoto")
    }

    private var currentZoom: Double { min(max(zoom * gestureZoom, 1), CropGeometry.maxZoom) }

    private func cropArea(geometry base: CropGeometry, size: CGSize) -> some View {
        var geometry = base
        geometry.zoom = currentZoom
        let proposed = CGSize(width: offset.width + gestureOffset.width, height: offset.height + gestureOffset.height)
        geometry.offset = base.clamped(proposed, zoom: currentZoom)
        let displayed = geometry.displayed
        let diameter = base.diameter
        return ZStack {
            Image(platformImage: source.image)
                .resizable()
                .frame(width: displayed.width, height: displayed.height)
                .offset(geometry.offset)
            // Dim everything outside the circle.
            Rectangle()
                .fill(Color.black.opacity(0.55))
                .mask {
                    Rectangle()
                        .overlay(Circle().frame(width: diameter, height: diameter).blendMode(.destinationOut))
                        .compositingGroup()
                }
                .allowsHitTesting(false)
            Circle()
                .stroke(Color.white.opacity(0.7), lineWidth: 1)
                .frame(width: diameter, height: diameter)
                .allowsHitTesting(false)
        }
        .frame(width: size.width, height: size.height)
        .clipped()
        .contentShape(Rectangle())
        .gesture(
            SimultaneousGesture(
                DragGesture().onChanged { gestureOffset = $0.translation }
                    .onEnded { value in
                        offset = base.clamped(
                            CGSize(
                                width: offset.width + value.translation.width,
                                height: offset.height + value.translation.height), zoom: currentZoom)
                        gestureOffset = .zero
                    },
                MagnifyGesture().onChanged { gestureZoom = $0.magnification }
                    .onEnded { _ in
                        zoom = currentZoom
                        gestureZoom = 1
                        offset = base.clamped(offset, zoom: zoom)
                    }
            )
        )
        .onChange(of: size) { latest = base }
        .onAppear { latest = base }
        .accessibilityElement()
        .accessibilityLabel("Picture position")
        .accessibilityValue("Zoom \(Int((currentZoom * 100).rounded())) percent")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: zoom = min(zoom * 1.25, CropGeometry.maxZoom)
            case .decrement: zoom = max(zoom / 1.25, 1)
            @unknown default: break
            }
            offset = base.clamped(offset, zoom: zoom)
        }
        .accessibilityIdentifier("profilePhoto.area")
    }

    /// The geometry the circle was last laid out with, for Choose.
    @State private var latest: CropGeometry?

    private func finish() {
        guard var geometry = latest else { return }
        geometry.zoom = currentZoom
        geometry.offset = geometry.clamped(offset, zoom: currentZoom)
        guard let jpeg = PictureCrop.jpeg(source.image, rect: geometry.cropRect) else { return }
        choose(jpeg)
        dismiss()
    }
}

/// Renders the chosen square as a JPEG of at most `AvatarRules.uploadSide` pixels.
enum PictureCrop {
    static func jpeg(_ image: PlatformImage, rect: CGRect, side: Int = AvatarRules.uploadSide) -> Data? {
        let pixels = CGFloat(min(side, max(16, Int(rect.width.rounded()))))
        #if canImport(UIKit)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let renderer = UIGraphicsImageRenderer(size: CGSize(width: pixels, height: pixels), format: format)
            let scale = pixels / rect.width
            return renderer.jpegData(withCompressionQuality: 0.88) { _ in
                image.draw(
                    in: CGRect(
                        x: -rect.minX * scale, y: -rect.minY * scale, width: image.size.width * scale,
                        height: image.size.height * scale))
            }
        #else
            let output = NSImage(size: NSSize(width: pixels, height: pixels))
            output.lockFocus()
            let scale = pixels / rect.width
            image.draw(
                in: NSRect(
                    x: -rect.minX * scale, y: -(image.size.height - rect.maxY) * scale,
                    width: image.size.width * scale, height: image.size.height * scale))
            output.unlockFocus()
            guard let tiff = output.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
            return bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.88])
        #endif
    }
}

extension Image {
    init(platformImage: PlatformImage) {
        #if canImport(UIKit)
            self.init(uiImage: platformImage)
        #else
            self.init(nsImage: platformImage)
        #endif
    }
}
