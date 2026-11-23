import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearVerifyCode, keepVerifyCode, peekVerifyCode } from "../src/auth/fragmentCodes";
import { ALEX, bodyOf, callsTo, json, renderApp, stubServer } from "./render";

// Email verification on the web (MAZ-172): "Check your email" after sign-up, the emailed link's
// landing page, Change email, and the Verified mark in Settings › Profile. Synthetic data only.

const CODE = "7d2c4e6f80b1d3a5c7e9f23f9a1c07e2b45d68a0c1f7e93b2d4a6c8e05f1b7d3";
const USER_ID = "u".repeat(32);
const NEW_ADDRESS = "alex.new@example.test";

const profile = (overrides: Record<string, unknown> = {}) => ({
  userId: USER_ID,
  email: ALEX,
  nameEditable: true,
  avatarEditable: true,
  needsName: false,
  signIn: "password",
  emailVerified: false,
  ...overrides,
});

/** A signed-in server; `emailEnabled` as /api/info says, and `extra` answers first. */
function signedIn(emailEnabled: boolean, extra?: (url: string, init: RequestInit | undefined) => Response | undefined) {
  return stubServer((url, init) => {
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url === "/api/info") return json({ name: "penny", version: "2.0.0-test", emailEnabled });
    if (url === "/api/profile") return json(profile());
    return undefined;
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearVerifyCode();
});

describe("the emailed link", () => {
  it("keeps only a well-formed code from the fragment", () => {
    keepVerifyCode("not a code");
    expect(peekVerifyCode()).toBeNull();
    keepVerifyCode(CODE.toUpperCase());
    expect(peekVerifyCode()).toBe(CODE);
  });

  it("verifies once, signed out too, and drops the code from the address bar", async () => {
    const fetchMock = stubServer((url) => {
      if (url === "/api/auth/me") return json({ error: "Please sign in to continue." }, 401);
      if (url === "/api/auth/email-verification") return json({ email: ALEX });
      return undefined;
    });
    const { router } = renderApp(`/verify-email#code=${CODE}`);
    await screen.findByRole("heading", { level: 1, name: "Your email is verified" });
    expect(screen.getByText(ALEX)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Penny" })).toHaveAttribute("href", "/");
    expect(router.state.location.hash).toBe("");
    const calls = callsTo(fetchMock, "/api/auth/email-verification");
    expect(calls).toHaveLength(1);
    expect(bodyOf(calls[0])).toEqual({ token: CODE });
    expect(peekVerifyCode()).toBeNull();
  });

  it("says when the link is invalid or expired, and sends a new one to a signed-in unverified account", async () => {
    const fetchMock = signedIn(true, (url) => {
      if (url === "/api/auth/email-verification") return json({ error: "This verification link is invalid or has expired." }, 400);
      if (url === "/api/auth/email-verification/resend") return json({ ok: true }, 202);
      return undefined;
    });
    renderApp(`/verify-email#code=${CODE}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/);
    await userEvent.click(await screen.findByRole("button", { name: "Send a new link" }));
    await screen.findByRole("heading", { level: 1, name: "Check your email" });
    expect(callsTo(fetchMock, "/api/auth/email-verification/resend")).toHaveLength(1);
  });
});

describe("Check your email", () => {
  it("names the address, counts down a minute before Resend and goes on to Penny", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = signedIn(true, (url) => (url === "/api/auth/email-verification/resend" ? json({ ok: true }, 202) : undefined));
    renderApp("/verify-email");
    await screen.findByRole("heading", { level: 1, name: "Check your email" });
    expect(screen.getByText(ALEX)).toBeInTheDocument();
    expect(screen.getByText(/You can use Penny right away/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to Penny" })).toHaveAttribute("href", "/");
    expect(screen.getByText(/Resend in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend" })).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(61_000);
    await userEvent.click(await screen.findByRole("button", { name: "Resend" }));
    await waitFor(() => {
      expect(callsTo(fetchMock, "/api/auth/email-verification/resend")).toHaveLength(1);
    });
    expect(await screen.findByText(/Resend in/)).toBeInTheDocument();
  });

  it("changes the email with the password and waits on the new address", async () => {
    let current = profile();
    const fetchMock = signedIn(true, (url, init) => {
      if (url === "/api/profile") return json(current);
      if (url === "/api/auth/me") return json({ email: current.email });
      if (url === "/api/auth/email") {
        const body = bodyOf(init) as { email: string; password: string };
        if (body.password !== "the password") return json({ error: "Your current password is incorrect." }, 400);
        current = profile({ email: body.email });
        return json(current);
      }
      return undefined;
    });
    renderApp("/verify-email");
    await userEvent.click(await screen.findByRole("button", { name: "Change email" }));
    await screen.findByRole("heading", { level: 1, name: "Change your email" });
    const email = screen.getByLabelText("Email");
    await userEvent.clear(email);
    await userEvent.type(email, NEW_ADDRESS);
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByText("Your current password is incorrect.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Password"), "the password");
    await userEvent.click(screen.getByRole("button", { name: "Send link" }));
    await screen.findByRole("heading", { level: 1, name: "Check your email" });
    expect(await screen.findByText(NEW_ADDRESS)).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, "/api/auth/email").at(-1))).toEqual({ email: NEW_ADDRESS, password: "the password" });
  });

  it("goes on to Penny when there is nothing to verify", async () => {
    signedIn(true, (url) => (url === "/api/profile" ? json(profile({ emailVerified: true })) : undefined));
    const { router } = renderApp("/verify-email");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("goes on to Penny while the server sends no email", async () => {
    signedIn(false);
    const { router } = renderApp("/verify-email");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });
});

describe("Settings › Profile", () => {
  it("marks a verified email", async () => {
    signedIn(true, (url) => (url === "/api/profile" ? json(profile({ emailVerified: true, emailVerifiedAt: 1 })) : undefined));
    renderApp("/settings/profile");
    expect(await screen.findByText("Verified")).toBeInTheDocument();
    expect(screen.queryByText("Not verified")).not.toBeInTheDocument();
  });

  it("offers Resend link for an unverified email while the server sends email", async () => {
    const fetchMock = signedIn(true, (url) => (url === "/api/auth/email-verification/resend" ? json({ ok: true }, 202) : undefined));
    renderApp("/settings/profile");
    expect(await screen.findByText("Not verified")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resend link" }));
    await waitFor(() => {
      expect(callsTo(fetchMock, "/api/auth/email-verification/resend")).toHaveLength(1);
    });
    expect(await screen.findByText("Link sent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend link" })).not.toBeInTheDocument();
  });

  it("shows no unverified state while the server sends no email", async () => {
    signedIn(false);
    renderApp("/settings/profile");
    await screen.findByLabelText("Name");
    expect(screen.queryByText("Not verified")).not.toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend link" })).not.toBeInTheDocument();
  });
});

describe("creating an account", () => {
  it("opens Check your email when the server sends email", async () => {
    let registered = false;
    stubServer((url) => {
      if (url === "/api/info") return json({ name: "penny", version: "2.0.0-test", emailEnabled: true });
      if (url === "/api/auth/me") return registered ? json({ email: ALEX }) : json({ error: "Please sign in to continue." }, 401);
      if (url === "/api/auth/register") {
        registered = true;
        return json({ token: "t".repeat(64), email: ALEX }, 201);
      }
      if (url === "/api/profile") return json(profile());
      return undefined;
    });
    const { router } = renderApp("/");
    await userEvent.click(await screen.findByRole("button", { name: "Create an account" }));
    await userEvent.type(await screen.findByLabelText("Name"), "Alex");
    await userEvent.type(await screen.findByLabelText("Email"), ALEX);
    await userEvent.type(screen.getByLabelText("Password"), "a long enough password");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByRole("heading", { level: 1, name: "Check your email" });
    expect(router.state.location.pathname).toBe("/verify-email");
  });
});
