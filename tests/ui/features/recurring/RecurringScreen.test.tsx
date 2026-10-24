import { fireEvent, render, screen } from "@testing-library/react-native";
import type { LedgerChange } from "../../../../src/domain/commands";
import { emptyLedger, type Ledger, type Recurring } from "../../../../src/domain/ledger";
import RecurringScreen from "../../../../src/features/recurring/RecurringScreen";

const mockSetForm = jest.fn();
const mockUseLedger = jest.fn();
jest.mock("../../../../src/providers/LedgerProvider", () => ({ useLedger: () => mockUseLedger() }));
jest.mock("../../../../src/providers/WorkspaceProvider", () => ({ useWorkspace: () => ({ setForm: mockSetForm }) }));

const rule = (overrides: Partial<Recurring> = {}): Recurring => ({
  id: "rent", title: "Rent", kind: "expense", total: 150000, share: 150000,
  categoryId: "home", date: "2026-10-01", note: "", frequency: "monthly",
  nextDate: "2026-11-01", anchorDay: 1, active: true, ...overrides,
});

function setup(recurring: Recurring[] = []) {
  let ledger: Ledger = { ...emptyLedger(), recurring };
  const commit = jest.fn(async (change: LedgerChange) => { ledger = change(ledger); });
  mockUseLedger.mockImplementation(() => ({ ledger, commit }));
  return { commit, getLedger: () => ledger };
}

beforeEach(() => jest.clearAllMocks());

test("empty recurring state opens a new entry", async () => {
  setup();
  await render(<RecurringScreen />);
  expect(screen.getByText("Rent, payday, the usuals.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Add a recurring entry" }));
  expect(mockSetForm).toHaveBeenCalledWith({});
});

test("editing, pausing, and resuming a schedule use the selected rule", async () => {
  const { commit, getLedger } = setup([rule()]);
  const view = await render(<RecurringScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Edit Rent schedule" }));
  expect(mockSetForm).toHaveBeenCalledWith({ rule: expect.objectContaining({ id: "rent" }) });
  await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
  expect(commit).toHaveBeenCalledWith(expect.any(Function), "Schedule paused");
  expect(getLedger().recurring[0].active).toBe(false);
  await view.rerender(<RecurringScreen />);
  expect(screen.getByText("PAUSED")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Resume" }));
  expect(commit).toHaveBeenLastCalledWith(expect.any(Function), "Schedule resumed");
  expect(getLedger().recurring[0].active).toBe(true);
});

test("deleting a schedule requires confirmation and keeps recorded entries", async () => {
  const { commit, getLedger } = setup([rule()]);
  await render(<RecurringScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Delete Rent schedule" }));
  expect(screen.getByText("Remove this schedule?")).toBeOnTheScreen();
  expect(getLedger().recurring).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Remove schedule" }));
  expect(commit).toHaveBeenCalledWith(expect.any(Function), "Schedule removed");
  expect(getLedger().recurring).toEqual([]);
});
