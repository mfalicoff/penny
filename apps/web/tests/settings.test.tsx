import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadPreferences, STORAGE_KEY } from "../src/app/preferences";
import { TOAST_MS } from "../src/design/states";
import { bodyOf, callsTo, json, renderApp, stubServer } from "./render";

beforeEach(() => {
  localStorage.clear();
  reloadPreferences();
});

afterEach(() => {
  localStorage.clear();
  reloadPreferences();
});

describe("settings layout", () => {
  it("lists the profile, Manage, Preferences, Server and Sign out on phones, one URL per section", async () => {
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/settings");
    expect(await screen.findByRole("link", { name: /^Profile, / })).toHaveAttribute("href", "/settings/profile");
    const manage = screen.getByRole("navigation", { name: "Manage" });
    expect(within(manage).getAllByRole("link").map((link) => link.textContent.trim())).toEqual(["Recurring", "Accounts", "Categories"]);
    const sections = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(sections).getByRole("list", { name: "Preferences" })).toBeInTheDocument();
    expect(within(sections).getByRole("link", { name: /^Appearance/ })).toHaveTextContent("AppearanceSystem");
    expect(within(sections).getByRole("list", { name: "Server" })).toHaveTextContent(window.location.host);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    // The sheet closes back to Home.
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute("href", "/");

    await user.click(within(sections).getByRole("link", { name: /^Appearance/ }));
    expect(router.state.location.pathname).toBe("/settings/appearance");
    expect(await screen.findByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("navigation", { name: "Settings sections" })).not.toBeInTheDocument();
  });
});

describe("appearance", () => {
  it("defaults to System and follows the device", async () => {
    stubServer();
    renderApp("/settings/appearance");
    expect(await screen.findByRole("radio", { name: /System/ })).toBeChecked();
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("applies a chosen theme at once and remembers it on this browser", async () => {
    stubServer();
    const user = userEvent.setup();
    renderApp("/settings/appearance");
    await user.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({ theme: "dark" });

    await user.click(screen.getByRole("radio", { name: /System/ }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("toggles reduce transparency as a labelled switch", async () => {
    stubServer();
    const user = userEvent.setup();
    renderApp("/settings/appearance");
    const toggle = await screen.findByRole("switch", { name: "Reduce transparency" });
    expect(toggle).toHaveAccessibleDescription(/solid surfaces/);
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-transparency", "reduced");
  });

  it("shows cents on Home by default and saves the choice on this browser", async () => {
    stubServer();
    const user = userEvent.setup();
    renderApp("/settings/appearance");
    const toggle = await screen.findByRole("switch", { name: "Show cents on Home" });
    expect(toggle).toHaveAccessibleDescription(/\$1,116\.65 instead of \$1,117/);
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({ showCents: false });
  });

  it("starts the week on Monday by default and saves Sunday on this browser", async () => {
    stubServer();
    const user = userEvent.setup();
    renderApp("/settings/appearance");
    const week = await screen.findByRole("combobox", { name: "Week starts on" });
    expect(week).toHaveValue("monday");
    await user.selectOptions(week, "sunday");
    expect(week).toHaveValue("sunday");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({ weekStartsOn: "sunday" });
  });

  it("picks up a change made in another tab", async () => {
    stubServer();
    renderApp("/settings/appearance");
    const light = await screen.findByRole("radio", { name: "Light" });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "light", reduceTransparency: false }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });
    expect(light).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});

/** An in-memory ledger behind GET/PUT /api/ledger with revision checks, like the API. */
function ledgerServer(initial: { currency: string; transactions?: unknown[]; recurring?: unknown[] }, options: { put?: () => Response | undefined } = {}) {
  const state = { revision: 3, ledger: { version: 4, accounts: [], trips: [], categories: [], transactions: [], recurring: [], ...initial } };
  const fetchMock = stubServer((url, init) => {
    if (url !== "/api/ledger") return undefined;
    if (init?.method === "PUT") {
      const custom = options.put?.();
      if (custom) return custom;
      const body = bodyOf(init) as typeof state;
      if (body.revision !== state.revision) return json({ error: "The ledger changed." }, 409);
      state.revision += 1;
      state.ledger = body.ledger;
      return json(state);
    }
    return json(state);
  });
  return { state, fetchMock };
}

describe("currency", () => {
  it("changes the currency of an empty ledger, keeping the rest of the ledger as read", async () => {
    const { state, fetchMock } = ledgerServer({ currency: "CAD" });
    const user = userEvent.setup();
    renderApp("/settings/currency");
    const group = await screen.findByRole("group", { name: "Ledger currency" });
    expect(group).toHaveAccessibleDescription(/Choose your currency before adding entries/);
    expect(within(group).getByRole("radio", { name: /CAD/ })).toBeChecked();

    await user.click(within(group).getByRole("radio", { name: /EUR/ }));
    expect(await screen.findByText("Currency set to EUR")).toBeInTheDocument();
    expect(state.ledger.currency).toBe("EUR");
    const put = callsTo(fetchMock, "/api/ledger").find((init) => init?.method === "PUT");
    expect(bodyOf(put)).toEqual({ revision: 3, ledger: { version: 4, accounts: [], trips: [], categories: [], transactions: [], recurring: [], currency: "EUR" } });
    expect(within(group).getByRole("radio", { name: /EUR/ })).toBeChecked();
  });

  it("undoes the change from the toast", async () => {
    const { state } = ledgerServer({ currency: "CAD" });
    const user = userEvent.setup();
    renderApp("/settings/currency");
    await user.click(await screen.findByRole("radio", { name: /USD/ }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(state.ledger.currency).toBe("CAD");
    });
    expect(state.revision).toBe(5);
  });

  it("explains, and doesn't offer, a change once the ledger has entries", async () => {
    ledgerServer({ currency: "USD", transactions: [{ id: "t1" }] });
    renderApp("/settings/currency");
    const group = await screen.findByRole("group", { name: "Ledger currency" });
    expect(group).toHaveAccessibleDescription(/already has entries in USD, so the currency can't change/);
    expect(within(group).getByRole("radio", { name: /USD/ })).toBeEnabled();
    for (const code of ["CAD", "EUR", "GBP"]) expect(within(group).getByRole("radio", { name: new RegExp(code) })).toBeDisabled();
  });

  it("doesn't guess that a ledger is empty when the server omits the lists", async () => {
    stubServer((url) => (url === "/api/ledger" ? json({ revision: 0, ledger: { currency: "CAD" } }) : undefined));
    renderApp("/settings/currency");
    const group = await screen.findByRole("group", { name: "Ledger currency" });
    expect(group).toHaveAccessibleDescription(/couldn't confirm that your ledger is empty/);
    expect(within(group).getByRole("radio", { name: /EUR/ })).toBeDisabled();
  });

  it("reloads and asks again after a conflict", async () => {
    const { state } = ledgerServer({ currency: "CAD" }, { put: () => json({ error: "The ledger changed." }, 409) });
    const user = userEvent.setup();
    renderApp("/settings/currency");
    await user.click(await screen.findByRole("radio", { name: /GBP/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your ledger changed somewhere else");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /CAD/ })).toBeChecked();
    expect(state.ledger.currency).toBe("CAD");
  });

  it("keeps the choice retryable when the server can't be reached", async () => {
    let fail = true;
    const { state } = ledgerServer({ currency: "CAD" }, { put: () => (fail ? json({ error: "Down." }, 503) : undefined) });
    const user = userEvent.setup();
    renderApp("/settings/currency");
    await user.click(await screen.findByRole("radio", { name: /EUR/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(state.ledger.currency).toBe("EUR");
    });
  });

  it("offers a retry when the ledger can't be loaded", async () => {
    let down = true;
    stubServer((url) => (url === "/api/ledger" && down ? json({ error: "Down." }, 500) : undefined));
    const user = userEvent.setup();
    renderApp("/settings/currency");
    expect(await screen.findByRole("alert")).toHaveTextContent("Penny couldn't load your currency");
    down = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("group", { name: "Ledger currency" })).toBeInTheDocument();
  });
});

describe("toast", () => {
  it("dismisses itself, but not while the pointer or focus is on it", async () => {
    ledgerServer({ currency: "CAD" });
    const user = userEvent.setup();
    renderApp("/settings/currency");
    await user.click(await screen.findByRole("radio", { name: /EUR/ }));
    await screen.findByText("Currency set to EUR");

    vi.useFakeTimers();
    try {
      const toast = screen.getByText("Currency set to EUR").closest(".pk-toast") as HTMLElement;
      act(() => {
        toast.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      });
      act(() => {
        vi.advanceTimersByTime(TOAST_MS * 2);
      });
      expect(screen.getByText("Currency set to EUR")).toBeInTheDocument();
      act(() => {
        toast.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
      });
      act(() => {
        vi.advanceTimersByTime(TOAST_MS + 10);
      });
      expect(screen.queryByText("Currency set to EUR")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("server", () => {
  it("shows the read-only server, its version and the last sync", async () => {
    stubServer();
    renderApp("/settings/server");
    const section = await screen.findByRole("region", { name: "Server & sync" });
    expect(within(section).getByText(window.location.host)).toBeInTheDocument();
    expect(await within(section).findByText(/^Version 2\.0\.0-test · Email/)).toBeInTheDocument();
    expect(within(section).getByText("Sign out to change servers")).toBeInTheDocument();
    expect(within(section).getByText("Last synced")).toBeInTheDocument();
  });

  it("says when the server can't be reached", async () => {
    stubServer((url) => (url === "/api/info" ? json({ error: "Down." }, 502) : undefined));
    renderApp("/settings/server");
    expect(await screen.findByText(/^Can't reach the server · /)).toBeInTheDocument();
  });
});
