import Foundation
import Testing

@testable import PennyDesign

/// The native hero glow (MAZ-180) uses design-kit's `--pk-glow-copper` colors and geometry.
@Suite("Hero glow")
struct HeroGlowTests {
    /// Each `radial-gradient(rx ry at x y, rgba(r,g,b,a), …)` of one `--pk-glow-copper` line.
    private func gradients(dark: Bool) throws -> [(geometry: [Double], rgba: [Double])] {
        let css = try String(
            contentsOf: Repository.root.appendingPathComponent("design-kit/src/styles.css"), encoding: .utf8)
        let lines = css.split(separator: "\n").filter { $0.contains("--pk-glow-copper:") }
        try #require(lines.count == 2, "a light and a dark --pk-glow-copper")
        let line = String(lines[dark ? 1 : 0])
        let pattern = try Regex(
            #"radial-gradient\(([\d.]+)% ([\d.]+)% at ([\d.]+)% ([\d.]+)%, rgba\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)"#
        )
        return line.matches(of: pattern).map { match in
            let numbers = (1...8).compactMap { index in
                match.output[index].substring.flatMap { Double($0) }
            }
            return (Array(numbers[0..<4]), Array(numbers[4..<8]))
        }
    }

    @Test("whenComparedWithDesignKit_HeroGlow_ShouldUseTheCopperGlowInLightAndDark", arguments: [false, true])
    func matchesDesignKit(dark: Bool) throws {
        let css = try gradients(dark: dark)
        try #require(css.count == GlowBlob.copper.count)
        for (blob, gradient) in zip(GlowBlob.copper, css) {
            #expect([blob.radiusX, blob.radiusY, blob.x, blob.y].map { ($0 * 100).rounded() } == gradient.geometry)
            let color = dark ? blob.color.dark : blob.color.light
            let expected = RGBA(
                red: UInt8(gradient.rgba[0]), green: UInt8(gradient.rgba[1]), blue: UInt8(gradient.rgba[2]),
                alpha: gradient.rgba[3])
            #expect(color == expected)
        }
    }
}
