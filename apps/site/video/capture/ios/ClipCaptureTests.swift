import Foundation
import PennyAccessibility
import XCTest

// The product page's iOS clips (apps/site/video), recorded from the demo's sample data.
//
// This file lives in apps/site/video/capture/ios and is not part of the iOS project:
// `npm run capture:ios` copies it into PennyUITests for one run, then removes it. The script
// records the simulator's screen while these tests drive the app; each test writes the moments
// the composition animates to (wall-clock times and element frames, in points) to
// $PENNY_CLIP_OUT/<clip>.json, which the script lines up with the recording.

/// Marks the moments of one clip and writes them for the capture script.
@MainActor
final class ClipRecorder {
    let name: String
    private let out: URL
    private var events: [String: [String: Any]] = [:]

    init(_ name: String) throws {
        guard let path = ProcessInfo.processInfo.environment["PENNY_CLIP_OUT"] else {
            throw XCTSkip("Run through `npm run capture:ios` in apps/site/video.")
        }
        self.name = name
        out = URL(filePath: path)
    }

    /// Tells the script the screen is set up (`ready-<clip>`), then waits until its screen
    /// recording has started (`recording-<clip>`).
    func waitForRecording() throws {
        try Data().write(to: out.appending(path: "ready-\(name)"))
        let flag = out.appending(path: "recording-\(name)")
        for _ in 0..<600 {
            if FileManager.default.fileExists(atPath: flag.path()) { return }
            Thread.sleep(forTimeInterval: 0.1)
        }
        throw UIExpectationFailed(description: "The screen recording didn't start")
    }

    func mark(_ event: String, _ element: XCUIElement? = nil) {
        var entry: [String: Any] = ["t": Date().timeIntervalSince1970]
        if let frame = element?.frame, !frame.isEmpty {
            entry["box"] = ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
        }
        events[event] = entry
    }

    func hold(_ seconds: TimeInterval) { Thread.sleep(forTimeInterval: seconds) }

    func write(screen: CGRect) throws {
        let body: [String: Any] = [
            "screen": ["width": screen.width, "height": screen.height], "events": events,
        ]
        let data = try JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: out.appending(path: "\(name).json"))
    }
}

final class ClipCaptureTests: PennyUITestCase {
    @MainActor
    private func launchDemo() async throws -> Penny {
        XCUIDevice.shared.appearance = .dark
        var options = LaunchOptions()
        options.usesStack = false
        options.demo = true
        options.seed = ContainerSeed(standardDefaults: ["penny.appearance": "dark"])
        let penny = try await launch(options)
        try penny.waitForShell()
        return penny
    }

    @MainActor
    private func addButton() -> XCUIElement {
        let byID = app.buttons[AccessibilityID.Tab.add].firstMatch
        return byID.exists ? byID : app.buttons["Add entry"].firstMatch
    }

    /// Overview (7 s): add an $18.50 lunch from Home; Left to spend counts down.
    @MainActor
    func test_whenRecordingTheOverviewClip_Demo_ShouldAddAnExpense() async throws {
        let clip = try ClipRecorder("overview")
        let penny = try await launchDemo()
        let hero = try penny.wait(for: AccessibilityID.Home.hero)
        let before = hero.label
        try clip.waitForRecording()
        clip.hold(1.0)
        clip.mark("start", hero)
        clip.hold(0.8)
        clip.mark("add", addButton())
        try penny.openAddEntry()
        clip.mark("sheet", penny.element(AccessibilityID.Screen.addEntry))
        clip.hold(0.4)
        clip.mark("amount", try penny.wait(for: AccessibilityID.EntryForm.amount))
        // Key by key, so the clip's touches land on the keys.
        for (index, character) in "18.50".enumerated() {
            let key = try penny.wait(
                for: AccessibilityID.EntryForm.keypad(character == "." ? "separator" : String(character)))
            clip.mark("key\(index)", key)
            key.tap()
        }
        clip.mark("amount-done", penny.element(AccessibilityID.EntryForm.amount))
        let food = try penny.wait(for: "entryForm.category.food")
        clip.mark("category", food)
        food.tap()
        clip.hold(0.3)
        let title = try penny.wait(for: AccessibilityID.EntryForm.title)
        clip.mark("title", title)
        try penny.type("Lunch", into: AccessibilityID.EntryForm.title)
        clip.hold(0.3)
        clip.mark("save", try penny.wait(for: AccessibilityID.EntryForm.save))
        try penny.saveEntryForm()
        clip.mark("saved")
        waitUntil(NSPredicate(format: "label != %@", before), hero)
        clip.mark("left", hero)
        clip.hold(1.6)
        clip.mark("end")
        try clip.write(screen: app.frame)
    }

    /// Entries (6 s): split a $74.40 dinner equally between three people: your share is $24.80.
    @MainActor
    func test_whenRecordingTheEntriesClip_Demo_ShouldSplitADinnerThreeWays() async throws {
        let clip = try ClipRecorder("entries")
        let penny = try await launchDemo()
        try penny.openAddEntry()
        // The title first: tapping the amount afterwards swaps the keyboard for the form's keypad,
        // which leaves the Split row in view (the keyboard covers it).
        try penny.type("Dinner with friends", into: AccessibilityID.EntryForm.title)
        try penny.tap(AccessibilityID.EntryForm.amount)
        try penny.wait(for: AccessibilityID.EntryForm.keypad("1"))
        try penny.enterAmount("74.40")
        try penny.tap("entryForm.category.food")
        let split = try penny.wait(for: "entryForm.split")
        penny.revealAboveKeypad(split)
        try clip.waitForRecording()
        clip.hold(1.0)
        clip.mark("start", penny.element(AccessibilityID.Screen.addEntry))
        clip.hold(0.6)
        clip.mark("split", split)
        split.tap()
        let mode = try penny.wait(for: "split.mode")
        clip.mark("sheet", penny.element(AccessibilityID.Screen.split))
        clip.hold(0.3)
        let equally = mode.buttons["Equally"].firstMatch
        clip.mark("equally", equally)
        equally.tap()
        let more = try penny.wait(for: "split.people.increment")
        clip.hold(0.3)
        clip.mark("more", more)
        more.tap()
        let share = try penny.wait(for: "split.share")
        waitUntil(NSPredicate(format: "label CONTAINS %@", "24.80"), share)
        clip.mark("share", share)
        clip.hold(1.2)
        let done = try penny.wait(for: "split.done")
        clip.mark("done", done)
        done.tap()
        try penny.waitForAbsence(of: AccessibilityID.Screen.split)
        clip.mark("row", penny.element("entryForm.split"))
        clip.hold(1.2)
        clip.mark("end")
        try clip.write(screen: app.frame)
    }
}

/// Waits up to five seconds for `predicate` on `object`. A plain function: XCTest's waiter is
/// unavailable inside the async tests.
@MainActor
private func waitUntil(_ predicate: NSPredicate, _ object: XCUIElement) {
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: object)], timeout: 5)
}
