import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import type { LedgerChange } from "../../../domain/commands";
import { emptyLedger, type Ledger } from "../../../domain/ledger";
import { SettingsSheet } from "../SettingsSheet";

const mockUseLedger = jest.fn();
jest.mock("../../../providers/LedgerProvider", () => ({ useLedger: () => mockUseLedger() }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));

function setup(ledger: Ledger = emptyLedger(), demo = false) {
  const commit = jest.fn(async (change: LedgerChange) => { ledger = change(ledger); });
  const logout = jest.fn().mockResolvedValue(true);
  const leaveDemo = jest.fn();
  mockUseLedger.mockImplementation(() => ({ ledger, email: "alex@example.com", demo, commit, logout, leaveDemo }));
  return { commit, logout, leaveDemo, getLedger: () => ledger };
}

beforeEach(() => jest.clearAllMocks());

test("currency can change before the first entry and account identity is shown", async () => {
  const { commit, getLedger } = setup();
  await render(<SettingsSheet visible onClose={jest.fn()} />);
  expect(screen.getByText(/Signed in as alex@example.com/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "USD" }));
  expect(commit).toHaveBeenCalledWith(expect.any(Function), "Currency updated");
  expect(getLedger().currency).toBe("USD");
});

test("currency is locked once a transaction exists", async () => {
  const ledger = emptyLedger();
  ledger.transactions.push({ id: "coffee", title: "Coffee", kind: "expense", total: 500, share: 500, categoryId: "food", date: "2026-10-12", note: "" });
  const { commit } = setup(ledger);
  await render(<SettingsSheet visible onClose={jest.fn()} />);
  expect(screen.getByRole("button", { name: "USD" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "CAD" })).not.toBeDisabled();
  expect(commit).not.toHaveBeenCalled();
});

test("failed sign-out leaves the user on the current screen", async () => {
  const { logout } = setup();
  logout.mockResolvedValue(false);
  const onClose = jest.fn();
  await render(<SettingsSheet visible onClose={onClose} />);
  await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(router.navigate).not.toHaveBeenCalled();
});

test("leaving demo returns to the start screen", async () => {
  const { leaveDemo, logout } = setup(emptyLedger(), true);
  await render(<SettingsSheet visible onClose={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Leave demo" }));
  expect(leaveDemo).toHaveBeenCalledTimes(1);
  expect(logout).not.toHaveBeenCalled();
  expect(router.navigate).toHaveBeenCalledWith("/");
});
