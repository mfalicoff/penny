import { fireEvent, render, screen } from "@testing-library/react-native";
import { emptyLedger } from "../../../domain/ledger";
import { createExpense, getHousehold } from "../../../data/households";
import { EntryForm } from "../EntryForm";

jest.mock("../../../data/receipts", () => ({ saveReceipt: jest.fn() }));
jest.mock("../../../data/households", () => ({ ...jest.requireActual("../../../data/households"), createExpense: jest.fn(), getHousehold: jest.fn() }));
jest.mock("../../receipts/ReceiptPreview", () => ({ ReceiptPreview: () => null }));

test("investment form saves a full recurring contribution without expense controls", async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  await render(<EntryForm categories={emptyLedger().categories} currency="CAD" onClose={jest.fn()} onSave={onSave} onDelete={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Investment" }));
  await fireEvent.changeText(screen.getByLabelText("Amount (CAD)"), "1000.00");
  await fireEvent.changeText(screen.getByLabelText("Where are you investing?"), "TFSA contribution");
  expect(screen.queryByRole("button", { name: "Split equally" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Choose file" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Monthly" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add investment" }));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "investment", total: 100000, share: 100000, categoryId: "investments", receipt: undefined }),
    expect.objectContaining({ kind: "investment", frequency: "monthly", share: 100000 }),
  );
});

test("invalid money cannot submit an entry", async () => {
  const onSave = jest.fn();
  await render(<EntryForm categories={emptyLedger().categories} currency="CAD" onClose={jest.fn()} onSave={onSave} onDelete={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText("Amount (CAD)"), "1.234");
  await fireEvent.press(screen.getByRole("button", { name: "Add expense" }));
  expect(screen.getByText("Enter an amount with up to two decimal places.")).toBeOnTheScreen();
  expect(onSave).not.toHaveBeenCalled();
});

test("failed entry saves preserve the draft and retry submits integer cents", async () => {
  const onSave = jest.fn().mockRejectedValueOnce(new Error("Server offline")).mockResolvedValue(undefined);
  const onClose = jest.fn();
  await render(<EntryForm categories={emptyLedger().categories} currency="CAD" onClose={onClose} onSave={onSave} onDelete={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText("Amount (CAD)"), "12.34");
  await fireEvent.changeText(screen.getByLabelText("What was it for?"), "  Coffee  ");
  await fireEvent.press(screen.getByRole("button", { name: "Date" }));
  await fireEvent(screen.getByTestId("system-date-picker"), "valueChange", {}, new Date(2026, 8, 27, 12));
  await fireEvent.press(screen.getByRole("button", { name: "Add expense" }));
  expect(screen.getByText("Server offline")).toBeOnTheScreen();
  expect(screen.getByLabelText("Amount (CAD)")).toHaveDisplayValue("12.34");
  expect(onClose).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Add expense" }));
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Coffee", total: 1234, share: 1234, categoryId: "food", date: "2026-09-27" }), undefined);
  expect(onClose).toHaveBeenCalledTimes(1);
});


test("dismissing the date picker leaves the entry date unchanged", async () => {
  await render(<EntryForm categories={emptyLedger().categories} currency="CAD" onClose={jest.fn()} onSave={jest.fn()} onDelete={jest.fn()} />);
  const before = screen.getByRole("button", { name: "Date" }).props.accessibilityValue;
  await fireEvent.press(screen.getByRole("button", { name: "Date" }));
  await fireEvent(screen.getByTestId("system-date-picker"), "dismiss");
  expect(screen.queryByTestId("system-date-picker")).toBeNull();
  expect(screen.getByRole("button", { name: "Date" }).props.accessibilityValue).toEqual(before);
});

test("expense form assigns an existing trip and allows removing the assignment", async () => {
  const ledger = emptyLedger();
  const trip = { id: "trip", name: "Montréal", startDate: "2026-09-10", endDate: "2026-09-14" };
  const onSave = jest.fn().mockResolvedValue(undefined);
  await render(<EntryForm categories={ledger.categories} trips={[trip]} currency="CAD" onClose={jest.fn()} onSave={onSave} onDelete={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText("Amount (CAD)"), "20");
  await fireEvent.changeText(screen.getByLabelText("What was it for?"), "Lunch");
  await fireEvent.press(screen.getByRole("button", { name: "Trip: No trip" }));
  await fireEvent.press(screen.getByRole("button", { name: "Assign to Montréal" }));
  expect(screen.queryByRole("button", { name: "Assign to Montréal" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Add expense" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ tripId: "trip" }), undefined);
  await fireEvent.press(screen.getByRole("button", { name: "Trip: Montréal" }));
  await fireEvent.press(screen.getByRole("button", { name: "No trip" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add expense" }));
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ tripId: undefined }), undefined);
});

test("a member is available on their local join date even when the UTC date is tomorrow", async () => {
  const household = { id: "home", name: "Home", currency: "CAD", creatorId: "alice", createdAt: 1, memberCount: 2 };
  const members = [
    { userId: "alice", email: "alice@example.com", joinedAt: 1, joinedOn: "2026-01-01" },
    { userId: "bob", email: "bob@example.com", joinedAt: Date.parse("2026-10-05T01:30:00Z"), joinedOn: "2026-10-04" },
  ];
  jest.mocked(createExpense).mockResolvedValue({ expense: {} as never });
  await render(<EntryForm categories={emptyLedger().categories} currency="CAD" initialHousehold={household} initialMembers={members}
    userEmail="alice@example.com" onClose={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Date" }));
  await fireEvent(screen.getByTestId("system-date-picker"), "valueChange", {}, new Date(2026, 9, 4, 12));
  await fireEvent.press(screen.getByRole("button", { name: "Exact amounts" }));
  expect(screen.getByLabelText("bob@example.com (CAD)")).toBeOnTheScreen();
});

test("category options scroll outside the entry form's scroll view", async () => {
  await render(<EntryForm categories={emptyLedger().categories} currency="CAD" onClose={jest.fn()} onSave={jest.fn()} onDelete={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Category: Food & drinks" }));
  let parent = screen.getByRole("button", { name: "Other" }).parent;
  let scrollViews = 0;
  while (parent) {
    if (parent.type === "RCTScrollView") scrollViews++;
    parent = parent.parent;
  }
  expect(scrollViews).toBe(1);
});

test("the standard entry form keeps its draft when an Overview expense is assigned to a household", async () => {
  const household = { id: "home", name: "Home", currency: "CAD", creatorId: "alice", createdAt: 1, memberCount: 2 };
  const members = ["alice", "bob"].map((id) => ({ userId: id, email: `${id}@example.com`, joinedAt: 1 }));
  jest.mocked(getHousehold).mockResolvedValue({ household, members });
  jest.mocked(createExpense).mockResolvedValue({ expense: {} as never });
  const onClose = jest.fn();
  const onHouseholdSaved = jest.fn();
  const onHouseholdFeedback = jest.fn();
  await render(<EntryForm categories={emptyLedger().categories} currency="CAD" households={[household]}
    userEmail="alice@example.com" onClose={onClose} onHouseholdSaved={onHouseholdSaved}
    onHouseholdFeedback={onHouseholdFeedback} />);
  await fireEvent.changeText(screen.getByLabelText("Amount (CAD)"), "60.00");
  await fireEvent.changeText(screen.getByLabelText("What was it for?"), "Groceries");
  await fireEvent.press(screen.getByRole("button", { name: "Expense for Home" }));
  expect(await screen.findByText("Paid by")).toBeOnTheScreen();
  expect(screen.getByLabelText("Amount (CAD)")).toHaveDisplayValue("60.00");
  expect(screen.getByLabelText("What was it for?")).toHaveDisplayValue("Groceries");
  await fireEvent.press(screen.getByRole("button", { name: "Add expense" }));
  expect(createExpense).toHaveBeenCalledWith("home", expect.objectContaining({ title: "Groceries", totalCents: 6000, payerUserId: "alice", splitMode: "equal" }));
  expect(onHouseholdSaved).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onHouseholdFeedback).toHaveBeenCalledWith("Expense added", "expense");
});

test("a failed shared expense save does not show success feedback", async () => {
  const household = { id: "home", name: "Home", currency: "CAD", creatorId: "alice", createdAt: 1, memberCount: 2 };
  const members = ["alice", "bob"].map((id) => ({ userId: id, email: `${id}@example.com`, joinedAt: 1 }));
  jest.mocked(createExpense).mockRejectedValueOnce(new Error("Server offline"));
  const onClose = jest.fn();
  const onHouseholdFeedback = jest.fn();
  await render(<EntryForm categories={emptyLedger().categories} currency="CAD" initialHousehold={household}
    initialMembers={members} userEmail="alice@example.com" onClose={onClose}
    onHouseholdFeedback={onHouseholdFeedback} />);
  await fireEvent.changeText(screen.getByLabelText("Amount (CAD)"), "60.00");
  await fireEvent.changeText(screen.getByLabelText("What was it for?"), "Groceries");
  await fireEvent.press(screen.getByRole("button", { name: "Add expense" }));
  expect(screen.getByText("Server offline")).toBeOnTheScreen();
  expect(onClose).not.toHaveBeenCalled();
  expect(onHouseholdFeedback).not.toHaveBeenCalled();
});
