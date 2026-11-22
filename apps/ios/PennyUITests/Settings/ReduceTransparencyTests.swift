import PennyAccessibility
import XCTest

/// Penny's own Reduce transparency (Settings › Appearance › Display, MAZ-250): with it on, the
/// navigation bars of the Settings sheet, a page pushed on a tab's stack and the Add entry sheet
/// draw the solid surface color instead of Liquid Glass, in light and dark. (The tab bar and the
/// bars' buttons stay system glass; the switch's description says so.) The check samples the
/// bars' pixels, so it proves the setting reaches each stack, not just that the switch flips.
final class ReduceTransparencyTests: PennyUITestCase {
    /// `PennyColor.surface` and `PennyColor.background` (Tokens.swift), as 0...255 RGB.
    private static let surface = (light: (255.0, 255.0, 255.0), dark: (26.0, 25.0, 24.0))
    private static let background = (light: (242.0, 241.0, 238.0), dark: (0.0, 0.0, 0.0))

    @MainActor
    func test_whenReduceTransparencyIsOn_NavigationBars_ShouldBeSolid() async throws {
        // The app's own Light or Dark (`penny.appearance`): the simulator's system appearance
        // doesn't always reach the app under test.
        for dark in [false, true] {
            var options = LaunchOptions()
            options.usesStack = false
            options.demo = true
            options.seed = ContainerSeed(standardDefaults: ["penny.appearance": dark ? "dark" : "light"])
            let penny = try await launch(options)
            try penny.waitForShell()
            let appearancePage = AccessibilityID.Screen.appearance

            // Off: the Appearance page's bar is glass over the page, so it reads as the page.
            try penny.openSettingsPage("appearance", screen: appearancePage)
            XCTAssertFalse(isSurface(barColor(penny, over: appearancePage), dark: dark), "solid with the setting off")

            let row = try penny.wait(for: AccessibilityID.Settings.reduceTransparency)
            (row.switches.firstMatch.exists ? row.switches.firstMatch : row).tap()
            let on = NSPredicate(format: "value == '1'")
            XCTAssertEqual(
                XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: on, object: row)], timeout: Penny.timeout),
                .completed, "the switch did not turn on")
            screenshot("reduce-transparency-\(dark ? "dark" : "light")-appearance")
            XCTAssertTrue(isSurface(barColor(penny, over: appearancePage), dark: dark), "a Settings page's bar")

            // Kept for the next launch, and applied to the calendar sheet, Settings and Add entry.
            let relaunched = try await relaunch()
            try relaunched.waitForShell()
            try relaunched.openCalendar()
            screenshot("reduce-transparency-\(dark ? "dark" : "light")-calendar")
            XCTAssertTrue(
                isSurface(barColor(relaunched, over: AccessibilityID.Screen.calendar), dark: dark),
                "the calendar sheet over Home"
            )
            try relaunched.tap(AccessibilityID.Overview.calendarClose)
            try relaunched.waitForAbsence(of: AccessibilityID.Screen.calendar)
            try relaunched.openSettings()
            screenshot("reduce-transparency-\(dark ? "dark" : "light")-settings")
            XCTAssertTrue(
                isSurface(barColor(relaunched, over: AccessibilityID.Screen.settings), dark: dark), "the Settings bar")
            try relaunched.closeSettings()
            try relaunched.openAddEntry()
            screenshot("reduce-transparency-\(dark ? "dark" : "light")-add-entry")
            XCTAssertTrue(
                isSurface(barColor(relaunched, over: AccessibilityID.Screen.addEntry), dark: dark), "the Add entry bar")
            relaunched.app.terminate()
        }
    }

    /// The color of the navigation bar over the screen `id`, about a third of the way in from its
    /// leading edge (no button or title sits there) and a few points above its bottom.
    @MainActor
    private func barColor(_ penny: Penny, over id: String) -> (Double, Double, Double) {
        let screen = penny.element(id).frame
        // The hittable bar at the screen's top (a list runs under its bar, so the bar can sit inside
        // the screen's frame), not one in another column or under a sheet.
        let bars = penny.app.navigationBars.allElementsBoundByIndex.filter(\.isHittable).map(\.frame)
            .filter {
                $0.height > 0 && $0.minX <= screen.midX && screen.midX <= $0.maxX
                    && $0.maxY > screen.minY - 4 && $0.minY < screen.minY + 150
            }
        let bar =
            bars.min { $0.minY < $1.minY } ?? CGRect(x: screen.minX, y: screen.minY, width: screen.width, height: 7)
        // The x comes from the screen. On iPad the screen and its bar span the window and the
        // sidebar covers their leading side, so the sample is a quarter in from the trailing edge.
        let x = Device.isPad ? screen.maxX - screen.width * 0.25 : screen.minX + screen.width * 0.3
        let point = CGPoint(x: x, y: max(bar.maxY - 6, bar.minY + 1))
        let color = pixel(XCUIScreen.main.screenshot().image, at: point)
        XCTContext.runActivity(named: "\(id): bar \(bar), screen \(screen), sampled \(point) = \(color)") { _ in }
        return color
    }

    /// Within a few levels of `PennyColor.surface`, and nearer to it than to the page color.
    private func isSurface(_ color: (Double, Double, Double), dark: Bool) -> Bool {
        let surface = distance(color, dark ? Self.surface.dark : Self.surface.light)
        return surface <= 9 && surface < distance(color, dark ? Self.background.dark : Self.background.light)
    }

    private func distance(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> Double {
        abs(a.0 - b.0) + abs(a.1 - b.1) + abs(a.2 - b.2)
    }

    private func pixel(_ image: UIImage, at point: CGPoint) -> (Double, Double, Double) {
        guard let cgImage = image.cgImage else { return (0, 0, 0) }
        let scale = Double(cgImage.width) / image.size.width
        let x = Int(point.x * scale), y = Int(point.y * scale)
        var data = [UInt8](repeating: 0, count: 4)
        let space = CGColorSpaceCreateDeviceRGB()
        guard
            let context = CGContext(
                data: &data, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: space,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return (0, 0, 0) }
        context.draw(
            cgImage, in: CGRect(x: -x, y: y - cgImage.height + 1, width: cgImage.width, height: cgImage.height))
        return (Double(data[0]), Double(data[1]), Double(data[2]))
    }
}
