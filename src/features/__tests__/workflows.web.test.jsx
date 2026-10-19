import { beforeEach, expect, jest, test } from "@jest/globals";
import { act } from "react";
import { getDocumentAsync } from "expo-document-picker";
import { getDocument } from "pdfjs-dist";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { button, click, fill, renderWeb } from "../../../tests/web-renderer";
import * as api from "../../data/api";
import * as receipts from "../../data/receipts";
import { demoLedger, emptyLedger } from "../../domain/ledger";
import { LedgerProvider } from "../../providers/LedgerProvider";
import { WorkspaceProvider } from "../../providers/WorkspaceProvider";
import { C, getTheme, setTheme, ThemeProvider } from "../../shared/theme";
import { Auth } from "../auth/AuthScreen";
import AccountsScreen from "../accounts/AccountsScreen";
import CategoriesScreen from "../categories/CategoriesScreen";
import { EntryDialog } from "../entries/EntryDialog";
import { EntryForm } from "../entries/EntryForm";
import OverviewScreen from "../overview/OverviewScreen";
import TransactionsScreen from "../transactions/TransactionsScreen";
import RecurringScreen from "../recurring/RecurringScreen";
import { ReceiptPreview } from "../receipts/ReceiptPreview";
import { SettingsSheet } from "../settings/SettingsSheet";

jest.mock("../../data/api", () => ({
  ApiError: class extends Error {}, whoAmI: jest.fn(), fetchLedger: jest.fn(), saveSnapshot: jest.fn(), mutateLedger: jest.fn(), signIn: jest.fn(), signOut: jest.fn(),
}));
jest.mock("../../data/receipts", () => ({ saveReceipt: jest.fn(), receiptUrl: jest.fn(), releaseReceiptUrl: jest.fn() }));
jest.mock("../../providers/HouseholdProvider", () => ({ useHouseholds: () => ({ households: [], projection: [], refresh: jest.fn(), loadProjection: jest.fn() }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: jest.fn() }));
jest.mock("../../shared/useResponsive", () => ({ useResponsive: () => mockResponsive }));

let mockResponsive;
let ledger;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockResponsive = { compact: false, desktop: true };
  ledger = demoLedger();
  api.whoAmI.mockResolvedValue("test@example.com");
  api.fetchLedger.mockImplementation(async () => ({ revision: 1, ledger }));
  api.saveSnapshot.mockImplementation(async (snapshot) => {
    ledger = snapshot.ledger;
    return { revision: snapshot.revision + 1, ledger };
  });
});

function Workspace({ children }) {
  return <ThemeProvider><LedgerProvider><WorkspaceProvider>{children}</WorkspaceProvider></LedgerProvider></ThemeProvider>;
}

test.each([
  ["desktop", { compact: false, desktop: true }],
  ["phone", { compact: true, desktop: false }],
])("%s transactions supports direct period selection, yearly totals, filters and editing", async (_name, responsive) => {
  mockResponsive = responsive;
  ledger.recurring = [];
  const base = { total: 10000, share: 5000, categoryId: "food", note: "", kind: "expense" };
  ledger.transactions = [
    { ...base, id: "feb", title: "February lunch", date: "2024-02-29" },
    { ...base, id: "jan", title: "January salary", date: "2024-01-01", kind: "income", categoryId: "salary", share: 50000 },
    { ...base, id: "dec", title: "December investment", date: "2024-12-31", kind: "investment", categoryId: "investments", share: 10000 },
    { ...base, id: "outside", title: "Other year", date: "2023-12-31" },
  ];
  const body = await renderWeb(<Workspace><TransactionsScreen /><EntryDialog /></Workspace>);
  await click(body.querySelector('[aria-label^="Choose month:"]'));
  await fill("Year", "1999");
  expect(button("Apply period").getAttribute("aria-disabled")).toBe("true");
  await fill("Year", "2024");
  await click(button("Feb"));
  await click(button("Apply period"));
  expect(body.textContent).toContain("February lunch");
  expect(body.textContent).not.toContain("January salary");
  await click(button("By year"));
  expect(body.textContent).toContain("January salary");
  expect(body.textContent).toContain("December investment");
  expect(body.textContent).not.toContain("Other year");
  expect(body.textContent).toContain("Cash remaining$350.00");
  await click(button("Investments"));
  expect(body.textContent).not.toContain("February lunch");
  expect(body.textContent).toContain("Cash remaining$350.00");
  await click(body.querySelector('[aria-label^="Edit December investment,"]'));
  expect(body.textContent).toContain("Edit entry");
  await click(button("Close dialog"));
  await click(button("All"));
  await fill("Search entries", "missing");
  expect(body.textContent).toContain("No entries found.");
  await fill("Search entries", "");
  await click(button("Next year"));
  expect(body.textContent).toContain("No recorded entries for 2025.");
  await click(button("Previous year"));
  expect(body.textContent).toContain("February lunch");
});

test.each([
  ["desktop", { compact: false, desktop: true }],
  ["phone", { compact: true, desktop: false }],
])("%s populated overview renders the chart, filters entries, and opens an edit dialog", async (_name, responsive) => {
  mockResponsive = responsive;
  const body = await renderWeb(<Workspace><OverviewScreen /><EntryDialog /></Workspace>);
  expect(body.querySelector("svg")).not.toBeNull();
  expect(body.textContent).toContain("Weekly groceries");
  await fill("Search entries", "no matching transaction");
  expect(body.textContent).toContain("No entries found.");
  expect(body.querySelector("svg")).not.toBeNull();
  await fill("Search entries", "Weekly groceries");
  const edit = body.querySelector('[aria-label^="Edit Weekly groceries,"]');
  expect(edit).not.toBeNull();
  await click(edit);
  expect(body.textContent).toContain("Edit entry");
  expect(body.querySelector('[aria-label="Amount (CAD)"]').value).toBe("86.42");
  await click(button("Close dialog"));
  await click(button("Previous month"));
  expect(body.textContent).toContain("Every little entry tells a story.");
});

test("new split recurring expense validates, saves cents and closes only after success", async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error("Offline for test")).mockResolvedValue(undefined);
  const close = jest.fn();
  const body = await renderWeb(<EntryForm categories={ledger.categories} currency="CAD" onClose={close} onSave={save} onDelete={jest.fn()} />);
  await click(button("Add expense"));
  expect(body.textContent).toContain("Enter an amount with up to two decimal places.");
  await fill("Amount (CAD)", "98.00");
  await fill("What was it for?", "metro");
  await click(button("Category: Food & drinks"));
  await click(button("Groceries"));
  await click(button("Split equally"));
  await click(button("Monthly"));
  await click(button("Add expense"));
  expect(body.textContent).toContain("Offline for test");
  expect(close).not.toHaveBeenCalled();
  expect(body.querySelector('[aria-label="Amount (CAD)"]').value).toBe("98.00");
  await click(button("Add expense"));
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ total: 9800, share: 4900, categoryId: "groceries" }), expect.objectContaining({ frequency: "monthly" }));
  expect(close).toHaveBeenCalledTimes(1);
});

test.each([
  ["desktop", { compact: false, desktop: true }],
  ["phone", { compact: true, desktop: false }],
])("%s investment edits update totals, chart, and filters without counting as spending", async (_name, responsive) => {
  mockResponsive = responsive;
  const date = ledger.transactions[0].date;
  ledger.transactions = [
    { id: "pay", title: "Salary", kind: "income", categoryId: "salary", total: 500000, share: 500000, date, note: "" },
    { id: "rent", title: "Rent", kind: "expense", categoryId: "home", total: 300000, share: 300000, date, note: "" },
    { id: "tfsa", title: "TFSA deposit", kind: "expense", categoryId: "other", total: 100000, share: 100000, date, note: "" },
  ];
  ledger.recurring = [];
  const body = await renderWeb(<Workspace><OverviewScreen /><EntryDialog /></Workspace>);
  await click(body.querySelector('[aria-label^="Edit TFSA deposit,"]'));
  await click(button("Investment"));
  await click(button("Save changes"));
  expect(ledger.transactions.find((entry) => entry.id === "tfsa")).toMatchObject({ kind: "investment", categoryId: "investments" });
  expect(body.textContent).toContain("Expenses$3,000.00");
  expect(body.textContent).toContain("Invested$1,000.00");
  expect(body.textContent).toContain("Cash remaining$1,000.00");
  expect(body.querySelector('[aria-label^="Invested,"]')).not.toBeNull();
  await click(button("Investments"));
  expect(body.querySelector('[aria-label^="Edit TFSA deposit,"]')).not.toBeNull();
  expect(body.querySelector('[aria-label^="Edit Rent,"]')).toBeNull();
  await click(body.querySelector('[aria-label^="Edit TFSA deposit,"]'));
  await click(button("Delete entry"));
  await click(button("Delete this entry"));
  expect(body.textContent).toContain("Invested$0.00");
  expect(body.textContent).toContain("Cash remaining$2,000.00");
});

test("income form and deletion confirmation render and invoke their actions", async () => {
  const income = ledger.transactions.find((entry) => entry.kind === "income");
  const remove = jest.fn().mockResolvedValue(undefined);
  const body = await renderWeb(<EntryForm categories={ledger.categories} currency="CAD" entry={income} onClose={jest.fn()} onSave={jest.fn()} onDelete={remove} />);
  expect(body.querySelector('[aria-label="Where did it come from?"]')).not.toBeNull();
  await click(button("Delete entry"));
  expect(remove).not.toHaveBeenCalled();
  await click(button("Keep entry"));
  await click(button("Delete entry"));
  await click(button("Delete this entry"));
  expect(remove).toHaveBeenCalledWith(income.id);
});

test("categories create, edit and delete unused categories through the actual provider", async () => {
  const body = await renderWeb(<Workspace><CategoriesScreen /></Workspace>);
  await click(button("New category"));
  await fill("Category name", "QA travel");
  await click(button("Save category"));
  expect(body.textContent).toContain("QA travel");
  await click(button("Edit category QA travel"));
  await fill("Category name", "QA travel renamed");
  await click(button("Save category"));
  await click(button("Edit category QA travel renamed"));
  await click(button("Delete unused category"));
  expect(ledger.categories.some((category) => category.name.startsWith("QA travel"))).toBe(false);
});

test("recurring schedules pause, resume and remove without deleting transaction history", async () => {
  ledger.recurring = [ledger.recurring[0]];
  const historyCount = ledger.transactions.length;
  const body = await renderWeb(<Workspace><RecurringScreen /></Workspace>);
  await click(button("Pause"));
  expect(body.textContent).toContain("PAUSED");
  await click(button("Resume"));
  expect(button("Pause")).toBeTruthy();
  await click(button(`Delete ${ledger.recurring[0].title} schedule`));
  await click(button("Remove schedule"));
  expect(body.textContent).toContain("Rent, payday, the usuals.");
  expect(ledger.transactions).toHaveLength(historyCount);
});

test("settings changes the currency of an empty account", async () => {
  ledger = emptyLedger();
  const body = await renderWeb(<Workspace><SettingsSheet visible onClose={jest.fn()} /></Workspace>);
  await click(button("USD"));
  expect(ledger.currency).toBe("USD");
  expect(body.textContent).toContain("Your personal space");
});

test("settings switches all four appearance palettes", async () => {
  const body = await renderWeb(<Workspace><SettingsSheet visible onClose={jest.fn()} /></Workspace>);
  try {
    for (const [label, theme, background] of [
      ["Dark", "dark", "#171D1B"],
      ["AMOLED", "amoled", "#000000"],
      ["Catppuccin", "catppuccin", "#1E1E2E"],
      ["Light", "light", "#F8F8F4"],
    ]) {
      await click(body.querySelector(`[aria-label="${label} theme"]`));
      expect(getTheme()).toBe(theme);
      expect(C.bg).toBe(background);
      expect(body.querySelector(`[aria-label="${label} theme"]`).getAttribute("aria-checked")).toBe("true");
    }
  } finally {
    act(() => setTheme("light"));
  }
});

test("auth handles errors, registration switching and a successful retry", async () => {
  api.signIn.mockRejectedValueOnce(new Error("Incorrect password")).mockResolvedValue("qa@example.com");
  const ready = jest.fn();
  const body = await renderWeb(<Auth onReady={ready} onDemo={jest.fn()} />);
  await fill("Email", "qa@example.com");
  await fill("Password", "local-test-password");
  await click(button("Sign in"));
  expect(body.textContent).toContain("Incorrect password");
  await click(button("New here? Create an account"));
  expect(body.textContent).toContain("Make yourself at home.");
  await click(button("Already have an account? Sign in"));
  await click(button("Sign in"));
  expect(ready).toHaveBeenCalledWith("qa@example.com");
});

test("receipt selection rejects oversized files and canceled selection leaves the draft intact", async () => {
  const body = await renderWeb(<EntryForm categories={ledger.categories} currency="CAD" onClose={jest.fn()} onSave={jest.fn()} onDelete={jest.fn()} />);
  await fill("What was it for?", "Receipt test");
  getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "test.pdf", name: "Large.pdf", mimeType: "application/pdf", size: 11 * 1024 * 1024 }] });
  await click(button("Choose file"));
  expect(body.textContent).toContain("Choose a receipt smaller than 10 MB.");
  getDocumentAsync.mockResolvedValueOnce({ canceled: true });
  await click(button("Choose file"));
  expect(body.querySelector('[aria-label="What was it for?"]').value).toBe("Receipt test");
});

test("receipt upload failure preserves the file and allows retry before saving", async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const receipt = { id: "receipt", name: "Bill.pdf", mime: "application/pdf", uri: "receipt" };
  const body = await renderWeb(<EntryForm categories={ledger.categories} currency="CAD" onClose={jest.fn()} onSave={save} onDelete={jest.fn()} />);
  await fill("Amount (CAD)", "12.00");
  await fill("What was it for?", "Receipt test");
  getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "test.pdf", name: "Bill.pdf", mimeType: "application/pdf", size: 100 }] });
  receipts.saveReceipt.mockRejectedValueOnce(new Error("Upload unavailable")).mockResolvedValueOnce(receipt);
  await click(button("Choose file"));
  await click(button("Add expense"));
  expect(body.textContent).toContain("Upload unavailable");
  expect(body.textContent).toContain("Bill.pdf");
  expect(save).not.toHaveBeenCalled();
  await click(button("Add expense"));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ receipt }), undefined);
});

test("receipt preview shows a loading state, handles failure and releases image URLs", async () => {
  const image = { id: "image", name: "Receipt.png", mime: "image/png", uri: "image" };
  let resolve;
  receipts.receiptUrl.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const body = await renderWeb(<ReceiptPreview receipt={image} />);
  expect(body.textContent).toContain("Opening your receipt…");
  await act(async () => resolve("blob:receipt-image"));
  expect(body.querySelector('[aria-label="Attached receipt"]')).not.toBeNull();
  await renderWeb(null);
  expect(receipts.releaseReceiptUrl).toHaveBeenCalledWith("blob:receipt-image");
  receipts.receiptUrl.mockRejectedValueOnce(new Error("Receipt unavailable"));
  await renderWeb(<ReceiptPreview receipt={image} />);
  expect(body.textContent).toContain("Receipt unavailable");
});

test("PDF preview renders page controls, advances pages and retains its download link", async () => {
  const receipt = { id: "pdf", name: "Bill.pdf", mime: "application/pdf", uri: "pdf" };
  const render = jest.fn(() => ({ promise: Promise.resolve(), cancel: jest.fn() }));
  const getPage = jest.fn(async () => ({ getViewport: () => ({ width: 600, height: 800 }), render }));
  const destroy = jest.fn().mockResolvedValue(undefined);
  receipts.receiptUrl.mockResolvedValueOnce("blob:receipt-pdf");
  getDocument.mockReturnValueOnce({ promise: Promise.resolve({ numPages: 2, getPage }), destroy });
  const body = await renderWeb(<ReceiptPreview receipt={receipt} />);
  expect(body.textContent).toContain("1 / 2");
  await click(button("Next page"));
  expect(body.textContent).toContain("2 / 2");
  expect(body.querySelector('canvas[aria-label="Bill.pdf, page 2"]')).not.toBeNull();
  await click(button("Previous page"));
  expect(body.textContent).toContain("1 / 2");
  expect(body.querySelector('a[download="Bill.pdf"]').getAttribute("href")).toBe("blob:receipt-pdf");
  await renderWeb(null);
  expect(destroy).toHaveBeenCalledTimes(1);
});

test("unreadable PDFs render an actionable fallback without a console error", async () => {
  receipts.receiptUrl.mockResolvedValueOnce("blob:bad-pdf");
  getDocument.mockImplementationOnce(() => ({ promise: Promise.reject(new Error("Invalid PDF")), destroy: jest.fn() }));
  const body = await renderWeb(<ReceiptPreview receipt={{ id: "bad", name: "Bad.pdf", mime: "application/pdf", uri: "bad" }} />);
  expect(body.textContent).toContain("This PDF cannot be previewed.");
  expect(body.querySelector('a[download="Bad.pdf"]')).not.toBeNull();
});

test.each([
  ["desktop", { compact: false, desktop: true }],
  ["phone", { compact: true, desktop: false }],
])("%s future calendar opens a schedule and saves edits without changing history", async (_name, responsive) => {
  mockResponsive = responsive;
  ledger.recurring = [ledger.recurring.find((rule) => rule.kind === "expense")];
  const rule = ledger.recurring[0];
  const history = JSON.parse(JSON.stringify(ledger.transactions));
  const body = await renderWeb(<Workspace><OverviewScreen /><RecurringScreen /><EntryDialog /></Workspace>);
  await click(button("Next month"));
  const day = body.querySelector('[aria-label$=" 1, 1 entries"]');
  expect(day).not.toBeNull();
  await click(day);
  expect(body.textContent).toContain("SCHEDULED");
  await click(body.querySelector('[aria-label^="Edit schedule for Rent,"]'));
  expect(body.textContent).toContain("Edit recurring entry");
  expect(body.querySelector('[aria-label="Next occurrence"]').type).toBe("date");
  expect(body.querySelector('[aria-label="Next occurrence"]').value).toBe(rule.nextDate);
  await fill("What was it for?", "Updated rent");
  await fill("Amount (CAD)", "1500.00");
  await fill("Next occurrence", `${rule.nextDate.slice(0, 7)}-15`);
  await click(button("Weekly"));
  await click(button("Save changes"));
  expect(ledger.recurring[0]).toMatchObject({ title: "Updated rent", total: 150000, frequency: "weekly", anchorDay: 15 });
  expect(ledger.transactions).toEqual(history);
  expect(ledger.recurring).toHaveLength(1);
  await click(button("Edit Updated rent schedule"));
  expect(body.querySelector('[aria-label="Amount (CAD)"]').value).toBe("1500.00");
});

test("entry web dates use constrained date inputs and save the selected calendar date", async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const body = await renderWeb(<EntryForm categories={ledger.categories} currency="CAD" onClose={jest.fn()} onSave={save} onDelete={jest.fn()} />);
  const date = body.querySelector('[aria-label="Date"]');
  expect(date.type).toBe("date");
  expect(date.min).toBe("2000-01-01");
  expect(date.max).toBe("2100-12-31");
  await fill("Date", "2028-02-29");
  await fill("Amount (CAD)", "25.00");
  await fill("What was it for?", "Lunch");
  await click(button("Add expense"));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ date: "2028-02-29" }), undefined);
});


test.each([
  ["desktop", { compact: false, desktop: true }],
  ["phone", { compact: true, desktop: false }],
])("%s creates an account inside an entry, preserves the draft, and keeps links after renaming", async (_name, responsive) => {
  mockResponsive = responsive;
  const body = await renderWeb(<Workspace><OverviewScreen /><EntryDialog /></Workspace>);
  await click(body.querySelector('[aria-label^="Edit Weekly groceries,"]'));
  await fill("What was it for?", "Account-linked groceries");
  await click(button("Account: Unassigned"));
  await click(button("Add account"));
  await fill("Account name", "Everyday Visa");
  await click(button("Credit card"));
  await click(button("Save account"));
  expect(body.querySelector('[aria-label="What was it for?"]').value).toBe("Account-linked groceries");
  expect(button("Account: Everyday Visa")).toBeTruthy();
  await click(button("Save changes"));
  const entry = ledger.transactions.find((t) => t.title === "Account-linked groceries");
  expect(entry.accountId).toBe(ledger.accounts[0].id);
  expect(ledger.accounts[0].type).toBe("credit");
  await fill("Search entries", "Everyday Visa");
  expect(body.textContent).toContain("Account-linked groceries");
  await renderWeb(<Workspace><AccountsScreen /></Workspace>);
  await click(button("Edit account Everyday Visa"));
  expect(button("Account is in use").getAttribute("aria-disabled")).toBe("true");
  await fill("Account name", "Travel Visa");
  await click(button("Save account"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(ledger.accounts[0].name).toBe("Travel Visa");
  expect(ledger.transactions.find((t) => t.id === entry.id).accountId).toBe(entry.accountId);
});

test("accounts page validates names, retains failed drafts, and deletes unused accounts", async () => {
  const body = await renderWeb(<Workspace><AccountsScreen /></Workspace>);
  await click(button("Add account"));
  await click(button("Save account"));
  expect(body.textContent).toContain("Give your account a name");
  await fill("Account name", "Wallet");
  await click(button("Cash"));
  AsyncStorage.setItem.mockRejectedValueOnce(new Error("Device storage unavailable"));
  await click(button("Save account"));
  expect(body.textContent).toContain("Device storage unavailable");
  expect(body.querySelector('[aria-label="Account name"]').value).toBe("Wallet");
  await click(button("Save account"));
  await click(button("Edit account Wallet"));
  await click(button("Delete unused account"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(ledger.accounts).toEqual([]);
});
