import { fireEvent, render, screen } from "@testing-library/react-native";
import { emptyLedger, type Ledger, type Transaction } from "../../../../src/domain/ledger";
import type { TransactionFilters } from "../../../../src/features/transactions/selectors";
import TransactionsScreen from "../../../../src/features/transactions/TransactionsScreen";

const mockUseLedger = jest.fn();
const mockUseWorkspace = jest.fn();
const mockLoadProjection = jest.fn();
jest.mock("../../../../src/providers/LedgerProvider", () => ({ useLedger: () => mockUseLedger() }));
jest.mock("../../../../src/providers/WorkspaceProvider", () => ({ useWorkspace: () => mockUseWorkspace() }));
jest.mock("../../../../src/providers/HouseholdProvider", () => ({ useHouseholds: () => ({ projection: [], households: [], loadProjection: mockLoadProjection }) }));

const entry = (id: string, kind: Transaction["kind"], title: string, date = "2026-10-12"): Transaction => ({
  id, kind, title, date, total: 1200, share: 1200,
  categoryId: kind === "income" ? "salary" : kind === "investment" ? "investments" : "food", note: "",
});

function setup(transactions: Transaction[] = []) {
  const ledger: Ledger = { ...emptyLedger(), transactions };
  let filters: TransactionFilters = { month: "2026-10", period: "month", filter: "all", search: "", page: 0 };
  const setForm = jest.fn();
  const setTransactionFilters = jest.fn((update: (current: TransactionFilters) => TransactionFilters) => { filters = update(filters); });
  mockUseLedger.mockReturnValue({ ledger });
  mockUseWorkspace.mockImplementation(() => ({ transactionFilters: filters, setTransactionFilters, setForm }));
  return { setForm, setTransactionFilters, getFilters: () => filters };
}

beforeEach(() => jest.clearAllMocks());

test("month and year controls load the matching household projection", async () => {
  const { getFilters } = setup();
  const view = await render(<TransactionsScreen />);
  expect(mockLoadProjection).toHaveBeenCalledWith("2026-10");
  await fireEvent.press(screen.getByRole("button", { name: "By year" }));
  await view.rerender(<TransactionsScreen />);
  expect(getFilters()).toMatchObject({ period: "year", page: 0 });
  expect(mockLoadProjection).toHaveBeenLastCalledWith("2026");
  await fireEvent.press(screen.getByRole("button", { name: "Previous year" }));
  expect(getFilters().month).toBe("2025-10");
});

test("period picker rejects invalid years and applies a selected month", async () => {
  const { getFilters } = setup();
  await render(<TransactionsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: /^Choose month:/ }));
  await fireEvent.changeText(screen.getByLabelText("Year"), "1999");
  expect(screen.getByRole("button", { name: "Apply period" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Year"), "2025");
  await fireEvent.press(screen.getByRole("button", { name: "Nov" }));
  await fireEvent.press(screen.getByRole("button", { name: "Apply period" }));
  expect(getFilters().month).toBe("2025-11");
});

test("search, kind filters, and entry selection act on visible transactions", async () => {
  const { setForm, getFilters } = setup([entry("coffee", "expense", "Coffee"), entry("pay", "income", "Payday")]);
  const view = await render(<TransactionsScreen />);
  await fireEvent.changeText(screen.getByLabelText("Search entries"), "Coffee");
  await view.rerender(<TransactionsScreen />);
  expect(getFilters().search).toBe("Coffee");
  expect(screen.getByRole("button", { name: /Edit Coffee/ })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /Edit Payday/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: /Edit Coffee/ }));
  expect(setForm).toHaveBeenCalledWith({ entry: expect.objectContaining({ id: "coffee" }) });
  await fireEvent.press(screen.getByRole("button", { name: "Income" }));
  expect(getFilters()).toMatchObject({ filter: "income", page: 0 });
});

test("pagination advances through more than fifty entries", async () => {
  const transactions = Array.from({ length: 51 }, (_, index) => entry(String(index).padStart(2, "0"), "expense", `Item ${index}`));
  const { getFilters } = setup(transactions);
  const view = await render(<TransactionsScreen />);
  expect(screen.getByText("Showing 1–50 of 51 entries")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Next page" }));
  await view.rerender(<TransactionsScreen />);
  expect(getFilters().page).toBe(1);
  expect(screen.getByText("Showing 51–51 of 51 entries")).toBeOnTheScreen();
});
