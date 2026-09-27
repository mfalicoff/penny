import { act, fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import RootLayout from "../../app/_layout";
import Accounts from "../../app/accounts";
import Categories from "../../app/categories";
import Overview from "../../app/index";
import Recurring from "../../app/recurring";
import * as api from "../../data/api";
import { emptyLedger } from "../../domain/ledger";

jest.mock("../../data/api", () => ({
  ApiError: class extends Error { },
  whoAmI: jest.fn(), fetchLedger: jest.fn(), mutateLedger: jest.fn(), signOut: jest.fn(), signIn: jest.fn(),
}));
jest.mock("../../data/receipts", () => ({ saveReceipt: jest.fn() }));
jest.mock("../../features/receipts/ReceiptPreview", () => ({ ReceiptPreview: () => null }));

beforeEach(() => {
  jest.mocked(api.whoAmI).mockResolvedValue("test@example.com");
  jest.mocked(api.fetchLedger).mockResolvedValue({ revision: 1, ledger: emptyLedger() });
});
afterEach(() => jest.useRealTimers());

test("real routes render their feature and navigation preserves overview filters and session", async () => {
  await renderRouter({ _layout: RootLayout, index: Overview, recurring: Recurring, categories: Categories, accounts: Accounts });
  expect(screen.getByText(/Your entries/)).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Search entries"), "coffee");
  await fireEvent.press(screen.getByRole("button", { name: "Recurring" }));
  expect(screen.getByText("Rent, payday, the usuals.")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Search entries")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Categories" }));
  expect(screen.getByText("EXPENSE CATEGORIES")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Accounts" }));
  expect(screen.getByText("Where your money lives.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Overview" }));
  expect(screen.getByLabelText("Search entries")).toHaveDisplayValue("coffee");
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
