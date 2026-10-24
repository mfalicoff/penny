import { act, fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import RootLayout from "../../../src/app/_layout";
import Accounts from "../../../src/app/accounts";
import Categories from "../../../src/app/categories";
import Overview from "../../../src/app/index";
import Recurring from "../../../src/app/recurring";
import Transactions from "../../../src/app/transactions";
import Trips from "../../../src/app/trips";
import TripOverview from "../../../src/app/trips/[id]";
import * as api from "../../../src/data/api";
import { emptyLedger } from "../../../src/domain/ledger";

jest.mock("../../../src/data/api", () => ({
  ApiError: class extends Error { },
  whoAmI: jest.fn(), fetchLedger: jest.fn(), mutateLedger: jest.fn(), signOut: jest.fn(), signIn: jest.fn(),
}));
jest.mock("../../../src/data/receipts", () => ({ saveReceipt: jest.fn() }));
jest.mock("../../../src/features/receipts/ReceiptPreview", () => ({ ReceiptPreview: () => null }));
jest.mock("../../../src/widgets/WidgetSync", () => ({ WidgetSync: () => null }));
jest.mock("../../../src/widgets/WidgetClear", () => ({ WidgetClear: () => null }));

beforeEach(() => {
  jest.mocked(api.whoAmI).mockResolvedValue("test@example.com");
  jest.mocked(api.fetchLedger).mockResolvedValue({ revision: 1, ledger: emptyLedger() });
});
afterEach(() => jest.useRealTimers());

test("real routes render their feature and navigation preserves overview filters and session", async () => {
  await renderRouter({ _layout: RootLayout, index: Overview, recurring: Recurring, categories: Categories, accounts: Accounts, transactions: Transactions, trips: Trips });
  expect(screen.getByText(/Your entries/)).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Search entries"), "coffee");
  await fireEvent.press(screen.getByRole("button", { name: "Transactions" }));
  expect(screen.getByText("Your transactions.")).toBeOnTheScreen();
  expect(screen.getByLabelText("Search entries")).toHaveDisplayValue("");
  await fireEvent.press(screen.getByRole("button", { name: "By year" }));
  await fireEvent.changeText(screen.getByLabelText("Search entries"), "salary");
  await fireEvent.press(screen.getByRole("button", { name: "More sections" }));
  await fireEvent.press(screen.getByRole("button", { name: "Recurring" }));
  expect(screen.getByText("Rent, payday, the usuals.")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Search entries")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "More sections" }));
  await fireEvent.press(screen.getByRole("button", { name: "Categories" }));
  expect(screen.getByText("EXPENSE CATEGORIES")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "More sections" }));
  await fireEvent.press(screen.getByRole("button", { name: "Accounts" }));
  expect(screen.getByText("Where your money lives.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Trips" }));
  expect(screen.getByText("Your next trip starts here.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Overview" }));
  expect(screen.getByLabelText("Search entries")).toHaveDisplayValue("coffee");
  await fireEvent.press(screen.getByRole("button", { name: "Transactions" }));
  expect(screen.getByLabelText("Search entries")).toHaveDisplayValue("salary");
  expect(screen.getByRole("button", { name: "By year", selected: true })).toBeOnTheScreen();
  expect(api.whoAmI).toHaveBeenCalledTimes(1);
  expect(api.fetchLedger).toHaveBeenCalledTimes(1);
});

test("deep linking opens the correct feature and an entry draft survives route changes", async () => {
  await renderRouter({ _layout: RootLayout, index: Overview, recurring: Recurring, categories: Categories, accounts: Accounts }, { initialUrl: "/recurring" });
  expect(screen.getByText("Rent, payday, the usuals.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Add a recurring entry" }));
  await fireEvent.changeText(screen.getByLabelText("What was it for?"), "Unfinished draft");
  await act(async () => { router.navigate("/"); });
  expect(screen.getByLabelText("What was it for?")).toHaveDisplayValue("Unfinished draft");
  await fireEvent.press(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByLabelText("Search entries")).toBeOnTheScreen();
});

test("trip navigation opens its overview and starts an assigned expense", async () => {
  const ledger = emptyLedger();
  ledger.trips.push({ id: "weekend", name: "Weekend away", startDate: "2026-09-10", endDate: "2026-09-12" });
  jest.mocked(api.fetchLedger).mockResolvedValue({ revision: 1, ledger });
  await renderRouter({ _layout: RootLayout, index: Overview, "trips/index": Trips, "trips/[id]": TripOverview }, { initialUrl: "/trips" });
  await fireEvent.press(screen.getByRole("button", { name: "Open trip Weekend away" }));
  expect(screen.getByText("By category")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Add expense to trip" }));
  expect(screen.getByRole("button", { name: "Trip: Weekend away" })).toBeOnTheScreen();
});
