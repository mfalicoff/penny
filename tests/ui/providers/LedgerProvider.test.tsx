import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "../../../src/data/api";
import { changeCurrency } from "../../../src/domain/commands";
import { emptyLedger } from "../../../src/domain/ledger";
import { rememberAccount, writeLocalLedger } from "../../../src/data/offlineLedger";
import { LedgerProvider, useLedger } from "../../../src/providers/LedgerProvider";

jest.mock("../../../src/data/api", () => ({
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
  whoAmI: jest.fn(), fetchLedger: jest.fn(), saveSnapshot: jest.fn(), mutateLedger: jest.fn(), signOut: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const initialAppState = AppState.currentState;

beforeEach(() => {
  void AsyncStorage.clear();
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

test("offline saves remain visible and durable, then merge into the server ledger", async () => {
  jest.mocked(api.whoAmI).mockResolvedValue("test@example.com");
  const { result, unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  jest.mocked(api.fetchLedger).mockRejectedValueOnce(new api.ApiError("Offline", 0));
  await act(async () => {
    await result.current.commit(changeCurrency("USD"), "Currency updated");
  });
  expect(result.current.ledger.currency).toBe("USD");
  expect(result.current.pending).toBe(true);
  expect(result.current.toast).toBe("Currency updated");
  const stored = await AsyncStorage.getItem("penny:ledger:test@example.com");
  expect(JSON.parse(stored!).local.currency).toBe("USD");
  jest.mocked(api.saveSnapshot).mockImplementation(async (snapshot) => ({ ...snapshot, revision: snapshot.revision + 1 }));
  await act(async () => { jest.advanceTimersByTime(0); });
  await act(async () => { await result.current.sync(); });
  expect(api.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ ledger: expect.objectContaining({ currency: "USD" }) }));
  expect(result.current.pending).toBe(false);
  await unmount();
});

test("a pending ledger reopens offline after the provider remounts", async () => {
  const base = emptyLedger();
  await rememberAccount("test@example.com");
  await writeLocalLedger("test@example.com", { base, local: { ...base, currency: "USD" } });
  jest.mocked(api.whoAmI).mockRejectedValue(new api.ApiError("Offline", 0));
  jest.mocked(api.fetchLedger).mockRejectedValue(new api.ApiError("Offline", 0));
  const { result, unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  expect(result.current.checking).toBe(false);
  expect(result.current.email).toBe("test@example.com");
  expect(result.current.ledger.currency).toBe("USD");
  expect(result.current.pending).toBe(true);
  await unmount();
});

test("multiple edits remain available when the server is down and sign-out protects them", async () => {
  jest.mocked(api.whoAmI).mockResolvedValue("test@example.com");
  const { result, unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  jest.mocked(api.fetchLedger).mockRejectedValue(new api.ApiError("Server unavailable", 0));
  await act(async () => { await result.current.sync(); });
  await act(async () => { await result.current.commit(changeCurrency("USD"), "Currency updated"); });
  await act(async () => { await result.current.commit((ledger) => ({ ...ledger, accounts: [{ id: "cash", name: "Cash", type: "cash" }] }), "Account added"); });
  expect(result.current.ledger.currency).toBe("USD");
  expect(result.current.ledger.accounts).toHaveLength(1);
  expect(result.current.pending).toBe(true);
  await act(async () => { expect(await result.current.logout()).toBe(false); });
  expect(api.signOut).not.toHaveBeenCalled();
  await unmount();
});

test("a storage failure does not claim a local save succeeded", async () => {
  jest.mocked(api.whoAmI).mockResolvedValue("test@example.com");
  const { result, unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("Storage full"));
  await act(async () => {
    await expect(result.current.commit(changeCurrency("USD"), "Currency updated")).rejects.toThrow("Storage full");
  });
  expect(result.current.ledger.currency).toBe("CAD");
  expect(result.current.pending).toBe(false);
  await unmount();
});

test("entry feedback is attached only to a successful typed commit", async () => {
  const { result, unmount } = await renderHook(useLedger, { wrapper: LedgerProvider });
  await act(() => result.current.openDemo());
  await act(async () => {
    await result.current.commit((ledger) => ledger, "Expense added", "expense");
  });
  expect(result.current.toastKind).toBe("expense");
  expect(result.current.toastSequence).toBe(1);
  await act(async () => {
    await expect(result.current.commit(() => { throw new Error("Offline"); }, "Income added", "income")).rejects.toThrow("Offline");
  });
  expect(result.current.toastKind).toBe("expense");
  expect(result.current.toastSequence).toBe(1);
  await act(async () => {
    await result.current.commit((ledger) => ledger, "Changes saved");
  });
  expect(result.current.toastKind).toBeNull();
  expect(result.current.toastSequence).toBe(2);
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
