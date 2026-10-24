import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { emptyLedger } from "../../../src/domain/ledger";
import { api } from "../../../src/data/api";
import { readActiveAccount, readLocalLedger, rememberAccount, writeLocalLedger } from "../../../src/data/offlineLedger";
import { getToken, setToken } from "../../../src/data/session";
import { defaultServerUrl, getServerUrl, normalizeServerUrl, probePennyServer, readServerConfiguration, saveServerConfiguration, serverStorageKey } from "../../../src/data/serverConnection";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
beforeEach(async () => { await AsyncStorage.clear(); });
afterEach(() => jest.restoreAllMocks());

test("migration retains the embedded address, original session key, active account and unsynced ledger without probing", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch");
  const ledger = emptyLedger();
  const local = { base: ledger, local: { ...ledger, currency: "USD" } };
  await AsyncStorage.setItem("penny:active-account", "person@example.test");
  await AsyncStorage.setItem("penny:ledger:person@example.test", JSON.stringify(local));
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue("existing-session");
  const expected = normalizeServerUrl(defaultServerUrl);
  expect(await readServerConfiguration()).toEqual({ url: expected, legacyUrl: expected });
  expect(await getToken()).toBe("existing-session");
  expect(SecureStore.getItemAsync).toHaveBeenCalledWith("penny-session");
  expect(await readActiveAccount()).toBe("person@example.test");
  expect(await readLocalLedger("person@example.test")).toEqual(local);
  expect(fetchMock).not.toHaveBeenCalled();
  const original = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = "https://different-build.test";
  try { expect(await getServerUrl()).toBe(expected); }
  finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = original;
  }
});

test("switching persists the selection and isolates same-email ledgers and secure session keys", async () => {
  const original = await getServerUrl();
  const email = "person@example.test";
  const ledger = emptyLedger();
  await rememberAccount(email);
  await writeLocalLedger(email, { base: ledger, local: ledger });
  await saveServerConfiguration({ url: "https://other.test/", version: "2.3.4" });
  expect(await readServerConfiguration()).toEqual({ url: "https://other.test", legacyUrl: original, version: "2.3.4" });
  expect(await readActiveAccount()).toBeNull();
  expect(await readLocalLedger(email)).toBeNull();
  await setToken("new-session");
  const tokenKey = await serverStorageKey("penny-session");
  expect(tokenKey).not.toBe("penny-session");
  expect(tokenKey).toMatch(/^[\w.-]+$/);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(tokenKey, "new-session");
  await writeLocalLedger(email, { base: ledger, local: { ...ledger, currency: "EUR" } });
  await saveServerConfiguration({ url: original, version: "1.0.0" });
  expect((await readLocalLedger(email))?.local.currency).toBe("CAD");
  expect(await serverStorageKey("penny-session")).toBe("penny-session");
});

test("credential reads remain bound to a request's captured server during a switch", async () => {
  const original = await readServerConfiguration();
  await saveServerConfiguration({ url: "https://new.test", version: "1.0" });
  await getToken(original);
  expect(SecureStore.getItemAsync).toHaveBeenLastCalledWith("penny-session");
  await getToken();
  expect(SecureStore.getItemAsync).toHaveBeenLastCalledWith(await serverStorageKey("penny-session"));
});

test("API requests use the saved server rather than the build-time default", async () => {
  await saveServerConfiguration({ url: "https://self-hosted.test/penny", version: "1.2.3" });
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(response({}));
  await api("/ledger");
  expect(fetchMock).toHaveBeenCalledWith("https://self-hosted.test/penny/api/ledger", expect.any(Object));
});

test.each(["", "not a url", "ftp://penny.test", "https://user:secret@penny.test", "https://penny.test?x=1", "https://penny.test/#fragment"])("rejects invalid or unsafe URL %s before sending a request", async (url) => {
  const fetchMock = jest.spyOn(globalThis, "fetch");
  await expect(probePennyServer(url)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("probing normalizes URLs, identifies Penny and reports its version without credentials or changing the selection", async () => {
  const original = await getServerUrl();
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(response({ name: "penny", version: "1.2.3" }));
  expect(await probePennyServer("  https://PENNY.test:443/base///  ")).toEqual({ url: "https://penny.test/base", version: "1.2.3" });
  expect(fetchMock).toHaveBeenCalledWith("https://penny.test/base/api/info", expect.objectContaining({ credentials: "omit", redirect: "error", headers: { Accept: "application/json" }, signal: expect.anything() }));
  expect(await getServerUrl()).toBe(original);
});

test.each([{ ok: true }, { name: "other", version: "1.0" }, { name: "penny" }, { name: "penny", version: "" }, { name: "penny", version: 123 }])("rejects non-Penny or incomplete identity responses %j", async (body) => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue(response(body));
  await expect(probePennyServer("https://not-penny.test")).rejects.toThrow("did not identify itself");
});

test("network, HTTP and malformed JSON failures leave the current server unchanged", async () => {
  const original = await getServerUrl();
  jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Timed out"))
    .mockResolvedValueOnce(response({ name: "penny", version: "1.0" }, 503))
    .mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("HTML"); } } as unknown as Response);
  await expect(probePennyServer("https://bad.test")).rejects.toThrow("Cannot reach");
  await expect(probePennyServer("https://bad.test")).rejects.toThrow("did not identify itself");
  await expect(probePennyServer("https://bad.test")).rejects.toThrow("did not identify itself");
  expect(await getServerUrl()).toBe(original);
});
