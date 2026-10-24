import { act, render } from "@testing-library/react-native";
import { demoLedger, type Transaction } from "../../../../src/domain/ledger";
import { EntryDialog } from "../../../../src/features/entries/EntryDialog";
import { playSaveHaptic } from "../../../../src/features/entries/saveHaptic";

const mockLedger = demoLedger();
const mockCommit = jest.fn(async () => {});
const mockSetMonth = jest.fn();
const mockSetDay = jest.fn();
let mockForm: { entry?: Transaction } = {};
let mockSave: (entry: Transaction) => Promise<void>;

jest.mock("../../../../src/providers/LedgerProvider", () => ({
  useLedger: () => ({ ledger: mockLedger, demo: true, commit: mockCommit }),
}));
jest.mock("../../../../src/providers/HouseholdProvider", () => ({
  useHouseholds: () => ({ households: [], refresh: jest.fn() }),
}));
jest.mock("../../../../src/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({ form: mockForm, setForm: jest.fn(), setMonth: mockSetMonth, setDay: mockSetDay }),
}));
jest.mock("../../../../src/features/entries/EntryForm", () => ({
  EntryForm: ({ onSave }: { onSave: (entry: Transaction) => Promise<void> }) => { mockSave = onSave; return null; },
}));
jest.mock("../../../../src/features/entries/saveHaptic", () => ({ playSaveHaptic: jest.fn() }));

test("haptic feedback plays after a new entry saves, never for a failed save or edit", async () => {
  const expense = mockLedger.transactions.find((entry) => entry.kind === "expense")!;
  const income = mockLedger.transactions.find((entry) => entry.kind === "income")!;
  const view = await render(<EntryDialog />);

  mockCommit.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => { await expect(mockSave(expense)).rejects.toThrow("Offline"); });
  expect(playSaveHaptic).not.toHaveBeenCalled();

  await act(async () => { await mockSave(income); });
  expect(mockCommit).toHaveBeenLastCalledWith(expect.any(Function), "Income added", "income");
  expect(playSaveHaptic).toHaveBeenCalledTimes(1);
  expect(mockSetMonth).toHaveBeenCalledWith(income.date.slice(0, 7));
  expect(mockSetDay).toHaveBeenCalledWith(null);

  mockForm = { entry: income };
  await view.rerender(<EntryDialog />);
  await act(async () => { await mockSave(income); });
  expect(mockCommit).toHaveBeenLastCalledWith(expect.any(Function), "Changes saved", undefined);
  expect(playSaveHaptic).toHaveBeenCalledTimes(1);
});
