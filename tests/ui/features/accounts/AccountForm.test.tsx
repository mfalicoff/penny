import { fireEvent, render, screen } from "@testing-library/react-native";
import type { LedgerChange } from "../../../../src/domain/commands";
import { emptyLedger } from "../../../../src/domain/ledger";
import { AccountForm } from "../../../../src/features/accounts/AccountForm";

test("a new account needs a name and saves its trimmed name and type", async () => {
  let ledger = emptyLedger();
  const commit = jest.fn(async (change: LedgerChange) => { ledger = change(ledger); });
  const onClose = jest.fn();
  await render(<AccountForm commit={commit} onClose={onClose} />);
  await fireEvent.press(screen.getByRole("button", { name: "Save account" }));
  expect(screen.getByText("Give your account a name of up to 50 characters.")).toBeOnTheScreen();
  expect(ledger.accounts).toEqual([]);
  await fireEvent.changeText(screen.getByLabelText("Account name"), "  Travel Visa  ");
  await fireEvent.press(screen.getByRole("button", { name: "Credit card" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save account" }));
  expect(ledger.accounts).toEqual([expect.objectContaining({ name: "Travel Visa", type: "credit" })]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a used account cannot be deleted", async () => {
  const commit = jest.fn();
  await render(<AccountForm account={{ id: "visa", name: "Visa", type: "credit" }} used commit={commit} onClose={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Account is in use" })).toBeDisabled();
  expect(commit).not.toHaveBeenCalled();
});

test("an unused account can be deleted", async () => {
  let ledger = emptyLedger();
  const account = { id: "cash", name: "Wallet", type: "cash" } as const;
  ledger.accounts.push(account);
  const commit = jest.fn(async (change: LedgerChange) => { ledger = change(ledger); });
  const onClose = jest.fn();
  await render(<AccountForm account={account} commit={commit} onClose={onClose} />);
  await fireEvent.press(screen.getByRole("button", { name: "Delete unused account" }));
  expect(ledger.accounts).toEqual([]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a failed account save keeps the draft available for retry", async () => {
  const commit = jest.fn().mockRejectedValueOnce(new Error("Sync unavailable")).mockResolvedValue(undefined);
  const onClose = jest.fn();
  await render(<AccountForm commit={commit} onClose={onClose} />);
  await fireEvent.changeText(screen.getByLabelText("Account name"), "Savings");
  await fireEvent.press(screen.getByRole("button", { name: "Save account" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Sync unavailable");
  expect(screen.getByLabelText("Account name")).toHaveDisplayValue("Savings");
  expect(onClose).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Save account" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
