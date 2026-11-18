import Foundation
import PennyDomain
import SwiftUI
import Testing

@testable import PennyWidgetUI

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

/// Renders every widget state in every family (small, medium, Lock Screen rectangular and
/// circular), light and dark, so layout problems
/// (a long amount, three long titles, the stale notes) surface as a failed render rather than
/// on a device. With `PENNY_WIDGET_RENDER_DIR` set, the images are saved there for review
/// (docs/ios/widgets.md#verification).
@Suite("Widgets: rendering every state")
@MainActor
struct WidgetRenderTests {
    /// The families on a 6.3-inch iPhone, in points.
    static let small = CGSize(width: 170, height: 170)
    static let medium = CGSize(width: 364, height: 170)
    static let rectangular = CGSize(width: 172, height: 76)
    static let circular = CGSize(width: 76, height: 76)

    static func snapshot(left: Int64, projected: Int64, recent: [WidgetSnapshot.Expense], waiting: Bool = false)
        -> WidgetSnapshot
    {
        WidgetSnapshot(
            month: "2026-11", currency: "CAD", generatedAt: Date(timeIntervalSince1970: 1_794_000_000),
            income: max(0, left) + 60_000, spent: 60_000 - min(0, left), invested: 0, leftToSpend: left,
            projectedRemaining: projected, recentExpenses: recent, waitingToSync: waiting)
    }

    static let long: [WidgetSnapshot.Expense] = [
        .init(
            title: "Épicerie du coin, commande de la semaine", cents: 99_999_999_999, date: "2026-11-09", shared: true),
        .init(title: "A very long restaurant name that keeps going", cents: 123_456, date: "2026-11-08", shared: false),
        .init(title: "Transit", cents: 6200, date: "2026-11-08", shared: false),
    ]

    static var states: [(String, WidgetContent)] {
        let built = Date(timeIntervalSince1970: 1_794_000_000)
        return [
            ("sample", .sample),
            ("signed-out", .signedOut),
            ("open-app", .openApp),
            ("empty", .ready(snapshot(left: 0, projected: 0, recent: []), .current)),
            ("long", .ready(snapshot(left: -99_999_999_999, projected: 99_999_999_999, recent: long), .current)),
            ("waiting", .ready(snapshot(left: 12_345, projected: 2345, recent: long, waiting: true), .current)),
            ("past-month", .ready(snapshot(left: 4200, projected: 4200, recent: []), .pastMonth)),
            ("old", .ready(snapshot(left: 4200, projected: 4200, recent: []), .old(since: built))),
        ]
    }

    static func widget(_ view: some View, size: CGSize, scheme: ColorScheme) -> some View {
        let padding: CGFloat = size.height > 100 ? 16 : 0
        return
            view
            .padding(padding)
            .frame(width: size.width, height: size.height)
            .background(PennyWidgetStyle.background)
            .clipShape(.rect(cornerRadius: 22))
            .environment(\.colorScheme, scheme)
            .environment(\.locale, Locale(identifier: "en_CA"))
    }

    @Test("whenRenderingEachStateInLightAndDark_Widgets_ShouldProduceAnImage")
    func render() throws {
        let directory = ProcessInfo.processInfo.environment["PENNY_WIDGET_RENDER_DIR"].map { URL(filePath: $0) }
        if let directory { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        for (name, content) in Self.states {
            for scheme in [ColorScheme.light, .dark] {
                let views: [(String, CGSize, AnyView)] = [
                    ("balance", Self.small, AnyView(BalanceWidgetView(content: content))),
                    ("recent", Self.small, AnyView(RecentExpensesWidgetView(content: content))),
                    ("glance", Self.medium, AnyView(MonthGlanceWidgetView(content: content))),
                    ("lock-rectangular", Self.rectangular, AnyView(LockRectangularView(content: content))),
                    ("lock-circular", Self.circular, AnyView(LockCircularView(content: content))),
                ]
                for (kind, size, view) in views {
                    let renderer = ImageRenderer(content: Self.widget(view, size: size, scheme: scheme))
                    renderer.scale = 2
                    let image = try #require(renderer.cgImage, "\(kind) \(name) renders")
                    #expect(image.width == Int(size.width * 2))
                    if let directory {
                        try Self.save(image, to: directory.appending(path: "\(kind)-\(name)-\(scheme).png"))
                    }
                }
            }
        }
    }

    static func save(_ image: CGImage, to url: URL) throws {
        #if canImport(UIKit)
            try UIImage(cgImage: image).pngData()?.write(to: url)
        #elseif canImport(AppKit)
            let rep = NSBitmapImageRep(cgImage: image)
            try rep.representation(using: .png, properties: [:])?.write(to: url)
        #endif
    }
}
