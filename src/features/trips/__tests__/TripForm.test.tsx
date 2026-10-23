import { fireEvent, render, screen } from "@testing-library/react-native";
import type { LedgerChange } from "../../../domain/commands";
import { emptyLedger, type Ledger } from "../../../domain/ledger";
import { TripForm } from "../TripForm";

test("a trip needs a name before it is saved", async () => {
  let ledger = emptyLedger();
  const commit = jest.fn(async (change: LedgerChange) => { ledger = change(ledger); });
  const onClose = jest.fn();
  await render(<TripForm commit={commit} onClose={onClose} />);
  await fireEvent.press(screen.getByRole("button", { name: "Create trip" }));
  expect(screen.getByText("Give your trip a name of up to 80 characters.")).toBeOnTheScreen();
  expect(ledger.trips).toEqual([]);
  await fireEvent.changeText(screen.getByLabelText("Trip name"), "  Autumn getaway  ");
  await fireEvent.press(screen.getByRole("button", { name: "Create trip" }));
  expect(ledger.trips).toEqual([expect.objectContaining({ name: "Autumn getaway" })]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a trip with an end date before its start date cannot be saved", async () => {
  let ledger = emptyLedger();
  const commit = jest.fn(async (change: LedgerChange) => { ledger = change(ledger); });
  await render(<TripForm commit={commit} onClose={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText("Trip name"), "Weekend");
  await fireEvent.press(screen.getByRole("button", { name: "Start date" }));
  await fireEvent(screen.getByTestId("system-date-picker"), "valueChange", {}, new Date(2100, 11, 31, 12));
  await fireEvent.press(screen.getByRole("button", { name: "Create trip" }));
  expect(screen.getByText("Choose valid trip dates, with the end on or after the start.")).toBeOnTheScreen();
  expect(ledger.trips).toEqual([]);
});

test("a trip linked to expenses cannot be deleted", async () => {
  const commit = jest.fn();
  await render(<TripForm trip={{ id: "weekend", name: "Weekend", startDate: "2026-10-10", endDate: "2026-10-11" }}
    used commit={commit} onClose={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Trip has expenses" })).toBeDisabled();
  expect(commit).not.toHaveBeenCalled();
});

test("deleting an unused trip removes it and reports the removal", async () => {
  const trip = { id: "weekend", name: "Weekend", startDate: "2026-10-10", endDate: "2026-10-11" };
  let ledger: Ledger = { ...emptyLedger(), trips: [trip] };
  const commit = jest.fn(async (change: LedgerChange) => { ledger = change(ledger); });
  const onRemoved = jest.fn();
  await render(<TripForm trip={trip} commit={commit} onClose={jest.fn()} onRemoved={onRemoved} />);
  await fireEvent.press(screen.getByRole("button", { name: "Delete trip" }));
  expect(ledger.trips).toEqual([]);
  expect(onRemoved).toHaveBeenCalledTimes(1);
});

test("a failed trip save keeps the draft available for retry", async () => {
  const commit = jest.fn().mockRejectedValueOnce(new Error("Sync unavailable")).mockResolvedValue(undefined);
  const onClose = jest.fn();
  await render(<TripForm commit={commit} onClose={onClose} />);
  await fireEvent.changeText(screen.getByLabelText("Trip name"), "Weekend");
  await fireEvent.press(screen.getByRole("button", { name: "Create trip" }));
  expect(screen.getByText("Sync unavailable")).toBeOnTheScreen();
  expect(screen.getByLabelText("Trip name")).toHaveDisplayValue("Weekend");
  expect(onClose).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Create trip" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
