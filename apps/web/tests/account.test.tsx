import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentName, entriesPath, fileSize } from "../src/api/account";
import { memberName, people } from "../src/features/households/model";
import { joinNames } from "../src/features/settings/DeleteAccountDialog";
import { ALEX, bodyOf, callsTo, json, renderApp, stubServer } from "./render";

// MAZ-152: deleting the account and exporting its data on the web. All data is synthetic.

const USER_ID = "u".repeat(32);

const profile = (overrides: Record<string, unknown> = {}) => ({
  userId: USER_ID,
  email: ALEX,
  nameEditable: true,
  avatarEditable: true,
  needsName: false,
  signIn: "password",
  emailVerified: true,
  ...overrides,
});

const household = (id: string, name: string) => ({ id, name, currency: "CAD", creatorId: "someone", createdAt: 0, memberCount: 2 });

const file = (body: string, type: string, name: string) =>
  new Response(body, { status: 200, headers: { "Content-Type": type, "Content-Disposition": `attachment; filename=${name}; filename*=UTF-8''${name}` } });

/** A desktop window (cards `web-*`); without it jsdom has no `matchMedia` and the phone layout renders. */
function stubWidth(width: number) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      if (query.includes("pointer: coarse")) return { matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      return { matches: min ? width >= Number(min[1]) : query.includes("hover"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:penny"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("on a phone", () => {
  it("lists Your data under Sign-in, opening the export and the deletion", async () => {
    stubServer((url) => {
      if (url === "/api/profile") return json(profile());
      if (url === "/api/households") return json({ households: [] });
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/settings/profile");
    expect(await screen.findByRole("link", { name: /Export all your data/ })).toHaveAttribute("href", "/settings/export");
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    expect(await screen.findByRole("dialog", { name: "Delete your account?" })).toBeInTheDocument();
  });

  it("lists what the export includes with each part's detail", async () => {
    stubServer();
    renderApp("/settings/export");
    const included = await screen.findByRole("list", { name: "Included" });
    expect(within(included).getByText("Shared expenses with everyone's share")).toBeInTheDocument();
    expect(within(included).getAllByRole("img", { name: "Included" })).toHaveLength(5);
  });
});

describe("export and deletion helpers", () => {
  it("names the period's CSV, reads the server's file name and sizes the file", () => {
    expect(entriesPath({ month: "2026-11" })).toBe("/api/export/entries?month=2026-11");
    expect(entriesPath({ year: "2026" })).toBe("/api/export/entries?year=2026");
    expect(entriesPath({})).toBe("/api/export/entries");
    expect(entriesPath(null)).toBe("/api/export/entries");
    expect(attachmentName("attachment; filename=a.zip; filename*=UTF-8''penny-export-2026-11-22.zip", "x.zip")).toBe("penny-export-2026-11-22.zip");
    expect(attachmentName('attachment; filename="plain.csv"', "x.csv")).toBe("plain.csv");
    expect(attachmentName(null, "x.csv")).toBe("x.csv");
    expect(fileSize(512)).toBe("512 bytes");
    expect(fileSize(14_200_000)).toBe("14.2 MB");
    expect(fileSize(820_400)).toBe("820 KB");
  });

  it("lists households as the card does", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Apartment"])).toBe("Apartment");
    expect(joinNames(["Apartment", "Lisbon"])).toBe("Apartment and Lisbon");
    expect(joinNames(["Apartment", "Lisbon", "Cottage"])).toBe("Apartment, Lisbon and Cottage");
  });

  it("shows someone who deleted their account as a former member, never their placeholder email", () => {
    const gone = { userId: "bea", email: `deleted-${"b".repeat(32)}@deleted.invalid`, joinedAt: 0, leftAt: 1, deleted: true as const };
    expect(memberName(gone)).toBe("Former member");
    const who = people({ household: household("h", "Home") as never, members: [{ userId: "me", email: ALEX, joinedAt: 0 }, gone] }, ALEX);
    expect(who.name("bea")).toBe("Former member");
    expect(who.avatar("bea")).toBe("?");
  });
});

describe("Settings › Profile › Delete account", () => {
  beforeEach(() => {
    stubWidth(1440);
  });

  it("names the households that keep shared expenses and refuses a wrong password", async () => {
    const fetchMock = stubServer((url, init) => {
      if (url === "/api/profile") return json(profile());
      if (url === "/api/households") return json({ households: [household("a", "Apartment"), household("l", "Lisbon")] });
      if (url === "/api/account/delete" && init?.method === "POST") return json({ error: "Your password is incorrect." }, 400);
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/settings/profile");
    expect(await screen.findByText("Export all your data")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete your account?" });
    expect(within(dialog).getByText("Your name, picture and email")).toBeInTheDocument();
    expect(await within(dialog).findByText(/Shared expenses in Apartment and Lisbon\. Members keep them and see you as “Former member”\./)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Export your data" })).toHaveAttribute("href", "/settings/export");
    expect(within(dialog).getByText(/Backups keep deleted data for up to 30 days/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter your password to delete your account.");
    expect(callsTo(fetchMock, "/api/account/delete")).toHaveLength(0);

    await user.type(within(dialog).getByLabelText("Enter your password to confirm"), "not the password");
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Your password is incorrect.");
    expect(callsTo(fetchMock, "/api/account/delete").map(bodyOf)).toEqual([{ password: "not the password" }]);
  });

  it("shows why a household blocks it, and nothing is deleted", async () => {
    const reason = "Settle every monthly balance in Apartment before you delete your account.";
    stubServer((url, init) => {
      if (url === "/api/profile") return json(profile());
      if (url === "/api/households") return json({ households: [household("a", "Apartment")] });
      if (url === "/api/account/delete" && init?.method === "POST") return json({ error: reason }, 409);
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/settings/profile");
    await user.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete your account?" });
    await user.type(within(dialog).getByLabelText("Enter your password to confirm"), "a secure test password");
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(reason);
    expect(screen.getByRole("dialog", { name: "Delete your account?" })).toBeInTheDocument();
  });

  it("deletes the account and returns to sign-in, saying so", async () => {
    let deleted = false;
    const fetchMock = stubServer((url, init) => {
      if (url === "/api/auth/me" && deleted) return json({ error: "Please sign in to continue." }, 401);
      if (url === "/api/profile") return json(profile());
      if (url === "/api/households") return json({ households: [] });
      if (url === "/api/account/delete" && init?.method === "POST") {
        deleted = true;
        return json({ ok: true });
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/settings/profile");
    await user.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete your account?" });
    expect(within(dialog).queryByText(/Stays for others/)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Enter your password to confirm"), "a secure test password");
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(await screen.findByText("Your account was deleted, and every device was signed out.")).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/account/delete").map(bodyOf)).toEqual([{ password: "a secure test password" }]);
  });

  it("confirms without a password for an account that signs in with a provider", async () => {
    const fetchMock = stubServer((url, init) => {
      if (url === "/api/profile") return json(profile({ signIn: "oidc", provider: "Google" }));
      if (url === "/api/households") return json({ households: [] });
      if (url === "/api/account/delete" && init?.method === "POST") return json({ ok: true });
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/settings/profile");
    await user.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete your account?" });
    expect(within(dialog).queryByLabelText("Enter your password to confirm")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    await waitFor(() => {
      expect(callsTo(fetchMock, "/api/account/delete").map(bodyOf)).toEqual([{}]);
    });
  });
});

describe("Settings › Export data", () => {
  beforeEach(() => {
    stubWidth(1440);
  });

  it("downloads the full export and the period's entries", async () => {
    const fetchMock = stubServer((url) => {
      if (url === "/api/export") return file("zip".repeat(400), "application/zip", "penny-export-2026-11-22.zip");
      if (url.startsWith("/api/export/entries")) return file("Date\r\n", "text/csv", "penny-entries.csv");
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/settings/export");
    expect(await screen.findByRole("heading", { name: "All your data" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Included" })).getByText("Receipts, as the original files")).toBeInTheDocument();
    expect(screen.getByText("The server prepares the ZIP and deletes it after you download it.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download ZIP" }));
    expect(await screen.findByText("penny-export-2026-11-22.zip · 1 KB · ready")).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: "Everything" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /This month/ }));
    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.map(([input]) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url)).filter((url) => url.startsWith("/api/export/entries"))).toEqual([expect.stringMatching(/^\/api\/export\/entries\?month=\d{4}-\d{2}$/)]);
    });
  });

  it("says what went wrong when the export fails", async () => {
    stubServer((url) => (url === "/api/export" ? json({ error: "Unexpected server error." }, 500) : undefined));
    const user = userEvent.setup();
    renderApp("/settings/export");
    await user.click(await screen.findByRole("button", { name: "Download ZIP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unexpected server error.");
  });

  it("is a row of the desktop section list", async () => {
    stubServer((url) => (url === "/api/profile" ? json(profile()) : undefined));
    renderApp("/settings/appearance");
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    const labels = within(nav)
      .getAllByRole("listitem")
      .map((item) => item.textContent.trim());
    expect(labels.indexOf("Export data")).toBe(labels.indexOf("Server & sync") + 1);
  });
});

describe("Activity export", () => {
  it("downloads the shown month's entries as a CSV on desktop", async () => {
    stubWidth(1440);
    const fetchMock = stubServer((url) => (url.startsWith("/api/export/entries") ? file("Date\r\n", "text/csv", "penny-entries-2026-09.csv") : undefined));
    const user = userEvent.setup();
    renderApp("/transactions?month=2026-09");
    await user.click(await screen.findByRole("button", { name: "Export September 2026 as a CSV file" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.map(([input]) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url)).filter((url) => url.startsWith("/api/export"))).toEqual(["/api/export/entries?month=2026-09"]);
    });
  });
});
