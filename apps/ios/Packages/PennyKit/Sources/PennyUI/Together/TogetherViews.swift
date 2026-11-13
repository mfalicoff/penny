import SwiftUI

// The Trips tab and the trip pages are in `Trips/` (MAZ-76).

extension View {
    func insetGroupedList() -> some View {
        #if os(iOS)
            listStyle(.insetGrouped).scrollContentBackground(.hidden)
        #else
            listStyle(.inset).scrollContentBackground(.hidden)
        #endif
    }
}
