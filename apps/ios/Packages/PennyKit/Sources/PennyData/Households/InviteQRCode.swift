public import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
public import Foundation
import Vision

/// The invite QR code (MAZ-75), from Core Image's built-in generator: no third-party code.
/// It encodes `InviteLink.url`, so the iOS Camera app opens it in Penny too.
public enum InviteQRCode {
    /// A black-on-white QR code of `url`, each module `scale` pixels, with a quiet zone.
    /// Medium error correction (15%) survives a phone screen photographed at an angle.
    public static func image(for url: URL, scale: CGFloat = 10) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(url.absoluteString.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return CIContext(options: [.useSoftwareRenderer: false]).createCGImage(scaled, from: scaled.extent)
    }

    /// PNG bytes of the code, for the share sheet.
    public static func png(for url: URL, scale: CGFloat = 12) -> Data? {
        guard let image = image(for: url, scale: scale) else { return nil }
        return CIContext().pngRepresentation(
            of: CIImage(cgImage: image), format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
    }

    /// Every QR payload Vision finds in `image` (for a photo of a code, and the round-trip test).
    public static func decode(_ image: CGImage) async -> [String] {
        var request = DetectBarcodesRequest()
        request.symbologies = [.qr]
        let observations = (try? await request.perform(on: image)) ?? []
        return observations.compactMap(\.payloadString)
    }
}
