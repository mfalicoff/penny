import Foundation
import PennyData
import Testing

@Suite("Stale share payments (MAZ-181)")
struct StaleShareChangeTests {
    private static func money(_ cents: Int64) -> String { "$\(cents / 100).\(String(format: "%02d", cents % 100))" }

    private static func change(_ before: WireSharedExpense, _ now: WireSharedExpense) -> StaleShareChange {
        StaleShareChange(before: before, now: now, fromUserId: FakeHouseholds.bea, money: money)
    }

    @Test("whenTheSameShareWasRecordedElsewhere_StaleShareChange_ShouldNamePaymentAndListOnlyTheStatus")
    func samePayment() {
        let before = FakeHouseholds.expense("e1", revision: 1)
        var now = before
        now.revision = 2
        now.payments = [
            WireExpensePayment(
                fromUserId: FakeHouseholds.bea, amountCents: 3000, createdAt: 5, createdBy: FakeHouseholds.bea)
        ]
        let change = Self.change(before, now)
        #expect(change.cause == .payment(recordedBy: FakeHouseholds.bea, fromUserId: FakeHouseholds.bea, at: 5))
        #expect(change.rows == [.init(value: .status, before: "Not repaid yet", now: "Repaid")])
        #expect(!change.rows.contains { $0.value == .total || $0.value == .share }, "unchanged values aren't struck")
    }

    @Test("whenAnotherShareWasRecorded_StaleShareChange_ShouldNameThatPaymentWithNoRows")
    func otherPayment() {
        let before = FakeHouseholds.expense("e1")
        var now = before
        now.payments = [
            WireExpensePayment(
                fromUserId: FakeHouseholds.cam, amountCents: 3000, createdAt: 9, createdBy: FakeHouseholds.me)
        ]
        let change = Self.change(before, now)
        #expect(change.cause == .payment(recordedBy: FakeHouseholds.me, fromUserId: FakeHouseholds.cam, at: 9))
        #expect(change.rows.isEmpty)
    }

    @Test("whenTheMonthWasSettled_StaleShareChange_ShouldSayMonthly")
    func monthly() {
        let before = FakeHouseholds.expense("e1")
        var now = before
        now.paymentsClosed = true
        let change = Self.change(before, now)
        #expect(change.cause == .monthly)
        #expect(change.rows == [.init(value: .status, before: "Not repaid yet", now: "Settles with the month")])
    }

    @Test("whenTheTotalWasEdited_StaleShareChange_ShouldNameTheEditAndListTotalAndShare")
    func edit() {
        let before = FakeHouseholds.expense("e1", total: 9000)
        var now = FakeHouseholds.expense("e1", total: 9600, revision: 1)
        now.updatedBy = FakeHouseholds.cam
        now.updatedAt = 42
        let change = Self.change(before, now)
        #expect(change.cause == .edit(editedBy: FakeHouseholds.cam, at: 42))
        #expect(
            change.rows == [
                .init(value: .total, before: "$90.00", now: "$96.00"),
                .init(value: .share, before: "$30.00", now: "$32.00"),
            ])
    }

    @Test("whenOnlyTheNameChanged_StaleShareChange_ShouldBeAnEditWithNothingStruck")
    func renamed() {
        let before = FakeHouseholds.expense("e1")
        var now = before
        now.title = "Electricity"
        let change = Self.change(before, now)
        #expect(change.cause == .edit(editedBy: before.updatedBy, at: before.updatedAt))
        #expect(change.rows.isEmpty)
    }
}
