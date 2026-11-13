// swift-tools-version:6.0
// Language-neutral contract fixtures for Swift (MAZ-62): strict Codable models, the
// fixture manifest hashes and a loader. The native app (MAZ-66 onward) depends on this
// package and adds behavior assertions as it ports the rules (MAZ-70, 71, 73, 75).
import PackageDescription

let package = Package(
    name: "PennyContracts",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "PennyContracts", targets: ["PennyContracts"])],
    targets: [
        .target(name: "PennyContracts"),
        .testTarget(name: "PennyContractsTests", dependencies: ["PennyContracts"]),
    ]
)
