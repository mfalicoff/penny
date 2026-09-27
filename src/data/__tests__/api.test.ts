import { emptyLedger } from "../../domain/ledger";
import { api, mutateLedger, signOut } from "../api";
import { clearToken } from "../session";

jest.mock("../session", () => ({ getToken: jest.fn().mockResolvedValue("test-token"), setToken: jest.fn(), clearToken: jest.fn() }));

const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
let fetchMock: jest.SpyInstance;
beforeEach(() => { fetchMock = jest.spyOn(globalThis, "fetch"); });
afterEach(() => jest.restoreAllMocks());

test("revision conflicts reapply the operation to the newest ledger", async () => {
  const first = emptyLedger();
  const latest = { ...emptyLedger(), currency: "USD" };
  fetchMock.mockResolvedValueOnce(response({ revision: 1, ledger: first }))
    .mockResolvedValueOnce(response({ error: "Conflict" }, 409))
    .mockResolvedValueOnce(response({ revision: 2, ledger: latest }))
    .mockResolvedValueOnce(response({ revision: 3, ledger: latest }));
  const change = jest.fn((ledger) => ledger);
  await mutateLedger(change);
  expect(change).toHaveBeenCalledTimes(2);
  const requests = fetchMock.mock.calls;
  expect(JSON.parse(requests[3][1].body)).toMatchObject({ revision: 2, ledger: { currency: "USD" } });
});

test("revision retries are bounded and other server errors are not retried", async () => {
  fetchMock.mockImplementation(async (_url, options) => options.method === "PUT"
    ? response({ error: "Conflict" }, 409)
    : response({ revision: 1, ledger: emptyLedger() }));
  await expect(mutateLedger((ledger) => ledger)).rejects.toMatchObject({ status: 409 });
  expect(fetchMock).toHaveBeenCalledTimes(8);
  fetchMock.mockReset().mockResolvedValueOnce(response({ revision: 1, ledger: emptyLedger() }))
    .mockResolvedValueOnce(response({ error: "Server failed" }, 500));
  await expect(mutateLedger((ledger) => ledger)).rejects.toMatchObject({ status: 500 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("requests include native auth and cookies, and network failure is actionable", async () => {
  fetchMock.mockResolvedValueOnce(response({}));
  await api("/ledger");
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/ledger"), expect.objectContaining({ credentials: "include", headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
  fetchMock.mockRejectedValueOnce(new Error("Network down"));
  await expect(api("/ledger")).rejects.toMatchObject({ status: 0, message: "Cannot reach your server. Check your connection and try again." });
});

test("logout keeps the token on server failure but clears an already expired session", async () => {
  fetchMock.mockResolvedValueOnce(response({ error: "Unavailable" }, 503));
  await expect(signOut()).rejects.toMatchObject({ status: 503 });
  expect(clearToken).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(response({ error: "Expired" }, 401));
  await signOut();
  expect(clearToken).toHaveBeenCalledTimes(1);
});
