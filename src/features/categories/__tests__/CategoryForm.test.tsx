import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { LedgerChange } from "../../../domain/commands";
import { emptyLedger } from "../../../domain/ledger";
import { CategoryForm } from "../CategoryForm";

test("blank category names show validation without saving", async () => {
  const commit = jest.fn();
  await render(<CategoryForm ledger={emptyLedger()} onClose={jest.fn()} commit={commit} />);
  await fireEvent.press(screen.getByRole("button", { name: "Save category" }));
  expect(screen.getByText("Give your category a name.")).toBeOnTheScreen();
  expect(commit).not.toHaveBeenCalled();
});

test("saving a trimmed name applies the real category command then closes", async () => {
  let ledger = emptyLedger();
  const commit = jest.fn(async (change: LedgerChange) => { ledger = change(ledger); });
  const onClose = jest.fn();
  await render(<CategoryForm ledger={ledger} onClose={onClose} commit={commit} />);
  await fireEvent.changeText(screen.getByLabelText("Category name"), "  Travel  ");
  await fireEvent.press(screen.getByRole("button", { name: "Save category" }));
  expect(ledger.categories.at(-1)).toMatchObject({ name: "Travel", kind: "expense" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("entry-created categories keep the entry kind and report the saved choice", async () => {
  let ledger = emptyLedger();
  const commit = jest.fn(async (change: LedgerChange) => { ledger = change(ledger); });
  const onSaved = jest.fn();
  await render(<CategoryForm initialKind="income" onClose={jest.fn()} onSaved={onSaved} commit={commit} />);
  expect(screen.queryByRole("button", { name: "Expense" })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Category name"), "Consulting projects");
  await fireEvent.press(screen.getByRole("button", { name: "Save category" }));
  await waitFor(() => expect(ledger.categories.find((item) => item.name === "Consulting projects")).toMatchObject({ kind: "income" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "Consulting projects", kind: "income" })));
});

test("save failures retain the draft and allow a successful retry", async () => {
  const commit = jest.fn().mockRejectedValueOnce(new Error("Cannot reach your server.")).mockResolvedValue(undefined);
  const onClose = jest.fn();
  await render(<CategoryForm ledger={emptyLedger()} onClose={onClose} commit={commit} />);
  await fireEvent.changeText(screen.getByLabelText("Category name"), "Travel");
  await fireEvent.press(screen.getByRole("button", { name: "Save category" }));
  expect(screen.getByText("Cannot reach your server.")).toBeOnTheScreen();
  expect(screen.getByLabelText("Category name")).toHaveDisplayValue("Travel");
  expect(onClose).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Save category" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
