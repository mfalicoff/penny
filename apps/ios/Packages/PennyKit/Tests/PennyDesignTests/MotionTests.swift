import Foundation
import SwiftUI
import Testing

@testable import PennyDesign

/// The motion tokens and haptics table (MAZ-287, docs/design/motion.md).
@MainActor
struct MotionTests {
    @Test("whenReduceMotionOn_Animation_ShouldBeAQuickFadeForEveryToken")
    func reducedAnimationIsQuick() {
        let quick = Motion.Easing.standard.animation(.quick)
        for duration in Motion.Duration.allCases {
            #expect(Motion.animation(duration, reduceMotion: true) == quick, "\(duration.name)")
            #expect(Motion.animation(duration, exit: true, reduceMotion: true) == quick, "\(duration.name) exit")
        }
    }

    @Test("whenReduceMotionOn_Movement_ShouldHappenAtOnceForEveryToken")
    func reducedMovementIsNothing() {
        for duration in Motion.Duration.allCases {
            #expect(Motion.movement(duration, reduceMotion: true) == nil, "\(duration.name)")
            #expect(Motion.movement(duration, exit: true, reduceMotion: true) == nil, "\(duration.name) exit")
            #expect(Motion.movement(duration, reduceMotion: false) != nil, "\(duration.name) with motion")
        }
    }

    @Test("whenReduceMotionOff_Animation_ShouldUseTheTokenAndItsEasing")
    func animationUsesToken() {
        for duration in Motion.Duration.allCases {
            #expect(Motion.animation(duration, reduceMotion: false) == .snappy(duration: duration.rawValue))
            #expect(Motion.animation(duration, exit: true, reduceMotion: false) == .easeIn(duration: duration.rawValue))
        }
        #expect(Motion.highlightFade == .linear(duration: 1.0))
    }

    @Test("whenTransitionAsked_Offsets_ShouldMoveTowardsTheEdgeByTheDistance")
    func offsets() {
        #expect(Motion.offset(.bottom, 8) == CGSize(width: 0, height: 8))
        #expect(Motion.offset(.top, 8) == CGSize(width: 0, height: -8))
        #expect(Motion.offset(.leading, 24) == CGSize(width: -24, height: 0))
        #expect(Motion.offset(.trailing, 24) == CGSize(width: 24, height: 0))
    }

    @Test("whenShaking_Keyframes_ShouldSwingByShakeAndSettleAtRestInTwoQuicks")
    func shake() {
        #expect(Motion.shakeOffsets.last == 0)
        #expect(Motion.shakeOffsets.map(abs).max() == Motion.Distance.shake)
        #expect(abs(Motion.shakeDuration - 0.3) < 0.0001)
    }

    @Test("whenTokensListed_Values_ShouldMatchTheSpec")
    func specValues() {
        #expect(Motion.Duration.allCases.map(\.milliseconds) == [150, 250, 400, 1000])
        #expect(Motion.Distance.all == ["nudge": 8, "shift": 24, "shake": 6])
        #expect(Motion.Distance.press == 0.97)
    }

    /// The baseline gains `tokens.motion` with the web part of MAZ-287; until then there is
    /// nothing to compare, and the test above holds the spec's values.
    @Test("whenComparedWithBaseline_MotionTokens_ShouldMatch")
    func baseline() throws {
        let tokens = try #require(try Repository.json("contracts/design-baseline.json")["tokens"] as? [String: Any])
        guard let motion = tokens["motion"] as? [String: Any] else { return }
        let durations = try #require(motion["duration"] as? [String: Double])
        #expect(
            durations
                == Dictionary(uniqueKeysWithValues: Motion.Duration.allCases.map { ($0.name, Double($0.milliseconds)) })
        )
        let easings = try #require(motion["easing"] as? [String: String])
        #expect(easings == Dictionary(uniqueKeysWithValues: Motion.Easing.allCases.map { ($0.rawValue, $0.css) }))
        let distances = try #require(motion["distance"] as? [String: Double])
        #expect(distances == Motion.Distance.all.mapValues(Double.init))
        #expect(motion["press"] as? Double == Double(Motion.Distance.press))
    }

    /// docs/design/motion.md#haptics-ios, row by row.
    static let table: [(Motion.Haptic, SensoryFeedback)] = [
        (.save, .success), (.refused, .error), (.failed, .error), (.undo, .impact(weight: .light)),
        (.stepPeriod, .selection), (.focusChart, .selection), (.delete, .impact(weight: .medium)),
        (.bulkChange, .impact(weight: .medium)), (.select, .selection), (.openClose, .impact(weight: .light)),
        (.disclosure, .selection), (.destructiveConfirmation, .warning), (.toggle, .selection),
        (.syncSucceeded, .success), (.syncFailed, .error), (.sidebar, .impact(weight: .light)),
        (.open, .selection), (.dismissRecap, .impact(weight: .light)), (.openRecap, .selection),
    ]

    @Test("whenHapticsListed_EveryCase_ShouldMapToTheTablesFeedback")
    func haptics() {
        #expect(Self.table.count == Motion.Haptic.allCases.count, "every case is in the table once")
        for (haptic, feedback) in Self.table {
            #expect(haptic.feedback == feedback, "\(haptic)")
        }
    }
}
