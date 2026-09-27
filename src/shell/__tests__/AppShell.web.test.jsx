import { beforeEach, expect, jest, test } from "@jest/globals";
import { renderWeb } from "../../../tests/web-renderer";
import { AppShell } from "../AppShell";

jest.mock("expo-router", () => ({ Slot: () => null, router: { navigate: jest.fn() }, usePathname: () => "/" }));
jest.mock("../../providers/LedgerProvider", () => ({ useLedger: () => mockSession }));
jest.mock("../../providers/WorkspaceProvider", () => ({ useWorkspace: () => ({ setForm: jest.fn() }) }));
jest.mock("../../shared/useResponsive", () => ({ useResponsive: () => mockResponsive }));
jest.mock("../../features/entries/EntryDialog", () => ({ EntryDialog: () => null }));
jest.mock("../../features/settings/SettingsSheet", () => ({ SettingsSheet: () => null }));

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
  expect(document.body.textContent).toContain("Synced with your server");
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
