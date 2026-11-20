import PennyDesign
import PennyDomain
import SwiftUI

/// Settings in the iPad detail column (`ipad-settings`, MAZ-182): the list with the chosen page
/// beside it, Appearance until another is chosen, when the column is wide enough; otherwise one
/// column that pushes pages, as before.
///
/// Both read `settingsPath`: its first page is the one beside the list, and anything that page
/// pushes follows it, so resizing between the two keeps the place.
struct SettingsColumns: View {
    @Bindable var shell: ShellModel
    /// The Settings column's path (without the Manage pages, which are sidebar rows).
    let singleColumnPath: Binding<[SettingsRoute]>
    @State private var width: Double = 0

    var body: some View {
        Group {
            if Self.isTwoColumn(width: width) {
                HStack(spacing: 0) {
                    NavigationStack {
                        SettingsView(selection: page, select: { singleColumnPath.wrappedValue = [$0] })
                    }
                    .frame(width: Self.listWidth(for: width))
                    Divider().ignoresSafeArea()
                    // Its own identity per page, like the sidebar's stacks: choosing another page
                    // never changes the bound path of the stack being replaced.
                    NavigationStack(path: pagePath) {
                        SettingsPage(route: page)
                            .navigationDestination(for: SettingsRoute.self) { SettingsPage(route: $0) }
                    }
                    .id(page)
                }
            } else {
                NavigationStack(path: singleColumnPath) {
                    SettingsView()
                        .navigationDestination(for: SettingsRoute.self) { SettingsPage(route: $0) }
                }
            }
        }
        .onGeometryChange(for: Double.self) {
            $0.size.width
        } action: {
            width = $0
        }
    }

    /// The page beside the list: the path's first page, or Appearance (as on the card).
    private var page: SettingsRoute { singleColumnPath.wrappedValue.first ?? .appearance }

    private var pagePath: Binding<[SettingsRoute]> {
        Binding(
            get: { Array(singleColumnPath.wrappedValue.dropFirst()) },
            set: { singleColumnPath.wrappedValue = [page] + $0 })
    }

    /// The list and a page side by side need a detail column this wide.
    static let minTwoColumnWidth: Double = 700

    static func isTwoColumn(width: Double) -> Bool { width >= minTwoColumnWidth }

    /// The list's width: the card's 400 points, or less in a narrower column.
    static func listWidth(for width: Double) -> Double { min(400, (width * 0.46).rounded()) }
}
