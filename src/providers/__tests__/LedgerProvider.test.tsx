import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import * as api from "../../data/api";
import { changeCurrency } from "../../domain/commands";
import { emptyLedger } from "../../domain/ledger";
import { LedgerProvider, useLedger } from "../LedgerProvider";

jest.mock("../../data/api", () => ({
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
  whoAmI: jest.fn(), fetchLedger: jest.fn(), mutateLedger: jest.fn(), signOut: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const initialAppState = AppState.currentState;

beforeEach(() => {
  AppState.currentState = "active";
  jest.useFakeTimers();
  jest.mocked(api.whoAmI).mockRejectedValue(new api.ApiError("Not signed in", 401));
  jest.mocked(api.fetchLedger).mockResolvedValue({ revision: 1, ledger: emptyLedger() });
  jest.mocked(api.signOut).mockResolvedValue(undefined);
});
afterEach(() => { AppState.currentState = initialAppState; jest.useRealTimers(); jest.restoreAllMocks(); });

test("demo changes stay local and leaving clears account state", async () => {
  const { result, unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  await act(() => result.current.openDemo());
  const count = result.current.ledger.transactions.length;
  await act(async () => {
    await result.current.commit((ledger) => ({ ...ledger, transactions: [] }), "Entries cleared");
  });
  expect(count).toBeGreaterThan(0);
  expect(result.current.ledger.transactions).toHaveLength(0);
  expect(api.mutateLedger).not.toHaveBeenCalled();
  await act(() => result.current.leaveDemo());
  expect(result.current.demo).toBe(false);
  expect(result.current.ledger).toEqual(emptyLedger());
  expect(result.current.toast).toBe("");
  await unmount();
});

test("failed saves preserve the displayed ledger, report errors, and permit retry", async () => {
  jest.mocked(api.whoAmI).mockResolvedValue("test@example.com");
  const { result, unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  const original = result.current.ledger;
  jest.mocked(api.mutateLedger).mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    await expect(result.current.commit(changeCurrency("USD"), "Currency updated")).rejects.toThrow("Offline");
  });
  expect(result.current.ledger).toBe(original);
  expect(result.current.syncError).toBe("Offline");
  expect(result.current.syncing).toBe(false);
  jest.mocked(api.mutateLedger).mockResolvedValueOnce({ revision: 2, ledger: { ...emptyLedger(), currency: "USD" } });
  await act(async () => { await result.current.commit(changeCurrency("USD"), "Currency updated"); });
  expect(result.current.ledger.currency).toBe("USD");
  expect(result.current.syncError).toBe("");
  expect(result.current.toast).toBe("Currency updated");
  await unmount();
});

test("in-flight sync blocks overlapping saves and stale responses cannot replace a new session", async () => {
  jest.mocked(api.whoAmI).mockResolvedValue("test@example.com");
  const pending = deferred<api.Snapshot>();
  jest.mocked(api.fetchLedger).mockReturnValueOnce(pending.promise);
  const { result, unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  await expect(result.current.commit(changeCurrency("USD"), "Updated")).rejects.toThrow("Sync is finishing");
  await act(() => result.current.openDemo());
  const demo = result.current.ledger;
  await act(async () => { pending.resolve({ revision: 1, ledger: { ...emptyLedger(), currency: "GBP" } }); });
  expect(result.current.ledger).toBe(demo);
  expect(result.current.demo).toBe(true);
  await unmount();
});

test("a late startup response does not replace a session established in the meantime", async () => {
  const pending = deferred<string>();
  jest.mocked(api.whoAmI).mockReturnValueOnce(pending.promise);
  const { result, unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  await act(() => result.current.openDemo());
  await act(async () => { pending.resolve("old@example.com"); });
  expect(result.current.email).toBeNull();
  expect(result.current.demo).toBe(true);
  await unmount();
});

test("foreground and interval sync subscriptions are cleaned up on unmount", async () => {
  const remove = jest.fn();
  const listener = jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove });
  jest.mocked(api.whoAmI).mockResolvedValue("test@example.com");
  const { unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  expect(api.fetchLedger).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(api.fetchLedger).toHaveBeenCalledTimes(2);
  const onChange = listener.mock.calls[0][1];
  await act(async () => { onChange("active"); });
  expect(api.fetchLedger).toHaveBeenCalledTimes(3);
  await unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(api.fetchLedger).toHaveBeenCalledTimes(3);
});
