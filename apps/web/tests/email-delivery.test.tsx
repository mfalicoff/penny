import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serverInfoSchema } from "../src/api/info";
import { clearJoinCode, clearResetCode, peekJoinCode } from "../src/auth/fragmentCodes";
import { inviteDetail, sentLabel } from "../src/features/households/InviteEmailDialog";
import { createHouseholdServer, type HouseholdServer } from "./fakes/householdServer";
import { ALEX, bodyOf, callsTo, json, renderApp, stubServer } from "./render";

// Optional email delivery on the web (MAZ-124): password reset by email, the emailed reset and
// invitation links, and invitations by email. All addresses and codes are synthetic.

const CODE = "3f9a1c07e2b45d68a0c1f7e93b2d4a6c8e05f1b7d39a2c4e6f80b1d3a5c7e9f2";
const PASSWORD = "correct horse battery";

/** A signed-out server; `emailEnabled` as /api/info says, and `extra` answers first. */
function signedOut(emailEnabled: boolean | undefined, extra?: (url: string, init: RequestInit | undefined) => Response | undefined) {
  return stubServer((url, init) => {
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url === "/api/info") return json({ name: "penny", version: "2.0.0-test", ...(emailEnabled === undefined ? {} : { emailEnabled }) });
    if (url === "/api/auth/me") return json({ error: "Please sign in to continue." }, 401);
    return undefined;
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearJoinCode();
  clearResetCode();
});

describe("server info", () => {
  it("reads emailEnabled, and treats it as off when absent or malformed", () => {
    const parse = (extra: object) => serverInfoSchema.parse({ name: "penny", version: "2", ...extra }).emailEnabled;
    expect(parse({ emailEnabled: true })).toBe(true);
    expect(parse({ emailEnabled: false })).toBe(false);
    expect(parse({})).toBeUndefined();
    expect(parse({ emailEnabled: "yes" })).toBe(false);
  });
});

describe("Forgot password on sign-in", () => {
  it("asks for a reset link when the server sends email", async () => {
    signedOut(true);
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: /Welcome back/ });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
    });
  });

  it("shows no Forgot password when the server sends no email, including older servers", async () => {
    signedOut(undefined);
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: /Welcome back/ });
    expect(screen.queryByRole("link", { name: "Forgot password?" })).not.toBeInTheDocument();
  });
});

describe("/forgot-password", () => {
  it("sends the link, says so without revealing the account, and offers Resend after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-23T14:00:00Z"));
    const fetchMock = signedOut(true, (url) => (url === "/api/auth/password-reset/request" ? json({ ok: true }, 202) : undefined));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    renderApp("/forgot-password");
    await screen.findByRole("heading", { level: 1, name: "Reset your password" });
    expect(screen.getByRole("link", { name: "Enter it" })).toHaveAttribute("href", "/reset-password");

    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/auth/password-reset/request")).toHaveLength(0);

    await user.type(screen.getByLabelText("Email"), "max@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByText(/If max@example.com has a Penny account on this server, a reset link is on its way/)).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, "/api/auth/password-reset/request")[0])).toEqual({ email: "max@example.com" });

    const resend = screen.getByRole("button", { name: /^Resend in/ });
    expect(resend).toHaveTextContent("Resend in 1:00");
    expect(resend).toHaveAttribute("aria-disabled", "true");
    act(() => {
      vi.advanceTimersByTime(18_000);
    });
    expect(resend).toHaveTextContent("Resend in 0:42");
    await user.click(resend);
    expect(callsTo(fetchMock, "/api/auth/password-reset/request")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(42_000);
    });
    await user.click(screen.getByRole("button", { name: "Resend" }));
    await waitFor(() => {
      expect(callsTo(fetchMock, "/api/auth/password-reset/request")).toHaveLength(2);
    });
    expect(await screen.findByRole("button", { name: /^Resend in/ })).toHaveTextContent("Resend in 1:00");
  });

  it("sends the person to the reset code page when the server stopped sending email", async () => {
    signedOut(true, (url) => (url === "/api/auth/password-reset/request" ? json({ error: "This server doesn't send email.", code: "mail.disabled" }, 404) : undefined));
    const user = userEvent.setup();
    const { router } = renderApp("/forgot-password");
    await user.type(await screen.findByLabelText("Email"), "max@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await screen.findByRole("heading", { level: 1, name: "Set a new password" });
    expect(router.state.location.pathname).toBe("/reset-password");
    expect(screen.getByLabelText("Reset code")).toBeInTheDocument();
  });
});

describe("/reset-password", () => {
  it("reads the emailed link's code once, drops it from the address, and returns to sign-in", async () => {
    const fetchMock = signedOut(true, (url) => (url === "/api/auth/password-reset" ? json({ ok: true }) : undefined));
    const user = userEvent.setup();
    const { router } = renderApp(`/reset-password#code=${CODE}`);
    await screen.findByRole("heading", { level: 1, name: "Set a new password" });
    expect(router.state.location.hash).toBe("");
    expect(router.state.location.href).toBe("/reset-password");
    expect(screen.queryByLabelText("Reset code")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.getByText(/every signed-in device is signed out/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("New password"), "short");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(screen.getByText("Use 10 to 256 characters.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("New password"));
    await user.type(screen.getByLabelText("New password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Set password" }));

    await screen.findByRole("heading", { level: 1, name: /Welcome back/ });
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByRole("status")).toHaveTextContent("Your password changed and every device was signed out.");
    expect(bodyOf(callsTo(fetchMock, "/api/auth/password-reset")[0])).toEqual({ token: CODE, password: PASSWORD });
  });

  it("says an expired link is expired and offers a new one when email is on", async () => {
    signedOut(true, (url) => (url === "/api/auth/password-reset" ? json({ error: "This reset code is invalid or has expired.", code: "password_reset.invalid_token" }, 400) : undefined));
    const user = userEvent.setup();
    renderApp(`/reset-password#code=${CODE}`);
    await user.type(await screen.findByLabelText("New password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This reset link is invalid or has expired.");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/forgot-password");
    });
  });

  it("takes an operator's code when there is no link, and keeps the server's message on a bad code", async () => {
    const fetchMock = signedOut(false, (url) => (url === "/api/auth/password-reset" ? json({ error: "This reset code is invalid or has expired.", code: "password_reset.invalid_token" }, 400) : undefined));
    const user = userEvent.setup();
    renderApp("/reset-password");
    await user.type(await screen.findByLabelText("Reset code"), "not a code");
    await user.type(screen.getByLabelText("New password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(screen.getByText(/A reset code is 64 letters and numbers/)).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/auth/password-reset")).toHaveLength(0);

    await user.clear(screen.getByLabelText("Reset code"));
    await user.type(screen.getByLabelText("Reset code"), CODE.toUpperCase());
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("This reset code is invalid or has expired.")).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, "/api/auth/password-reset")[0])).toEqual({ token: CODE, password: PASSWORD });
    expect(screen.getByLabelText("Reset code")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("/join", () => {
  it("opens the join dialog with the emailed code, never in the address, and forgets it on close", async () => {
    stubServer((url) => (url === "/api/households" ? json({ households: [] }) : undefined));
    const user = userEvent.setup();
    const { router } = renderApp("/join#code=7f3a9c01b2");
    const dialog = await screen.findByRole("dialog", { name: "Join a household" });
    expect(within(dialog).getByLabelText("Invite code")).toHaveValue("7F3A9C01B2");
    expect(router.state.location.pathname).toBe("/households");
    expect(router.state.location.href).not.toContain("7F3A9C01B2".toLowerCase());
    expect(router.state.location.href).not.toContain("7F3A9C01B2");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(peekJoinCode()).toBeNull();
  });

  it("keeps the code through sign-in and opens the dialog afterwards", async () => {
    const state = { signedIn: false };
    stubServer((url) => {
      if (url === "/api/auth/me") return state.signedIn ? json({ email: ALEX }) : json({ error: "Please sign in to continue." }, 401);
      if (url === "/api/auth/login") {
        state.signedIn = true;
        return json({ token: "t".repeat(64), email: ALEX });
      }
      if (url === "/api/households") return json({ households: [] });
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/join#code=7F3A9C01B2");
    await user.type(await screen.findByLabelText("Email"), ALEX);
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const dialog = await screen.findByRole("dialog", { name: "Join a household" });
    expect(within(dialog).getByLabelText("Invite code")).toHaveValue("7F3A9C01B2");
  });
});

describe("invite by email", () => {
  let server: HouseholdServer;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T14:00:00Z"));
    server = createHouseholdServer();
  });

  function serve(emailEnabled: boolean) {
    server.state.emailEnabled = emailEnabled;
    return stubServer((url, init) => {
      if (url === "/api/info") return json({ name: "penny", version: "2.0.0-test", emailEnabled });
      if (!url.startsWith("/api/households") && url !== "/api/ledger") return undefined;
      const result = server.handle(ALEX, init?.method ?? "GET", url, (bodyOf(init) ?? {}) as Record<string, unknown>);
      return json(result.body, result.status);
    });
  }

  function apartment() {
    const { household } = server.handle(ALEX, "POST", "/api/households", { name: "Apartment", currency: "CAD" }).body as { household: { id: string } };
    return household.id;
  }

  it("describes when an invitation was sent and what became of it", () => {
    const now = Date.parse("2026-11-23T14:00:00Z");
    const base = { id: "e1", email: "jo@example.com", createdAt: now, expiresAt: now };
    const nineThirtyEight = new Date(2026, 10, 23, 9, 38).getTime();
    expect(sentLabel(nineThirtyEight, new Date(2026, 10, 23, 15, 0).getTime())).toBe("today at 9:38");
    expect(sentLabel(new Date(2026, 10, 18, 12).getTime(), new Date(2026, 10, 23, 15).getTime())).toBe("Nov 18");
    expect(inviteDetail({ ...base, status: "expired", sentAt: new Date(2026, 10, 18, 12).getTime() }, new Date(2026, 10, 23, 15).getTime())).toBe("Sent Nov 18 · link expired");
    expect(inviteDetail({ ...base, status: "sending", sentAt: null })).toBe("Sending now");
    expect(inviteDetail({ ...base, status: "failed", sentAt: null })).toMatch(/Couldn't be delivered/);
  });

  it("lists invitations with their status, sends, resends and revokes", async () => {
    const fetchMock = serve(true);
    const id = apartment();
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
    server.handle(ALEX, "POST", `/api/households/${id}/email-invites`, { email: "alex.k@example.com" });
    vi.setSystemTime(new Date("2026-11-23T13:38:00Z"));
    server.handle(ALEX, "POST", `/api/households/${id}/email-invites`, { email: "jo.s@example.com" });
    vi.setSystemTime(new Date("2026-11-23T14:00:00Z"));
    const old = server.state.emailInvites.find((invite) => invite.email === "alex.k@example.com");
    if (old) old.status = "expired";
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await screen.findByRole("heading", { level: 1, name: "Apartment" });
    await user.click(await screen.findByRole("button", { name: "Invite" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite to Apartment" });
    const list = await within(dialog).findByRole("list", { name: "Invited" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringMatching(/jo\.s@example\.com.*Sent today at.*Waiting/), expect.stringMatching(/alex\.k@example\.com.*Sent Nov 18 · link expired.*Expired/)]);

    // A bad address stays in the field with the reason.
    await user.type(within(dialog).getByLabelText("Email"), "sam@");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(within(dialog).getByText("Enter a valid email address.")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText("Email"));
    await user.type(within(dialog).getByLabelText("Email"), "sam@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(await within(list).findByText("sam@example.com")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toHaveValue("");

    await user.click(within(dialog).getByRole("button", { name: "Resend to alex.k@example.com" }));
    await waitFor(() => {
      expect(callsTo(fetchMock, `/api/households/${id}/email-invites/${old?.id ?? ""}/resend`)).toHaveLength(1);
    });

    await user.click(within(dialog).getByRole("button", { name: "More for jo.s@example.com" }));
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(within(list).queryByText("jo.s@example.com")).not.toBeInTheDocument();
    });
    expect(server.state.audit.map((event) => event.action)).toContain("invite.revoked");
  });

  it("says why nothing was sent at the daily limit, and shares a code instead", async () => {
    serve(true);
    const id = apartment();
    server.state.emailLimitReached = true;
    const user = userEvent.setup();
    renderApp(`/households/${id}`);
    await user.click(await screen.findByRole("button", { name: "Invite" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite to Apartment" });
    expect(await within(dialog).findByText(/Nobody yet/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Email"), "sam@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(await within(dialog).findByText("Too many invitation emails today. Try again tomorrow, or share a code instead.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Share a code instead" }));
    await user.click(within(dialog).getByRole("button", { name: "Create invite code" }));
    expect(await within(dialog).findByText(/Expires in/)).toBeInTheDocument();
  });

  it("keeps today's code flow when the server sends no email", async () => {
    serve(false);
    const id = apartment();
    const user = userEvent.setup();
    const { router } = renderApp(`/households/${id}`);
    await screen.findByRole("heading", { level: 1, name: "Apartment" });
    await user.click(await screen.findByRole("link", { name: "Invite" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: "people" });
    });
    expect(await screen.findByRole("button", { name: "Create invite code" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite by email" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
