import PennyData
import PennyDomain

extension ShellModel {
    /// Opens a deep link or an opened notification. A notification's household opens on the
    /// month it names (MAZ-79): the household page then keeps that month instead of following
    /// the calendar, and its Back path is the Shared tab (and the household, from an expense).
    func open(_ link: DeepLink) {
        if case .householdMonth(let household, let month, _) = link,
            let model = households.model(for: household)
        {
            model.open(month: month, current: MonthKey(today))
            // Already open (the same page stays on screen): read it again, since something changed.
            if model.detail != nil { Task { await model.refresh() } }
        }
        navigate { $0.open(link) }
    }
}
