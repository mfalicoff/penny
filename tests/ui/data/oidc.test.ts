import * as WebBrowser from "expo-web-browser";
import { api } from "../../../src/data/api";
import { setToken } from "../../../src/data/session";
import { signInOidc } from "../../../src/data/oidc";

jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn(), maybeCompleteAuthSession: jest.fn(), WebBrowserResultType: { CANCEL: "cancel" } }));
jest.mock("../../../src/data/api", () => ({ api: jest.fn() }));
jest.mock("../../../src/data/session", () => ({ setToken: jest.fn() }));
const attempt = { transaction: "private-secret", authorizationUrl: "https://id.test/authorize", expiresAt: Date.now() + 600000 };

test("opens the browser synchronously and exchanges the callback before storing a Penny session", async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: "success", url: "penny://auth/callback?code=abc&state=def" });
  jest.mocked(api).mockResolvedValue({ json: async () => ({ token: "penny-session", email: "person@example.test" }) } as Response);
  const promise = signInOidc(attempt);
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(attempt.authorizationUrl, "penny://auth/callback");
  expect(await promise).toBe("person@example.test");
  expect(api).toHaveBeenCalledWith("/auth/oidc/complete", {
    method: "POST", body: JSON.stringify({ transaction: attempt.transaction, callbackUrl: "penny://auth/callback?code=abc&state=def" }),
  });
  expect(setToken).toHaveBeenCalledWith("penny-session");
});

test("cancellation and expired attempts never create a session", async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: WebBrowser.WebBrowserResultType.CANCEL });
  expect(await signInOidc(attempt)).toBeNull();
  await expect(signInOidc({ ...attempt, expiresAt: 1 })).rejects.toThrow("Sign-in expired");
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
  expect(api).not.toHaveBeenCalled();
  expect(setToken).not.toHaveBeenCalled();
});
