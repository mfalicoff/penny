import { fireEvent, render, screen } from "@testing-library/react-native";
import { emptyLedger } from "../../../domain/ledger";
import { EntryForm } from "../EntryForm";

jest.mock("../../../data/receipts", () => ({ saveReceipt: jest.fn() }));
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
