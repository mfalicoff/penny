import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Xcode previews of the organize cards (MAZ-74): accounts, categories and recurring schedules,
// named after their specimens. Made-up data only.

@MainActor
enum OrganizeSpecimen {
    static let today = Specimen.today

    /// The demo ledger plus a credit card in use, an unused account, a paused schedule and a
    /// schedule anchored on the 31st.
    static func ledger() -> Ledger {
        var ledger = Specimen.ledger()
        ledger.accounts.append(PaymentAccount(id: "spec-savings", name: "Savings", type: .bank))
        ledger.accounts.append(PaymentAccount(id: "spec-wallet", name: "Wallet", type: .cash))
        ledger.recurring.append(
            RecurringRule(
                id: "spec-gym", title: "Gym", kind: .expense, total: 4_500, share: 4_500, categoryId: "health",
                accountId: "demo-visa", date: .day(2026, 3, 6), frequency: .monthly, nextDate: .day(2026, 12, 6),
                anchorDay: 6, active: false))
        ledger.recurring.append(
            RecurringRule(
                id: "spec-internet", title: "Internet", kind: .expense, total: 6_500, share: 6_500,
                categoryId: "home", accountId: "demo-visa", date: .day(2026, 1, 31), frequency: .monthly,
                nextDate: .day(2026, 11, 30), anchorDay: 31))
        return ledger
    }

    static func shell(_ ledger: Ledger = ledger(), failure: SaveFailure? = nil) -> ShellModel {
        Specimen.shell(FixedWorkspace(load: .ready(ledger), saveFailure: failure))
    }
}

extension CalendarDate {
    fileprivate static func day(_ year: Int, _ month: Int, _ day: Int) -> CalendarDate {
        CalendarDate(year: year, month: month, day: day) ?? .earliest
    }
}

#Preview("more (iphone-settings, Manage)") {
    let shell = OrganizeSpecimen.shell()
    SpecimenHost(shell: shell, lock: Specimen.lock()) {
        NavigationStack {
            SettingsView(onDone: {}).navigationDestination(for: SettingsRoute.self) { SettingsPage(route: $0) }
        }
    }
}

#Preview("iphone-accounts") {
    let shell = OrganizeSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { AccountsListView() } }
}

#Preview("iphone-account-form (new)") {
    let shell = OrganizeSpecimen.shell()
    SpecimenHost(shell: shell) { AccountFormSheet() }
}

#Preview("account-edit (in use)") {
    let shell = OrganizeSpecimen.shell()
    SpecimenHost(shell: shell) {
        AccountFormSheet(account: PaymentAccount(id: "demo-visa", name: "Visa", type: .credit))
    }
}

#Preview("iphone-categories") {
    let shell = OrganizeSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { CategoriesListView() } }
}

#Preview("iphone-category-form") {
    let shell = OrganizeSpecimen.shell()
    SpecimenHost(shell: shell) { CategoryFormSheet(kind: .expense) }
}

#Preview("iphone-recurring") {
    let shell = OrganizeSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { RecurringListView() } }
}

#Preview("recurring-paused (schedule)") {
    let shell = OrganizeSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { ScheduleDetailView(id: "spec-gym") } }
}

#Preview("iphone-schedule-detail") {
    let shell = OrganizeSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { ScheduleDetailView(id: "spec-internet") } }
}

#Preview("edit-schedule") {
    let ledger = OrganizeSpecimen.ledger()
    let shell = OrganizeSpecimen.shell(ledger)
    SpecimenHost(shell: shell) {
        if let rule = ledger.rule(id: "spec-internet") { ScheduleFormSheet(rule: rule) }
    }
}

#Preview("edit-schedule (save error keeps the draft)") {
    let ledger = OrganizeSpecimen.ledger()
    let shell = OrganizeSpecimen.shell(ledger, failure: .storage("This device is out of space. Your draft is kept."))
    SpecimenHost(shell: shell) {
        if let rule = ledger.rule(id: "spec-internet") { ScheduleFormSheet(rule: rule) }
    }
}
