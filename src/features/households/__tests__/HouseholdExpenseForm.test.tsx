import { fireEvent, render, screen } from "@testing-library/react-native";
import { createExpense } from "../../../data/households";
import { emptyLedger } from "../../../domain/ledger";
import { HouseholdExpenseForm } from "../HouseholdExpenseForm";

const mockLedger = () => emptyLedger();
jest.mock("../../../providers/LedgerProvider", () => ({ useLedger: () => ({ ledger: mockLedger(), email: "alice@example.com" }) }));
jest.mock("../../../data/households", () => ({ createExpense: jest.fn(), updateExpense: jest.fn(), deleteExpense: jest.fn(), createRecurring: jest.fn(), updateRecurring: jest.fn(), deleteRecurring: jest.fn() }));

const household = { id: "home", name: "Home", currency: "CAD", creatorId: "alice", createdAt: 1, memberCount: 3 };
const members = ["alice", "bob", "cara"].map((id) => ({ userId: id, email: `${id}@example.com`, joinedAt: 1 }));

test("an exact split that does not total the expense keeps the draft and blocks saving", async () => {
  const onClose = jest.fn();
  await render(<HouseholdExpenseForm household={household} members={members} onClose={onClose} onSaved={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText("Amount (CAD)"), "90.00");
  await fireEvent.changeText(screen.getByLabelText("What was it for?"), "Groceries");
  await fireEvent.press(screen.getByRole("button", { name: "Exact amounts" }));
  await fireEvent.changeText(screen.getByLabelText("You (CAD)"), "30");
  await fireEvent.changeText(screen.getByLabelText("bob@example.com (CAD)"), "20");
  await fireEvent.changeText(screen.getByLabelText("cara@example.com (CAD)"), "30");
  await fireEvent.press(screen.getByRole("button", { name: "Add expense" }));
  expect(screen.getByText("Member amounts must add up to the expense total.")).toBeOnTheScreen();
  expect(screen.getByLabelText("bob@example.com (CAD)")).toHaveDisplayValue("20");
  expect(createExpense).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
