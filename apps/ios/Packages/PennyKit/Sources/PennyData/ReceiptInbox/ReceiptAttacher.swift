import Foundation
public import PennyDomain

/// What attaching did, for the confirmation's View entry and Undo.
public struct ReceiptAttachment: Equatable, Sendable {
    /// The entry, as it is now (with the receipt).
    public var target: AttachTarget
    /// The receipt the entry had before; Undo links it again.
    public var previousReceiptId: String?
    /// The personal save, for the workspace's Undo; nil for a shared expense.
    public var saved: SavedChange?
    /// The file's label ("Email" or its name).
    public var fileLabel: String

    public init(target: AttachTarget, previousReceiptId: String?, saved: SavedChange?, fileLabel: String) {
        self.target = target
        self.previousReceiptId = previousReceiptId
        self.saved = saved
        self.fileLabel = fileLabel
    }

    /// "Receipt attached to Coffee at Mill St."
    public var message: String {
        let title = target.title.trimmingCharacters(in: .whitespaces)
        return title.hasSuffix(".") ? "Receipt attached to \(title)" : "Receipt attached to \(title)."
    }
}

public enum ReceiptAttachFailure: Error, Equatable, Sendable {
    /// The shared expense changed meanwhile (409): confirm again with these values.
    case changed(AttachTarget)
    case message(String)

    public var message: String {
        switch self {
        case .changed: "This expense changed since you opened it. Check it and attach again."
        case .message(let text): text
        }
    }
}

/// Attaches an inbox file to an entry with the normal saves (MAZ-184): a personal expense is a
/// ledger edit (kept on this device and synced like any other change), a shared expense is the
/// shared expense update with its revision. There is no attach endpoint; the server updates
/// the inbox item's state inside those saves.
@MainActor
public final class ReceiptAttacher {
    private let workspace: any LedgerWorkspace
    private let households: (any HouseholdService)?
    private let email: String
    private let timezoneOffset: @MainActor () -> Int

    public init(
        workspace: any LedgerWorkspace, households: (any HouseholdService)?, email: String,
        timezoneOffset: @escaping @MainActor () -> Int = { LocalTimeZone.offsetMinutes() }
    ) {
        self.workspace = workspace
        self.households = households
        self.email = email
        self.timezoneOffset = timezoneOffset
    }

    /// Shared expenses the person can attach to near `received`: the months covering 7 days
    /// either side, in households where they are a current member. Households they left are
    /// skipped. A household that can't be read is left out, not a failure.
    public func sharedTargets(_ list: [WireHousehold], received: PennyDomain.CalendarDate) async -> [AttachTarget] {
        guard let households else { return [] }
        let window = ReceiptInboxRules.suggestionWindowDays
        let months = Set([received.adding(days: -window), received, received.adding(days: window)].map(MonthKey.init))
        var targets: [AttachTarget] = []
        for household in list {
            guard let detail = try? await households.household(id: household.id),
                HouseholdPeople(members: detail.members, email: email).viewerIsCurrent
            else { continue }
            for month in months.sorted() {
                guard let expenses = try? await households.sharedExpenses(householdId: household.id, month: month)
                else { continue }
                targets += expenses.map { .shared($0, householdName: detail.household.name) }
            }
        }
        return targets
    }

    /// Links `file` to `target`. A personal expense must still be the one the sheet showed.
    public func attach(_ file: WireReceiptInboxFile, to target: AttachTarget) async
        -> Result<ReceiptAttachment, ReceiptAttachFailure>
    {
        let label = ReceiptInboxRules.fileLabel(file)
        switch target {
        case .personal(let entry):
            guard entry.kind == .expense else { return .failure(.message("Only expenses can have a receipt.")) }
            let attached = ReceiptInboxRules.attaching(file, to: entry)
            let summary = ChangeSummary(
                title: "Receipt attached", detail: entry.title, kind: .expense, categoryId: entry.categoryId)
            switch await workspace.commit(.saveEntry(attached, original: entry), summary: summary) {
            case .success(let saved):
                return .success(
                    ReceiptAttachment(
                        target: .personal(attached), previousReceiptId: entry.receipt?.id, saved: saved,
                        fileLabel: label))
            case .failure(let failure):
                return .failure(.message(failure.message))
            }
        case .shared(let expense, let name):
            switch await updateShared(expense, receiptId: file.receiptId) {
            case .success(let updated):
                return .success(
                    ReceiptAttachment(
                        target: .shared(updated, householdName: name), previousReceiptId: expense.receiptId,
                        saved: nil, fileLabel: label))
            case .failure(let failure):
                if case .changed(.shared(let fresh, _)) = failure {
                    return .failure(.changed(.shared(fresh, householdName: name)))
                }
                return .failure(failure)
            }
        }
    }

    /// Removes the link again (the file goes back to the inbox), restoring the receipt the
    /// entry had before. Returns the failure's message.
    public func undo(_ attachment: ReceiptAttachment) async -> String? {
        switch attachment.target {
        case .personal:
            guard let saved = attachment.saved else { return nil }
            if case .failure(let failure) = await workspace.undo(saved) { return failure.message }
            return nil
        case .shared(let expense, _):
            if case .failure(let failure) = await updateShared(expense, receiptId: attachment.previousReceiptId) {
                return failure.message
            }
            return nil
        }
    }

    private func updateShared(_ expense: WireSharedExpense, receiptId: String?) async
        -> Result<WireSharedExpense, ReceiptAttachFailure>
    {
        guard let households else { return .failure(.message("Sign in to attach receipts.")) }
        let input = ReceiptInboxRules.sharedUpdate(expense, receiptId: receiptId, timezoneOffset: timezoneOffset())
        do {
            return .success(
                try await households.updateSharedExpense(householdId: expense.householdId, id: expense.id, input))
        } catch APIError.conflict {
            guard
                let fresh = try? await households.sharedExpense(householdId: expense.householdId, id: expense.id)
            else { return .failure(.message(ReceiptInboxFailure.message(APIError.notFound(message: nil)))) }
            return .failure(.changed(.shared(fresh, householdName: "")))
        } catch {
            return .failure(.message(ReceiptInboxFailure.message(error)))
        }
    }
}
