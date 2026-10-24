import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, Text } from "react-native";
import type { AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { AppLockProvider, useAppLock } from "../../../src/providers/AppLockProvider";
import { AppLockGate } from "../../../src/shell/AppLockGate";
import { Button, Field, Sheet } from "../../../src/shared/ui";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock("expo-local-authentication", () => ({
  SecurityLevel: { BIOMETRIC_STRONG: 3 },
  hasHardwareAsync: jest.fn(), getEnrolledLevelAsync: jest.fn(), authenticateAsync: jest.fn(),
}));

let lifecycle: (state: AppStateStatus) => void;
let stored: string | null;
const initialAppState = AppState.currentState;
function Content() {
  const lock = useAppLock()!;
  const [draft, setDraft] = useState("");
  return <>
    <Text>Private ledger</Text>
    <Text>{lock.enabled ? "Protection on" : "Protection off"}</Text>
    <Button title="Toggle protection" onPress={() => { void lock.setEnabled(!lock.enabled); }} />
    {lock.error !== "" && <Text>{lock.error}</Text>}
    <Sheet visible title="Entry draft" onClose={() => {}}>
      <Field label="Draft" value={draft} onChangeText={setDraft} />
    </Sheet>
  </>;
}
async function openApp() {
  await render(<AppLockProvider><AppLockGate><Content /></AppLockGate></AppLockProvider>);
}
async function changeState(state: AppStateStatus) {
  await act(() => { AppState.currentState = state; lifecycle(state); });
}

beforeEach(() => {
  stored = null;
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    lifecycle = listener;
    return { remove: jest.fn() };
  });
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async () => stored);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (_key, value) => { stored = value; });
  jest.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(true);
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(3);
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true });
});
afterEach(() => { AppState.currentState = initialAppState; jest.restoreAllMocks(); });

test("a protected launch hides private content after cancellation and opens only on a successful retry", async () => {
  stored = "true";
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValueOnce({ success: false, error: "user_cancel" });
  await openApp();
  expect(screen.getByText("Penny is locked")).toBeOnTheScreen();
  expect(screen.queryByText("Private ledger")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Unlock Penny" }));
  expect(screen.getByText("Private ledger")).toBeOnTheScreen();
  expect(screen.getByText("Protection on")).toBeOnTheScreen();
});

test("enabling and disabling require authentication and the preference survives a new launch", async () => {
  await openApp();
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValueOnce({ success: false, error: "user_cancel" });
  await fireEvent.press(screen.getByRole("button", { name: "Toggle protection" }));
  expect(screen.getByText("Protection off")).toBeOnTheScreen();
  expect(stored).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Toggle protection" }));
  expect(screen.getByText("Protection on")).toBeOnTheScreen();
  expect(stored).toBe("true");
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValueOnce({ success: false, error: "user_cancel" });
  await fireEvent.press(screen.getByRole("button", { name: "Toggle protection" }));
  expect(screen.getByText("Protection on")).toBeOnTheScreen();
  expect(stored).toBe("true");
  await screen.unmount();
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValueOnce({ success: false, error: "user_cancel" });
  await openApp();
  expect(screen.queryByText("Private ledger")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Unlock Penny" }));
  await fireEvent.press(screen.getByRole("button", { name: "Toggle protection" }));
  expect(stored).toBe("false");
  expect(screen.getByText("Protection off")).toBeOnTheScreen();
});

test("backgrounding conceals open sheets and failed unlocks preserve the entry draft", async () => {
  stored = "true";
  await openApp();
  await fireEvent.changeText(screen.getByLabelText("Draft"), "Unfinished expense");
  await changeState("inactive");
  expect(screen.queryByLabelText("Draft")).toBeNull();
  expect(screen.queryByText("Private ledger")).toBeNull();
  await changeState("active");
  expect(screen.getByLabelText("Draft")).toHaveDisplayValue("Unfinished expense");
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValueOnce({ success: false, error: "authentication_failed" });
  await changeState("background");
  await changeState("active");
  expect(screen.queryByLabelText("Draft")).toBeNull();
  expect(screen.queryByText("Private ledger")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Unlock Penny" }));
  expect(screen.getByLabelText("Draft")).toHaveDisplayValue("Unfinished expense");
});

test("a biometric dialog's inactive transition neither relocks nor starts another authentication", async () => {
  stored = "true";
  const { promise, resolve: finish } = Promise.withResolvers<LocalAuthentication.LocalAuthenticationResult>();
  jest.mocked(LocalAuthentication.authenticateAsync).mockReturnValueOnce(promise);
  await openApp();
  await changeState("inactive");
  await act(() => finish({ success: true }));
  expect(screen.queryByText("Private ledger")).toBeNull();
  await changeState("active");
  expect(screen.getByText("Private ledger")).toBeOnTheScreen();
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
});

test("an authentication result from before backgrounding cannot unlock a later session", async () => {
  stored = "true";
  const { promise, resolve: finish } = Promise.withResolvers<LocalAuthentication.LocalAuthenticationResult>();
  jest.mocked(LocalAuthentication.authenticateAsync).mockReturnValueOnce(promise);
  await openApp();
  await changeState("background");
  await changeState("active");
  await act(() => finish({ success: true }));
  expect(screen.queryByText("Private ledger")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Unlock Penny" }));
  expect(screen.getByText("Private ledger")).toBeOnTheScreen();
});

test("missing strong enrollment cannot enable protection", async () => {
  await openApp();
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValueOnce(2);
  await fireEvent.press(screen.getByRole("button", { name: "Toggle protection" }));
  expect(screen.getByText(/Set up Face ID or strong/)).toBeOnTheScreen();
  expect(screen.getByText("Protection off")).toBeOnTheScreen();
  expect(stored).toBeNull();
});

test("read failures fail closed and write failures retain the previous protection setting", async () => {
  stored = "true";
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("Keychain unavailable"));
  await openApp();
  expect(screen.queryByText("Private ledger")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByText("Protection on")).toBeOnTheScreen();
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("Keychain unavailable"));
  await fireEvent.press(screen.getByRole("button", { name: "Toggle protection" }));
  expect(screen.getByText("Protection on")).toBeOnTheScreen();
  expect(stored).toBe("true");
  expect(screen.getByText(/Could not save app protection/)).toBeOnTheScreen();
});

test("backgrounding during a preference write cannot leave newly enabled protection unlocked", async () => {
  await openApp();
  const { promise, resolve } = Promise.withResolvers<void>();
  jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (_key, value) => {
    await promise;
    stored = value;
  });
  await fireEvent.press(screen.getByRole("button", { name: "Toggle protection" }));
  await changeState("background");
  await changeState("active");
  await act(() => resolve());
  expect(stored).toBe("true");
  expect(screen.queryByText("Private ledger")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Unlock Penny" }));
  expect(screen.getByText("Private ledger")).toBeOnTheScreen();
});

test("backgrounding before protection is enabled does not cause redundant prompts later", async () => {
  await openApp();
  await changeState("background");
  await changeState("active");
  await fireEvent.press(screen.getByRole("button", { name: "Toggle protection" }));
  await changeState("inactive");
  await changeState("active");
  expect(screen.getByText("Protection on")).toBeOnTheScreen();
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
});
