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
                            .safeAreaInset(edge: .top, spacing: 0) {
                                // The card's large title over the page. This stack's navigation bar
                                // shows no title here, even with the large display mode forced
                                // (MAZ-182), so the title is drawn above the page's content. The
                                // lock page has its own centered header instead.
                                if page != .appLock { PageTitle(title: page.title) }
                            }
                            .navigationDestination(for: SettingsRoute.self) {
                                SettingsPage(route: $0).settingsAddEntry()
                            }
                            .settingsAddEntry()
                    }
                    .id(page)
                }
            } else {
                NavigationStack(path: singleColumnPath) {
                    SettingsView().settingsAddEntry()
                        .navigationDestination(for: SettingsRoute.self) { SettingsPage(route: $0).settingsAddEntry() }
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

/// The large title of the page beside the iPad's Settings list (`ipad-settings`).
private struct PageTitle: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.largeTitle.weight(.bold))
            .foregroundStyle(PennyColor.label)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Metrics.gutter + 4)
            .padding(.top, 4)
            .padding(.bottom, 2)
            .background(PennyColor.background)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("settings.pageTitle")
    }
}

extension View {
    /// The copper Add entry capsule at the trailing end of the iPad Settings toolbar
    /// (`ipad-settings` card, MAZ-254).
    func settingsAddEntry() -> some View {
        toolbar {
            ToolbarItem(placement: .primaryAction) { AddEntryCapsule().accessibilityIdentifier("settings.add") }
        }
    }
}
