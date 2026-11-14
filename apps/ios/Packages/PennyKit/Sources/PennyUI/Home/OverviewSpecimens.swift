import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Xcode previews of the redesign cards MAZ-77 owns, named after their ids in
// contracts/design-baseline.json. Made-up data only.

#Preview("iphone-home") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger())))
    SpecimenHost(shell: shell) { NavigationStack { HomeView() } }
}

#Preview("iphone-home-dark") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger())))
    SpecimenHost(shell: shell) { NavigationStack { HomeView() } }
        .preferredColorScheme(.dark)
}

#Preview("iphone-money-flow") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger())))
    SpecimenHost(shell: shell) { NavigationStack { MoneyFlowView() } }
}

#Preview("iphone-insights") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger())))
    SpecimenHost(shell: shell) { NavigationStack { InsightsView() } }
}

#Preview("iphone-calendar") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger())))
    SpecimenHost(shell: shell) { NavigationStack { CalendarView() } }
}

#Preview("ipad-home") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger())))
    SpecimenHost(shell: shell) { AppShell(shell: shell) }
}

#Preview("iphone-home, accessibility XXXL") {
    let shell = Specimen.shell(FixedWorkspace(load: .ready(Specimen.ledger())))
    SpecimenHost(shell: shell) { NavigationStack { HomeView() } }
        .dynamicTypeSize(.accessibility5)
}
