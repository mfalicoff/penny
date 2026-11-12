// swift-tools-version:6.2
// PennyKit holds every module of the native app (MAZ-66). Dependencies point one way:
// PennyUI -> PennyDesign, PennyData -> PennyDomain; PennyWidgetUI -> PennyDesign, PennyData.PennyDomain and PennyData never import
// SwiftUI or UIKit (scripts/ios.sh boundaries checks this), so their tests also run on the
// macOS host with `swift test`.
import PackageDescription

let strict: [SwiftSetting] = [
    .treatAllWarnings(as: .error),
    .enableUpcomingFeature("ExistentialAny"),
    .enableUpcomingFeature("InternalImportsByDefault"),
]
let mainActorByDefault: [SwiftSetting] = strict + [.defaultIsolation(MainActor.self)]

let package = Package(
    name: "PennyKit",
    // iOS 26 is the minimum: the redesign requires system Liquid Glass (docs: apps/ios/README.md).
    // macOS 26 exists only so the platform-neutral modules can be tested on the host.
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "PennyDomain", targets: ["PennyDomain"]),
        .library(name: "PennyData", targets: ["PennyData"]),
        .library(name: "PennyDesign", targets: ["PennyDesign"]),
        .library(name: "PennyUI", targets: ["PennyUI"]),
        // The WidgetKit widgets (MAZ-80), linked by the PennyWidgets extension target.
        .library(name: "PennyWidgetUI", targets: ["PennyWidgetUI"]),
        // Identifiers shared by the screens and the XCUITest target (MAZ-81). No dependencies.
        .library(name: "PennyAccessibility", targets: ["PennyAccessibility"]),
    ],
    dependencies: [
        .package(name: "PennyContracts", path: "../../../../contracts/swift")
    ],
    targets: [
        .target(name: "PennyDomain", swiftSettings: strict),
        .target(name: "PennyData", dependencies: ["PennyDomain"], swiftSettings: strict),
        .target(name: "PennyDesign", swiftSettings: mainActorByDefault),
        .target(name: "PennyAccessibility", swiftSettings: strict),
        .target(
            name: "PennyUI",
            dependencies: ["PennyDomain", "PennyData", "PennyDesign"],
            swiftSettings: mainActorByDefault
        ),
        // Nonisolated by default: WidgetKit calls the timeline provider off the main actor.
        .target(
            name: "PennyWidgetUI",
            dependencies: ["PennyDomain", "PennyData", "PennyDesign"],
            swiftSettings: strict
        ),
        .testTarget(
            name: "PennyDomainTests",
            dependencies: ["PennyDomain", "PennyContracts"],
            swiftSettings: strict
        ),
        .testTarget(
            name: "PennyDataTests",
            dependencies: ["PennyData", "PennyContracts"],
            swiftSettings: strict
        ),
        .testTarget(name: "PennyDesignTests", dependencies: ["PennyDesign"], swiftSettings: strict),
        .testTarget(name: "PennyUIModuleTests", dependencies: ["PennyUI"], swiftSettings: mainActorByDefault),
        .testTarget(name: "PennyWidgetUITests", dependencies: ["PennyWidgetUI"], swiftSettings: strict),
        .testTarget(name: "PennyAccessibilityTests", dependencies: ["PennyAccessibility"], swiftSettings: strict),
    ]
)
