import { beforeEach, expect, jest, test } from "@jest/globals";
import { renderWeb } from "../support/web-renderer";
import { AppShell } from "../../../src/shell/AppShell";

jest.mock("expo-router", () => ({ Slot: () => null, router: { navigate: jest.fn() }, usePathname: () => "/" }));
jest.mock("../../../src/providers/LedgerProvider", () => ({ useLedger: () => mockSession }));
jest.mock("../../../src/providers/WorkspaceProvider", () => ({ useWorkspace: () => ({ setForm: jest.fn() }) }));
jest.mock("../../../src/shared/useResponsive", () => ({ useResponsive: () => mockResponsive }));
jest.mock("../../../src/features/entries/EntryDialog", () => ({ EntryDialog: () => null }));
jest.mock("../../../src/features/settings/SettingsSheet", () => ({ SettingsSheet: () => null }));

let mockSession;
let mockResponsive;
beforeEach(() => {
  mockSession = {
    email: "test@example.com", demo: false, syncing: false,
    syncError: "", toast: "", sync: jest.fn(), leaveDemo: jest.fn(),
  };
});

test.each([
  ["desktop", { compact: false, desktop: true }],
  ["phone", { compact: true, desktop: false }],
])("%s renders empty, populated and cleared messages without raw text warnings", async (_name, responsive) => {
  mockResponsive = responsive;
  await renderWeb(<AppShell />);
  if (_name === "desktop") expect(document.body.textContent).toContain("Synced with your server");
  else expect(document.body.textContent).not.toContain("Synced with your server");
  expect(document.body.querySelector('[role="alert"]')).toBeNull();

  mockSession = { ...mockSession, syncError: "Cannot reach your server.", toast: "Entry saved" };
  await renderWeb(<AppShell />);
  expect(document.body.textContent).toContain("Cannot reach your server.");
  expect(document.body.querySelector('[role="alert"]').textContent).toBe("Entry saved");

  mockSession = { ...mockSession, syncError: "", toast: "" };
  await renderWeb(<AppShell />);
  expect(document.body.textContent).not.toContain("Cannot reach your server.");
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
});

test("new expense and income toasts use distinct feedback colors", async () => {
  mockResponsive = { compact: true, desktop: false };
  mockSession = { ...mockSession, toast: "Expense added", toastKind: "expense", toastSequence: 1 };
  await renderWeb(<AppShell />);
  const expenseColor = document.body.querySelector('[role="alert"]').style.backgroundColor;
  mockSession = { ...mockSession, toast: "Income added", toastKind: "income", toastSequence: 2 };
  await renderWeb(<AppShell />);
  const incomeColor = document.body.querySelector('[role="alert"]').style.backgroundColor;
  expect(expenseColor).toBe("rgb(251, 233, 230)");
  expect(incomeColor).toBe("rgb(232, 244, 234)");
});
