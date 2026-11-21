import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp, stubServer } from "./render";

const main = () => screen.getByRole("navigation", { name: "Main" });

describe("app URLs", () => {
  // Every route opens its page (contracts/design-baseline.json navigation.routes).
  it.each([
    ["/", "Home"],
    ["/transactions", "Activity"],
    ["/insights", "Insights"],
    ["/households", "Shared"],
    ["/households/h-1", "Household"],
    ["/households/h-1/expenses/e-1", "Household"],
    ["/trips", "Trips"],
    ["/trips/t-1", "Trip"],
    ["/recurring", "Recurring"],
    ["/accounts", "Accounts"],
    ["/categories", "Categories"],
    ["/settings", "Settings"],
    ["/settings/appearance", "Appearance"],
    ["/settings/receipt-email", "Receipt email"],
    ["/receipts", "Receipts to attach"],
  ])("%s opens with the title %s", async (path, title) => {
    stubServer();
    renderApp(path);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(document.title).toBe(title === "Home" ? "Home · Penny" : `${title} · Penny`);
  });

  it("marks the current section in the sidebar for nested pages", async () => {
    stubServer();
    renderApp("/households/h-1");
    await screen.findByRole("heading", { level: 1, name: "Household" });
    expect(within(main()).getByRole("link", { name: "Shared" })).toHaveAttribute("aria-current", "page");
    expect(within(main()).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("titles an unknown address as not found", async () => {
    stubServer();
    renderApp("/nope");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(document.title).toBe("Page not found · Penny");
  });

  it("follows browser back and forward", async () => {
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    await user.click(within(main()).getByRole("link", { name: "Trips" }));
    await screen.findByRole("heading", { level: 1, name: "Trips" });
    await user.click(within(main()).getByRole("link", { name: "Recurring" }));
    await screen.findByRole("heading", { level: 1, name: "Recurring" });
    act(() => {
      router.history.back();
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Trips" })).toBeInTheDocument();
    act(() => {
      router.history.forward();
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Recurring" })).toBeInTheDocument();
  });
});

describe("top bar", () => {
  it("searches from any page and opens Activity with the query in the URL", async () => {
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/trips");
    await screen.findByRole("heading", { level: 1, name: "Trips" });
    await user.type(screen.getByRole("searchbox", { name: "Search entries" }), "  rent {Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ q: "rent" });
    // Activity has its own search field, so the top bar doesn't show a second one.
    expect(screen.queryByRole("searchbox", { name: "Search entries" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search transactions" })).toHaveValue("rent");
  });

  it("opens Add entry over the current page and returns focus to the button", async () => {
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/trips");
    await screen.findByRole("heading", { level: 1, name: "Trips" });
    const add = screen.getByRole("button", { name: "Add entry" });
    await user.click(add);
    expect(screen.getByRole("dialog", { name: "New entry" })).toBeInTheDocument();
    // The entry form (MAZ-88) once this browser's ledger has loaded; its own tests are in entries.test.tsx.
    expect(await within(await screen.findByRole("form", { name: "New entry" })).findByLabelText("Amount (CAD)")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(add).toHaveFocus();
    expect(router.state.location.pathname).toBe("/trips");
  });

  it("opens Add entry from the /entries/new deep link and goes Home when it closes", async () => {
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/entries/new");
    const dialog = await screen.findByRole("dialog", { name: "New entry" });
    await user.click(within(dialog).getAllByRole("button", { name: "Close" })[0] as HTMLElement);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });
});

describe("keyboard shortcuts", () => {
  it("N opens Add entry, and Escape closes it", async () => {
    stubServer();
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    await user.keyboard("n");
    expect(screen.getByRole("dialog", { name: "New entry" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Ctrl+K and / focus the search field", async () => {
    stubServer();
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    const search = screen.getByRole("searchbox", { name: "Search entries" });
    await user.keyboard("{Control>}k{/Control}");
    expect(search).toHaveFocus();
    search.blur();
    await user.keyboard("/");
    expect(search).toHaveFocus();
  });

  it("G then a letter goes to a page", async () => {
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    await user.keyboard("ga");
    expect(await screen.findByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    await user.keyboard("{Tab}");
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("gt");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/trips");
    });
  });

  it("never fires while typing, or while a dialog is open", async () => {
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    const search = screen.getByRole("searchbox", { name: "Search entries" });
    await user.type(search, "gang n");
    expect(search).toHaveValue("gang n");
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    search.blur();
    await user.keyboard("n");
    const dialog = screen.getByRole("dialog", { name: "New entry" });
    await user.keyboard("ga");
    expect(router.state.location.pathname).toBe("/");
    expect(dialog).toBeInTheDocument();
  });
});

describe("phone navigation", () => {
  it("offers the four tabs beside the add button, keeps Home selected on Insights, and reaches Manage from Settings", async () => {
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual(["Home", "Activity", "Shared", "Trips"]);
    // No More tab (MAZ-221): Add entry is its own button, and Settings opens from Home.
    expect(within(tabs).queryByRole("button")).not.toBeInTheDocument();
    expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Add entry" })).toBeInTheDocument();

    // Insights is pushed from Home: Home stays selected and Back returns to it.
    await act(() => router.navigate({ to: "/insights" }));
    await screen.findByRole("heading", { level: 1, name: "Insights" });
    expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "true");
    await user.click(screen.getByRole("link", { name: "Back to Home" }));
    await screen.findByRole("heading", { level: 1, name: "Home" });

    await user.click(within(screen.getByRole("banner")).getByRole("link", { name: "Settings" }));
    const manage = await screen.findByRole("navigation", { name: "Manage" });
    await user.click(within(manage).getByRole("link", { name: "Categories" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Categories" })).toBeInTheDocument();
    expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "true");
  });
});

describe("phone Settings sheet", () => {
  it("draws Settings over Home, which stays hidden from assistive technology and out of reach", async () => {
    stubServer();
    renderApp("/settings");
    await screen.findByRole("navigation", { name: "Manage" });
    // iphone-settings: the sheet's page is Settings; Home sits under the dim.
    const behind = document.querySelector(".app__behind");
    expect(behind).toHaveAttribute("aria-hidden", "true");
    expect(behind).toHaveAttribute("inert");
    await waitFor(() => {
      expect(behind).toHaveTextContent("Left to spend");
    });
    expect(screen.queryByRole("region", { name: "Left to spend" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute("href", "/");
  });

  it("leaves other pages without Home behind them", async () => {
    stubServer();
    renderApp("/trips");
    await screen.findByRole("heading", { level: 1, name: "Trips" });
    expect(document.querySelector(".app__behind")).toBeNull();
  });
});

describe("touch tablet top bar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches from the round glass button (ipad-home) and keeps Settings without one", async () => {
    // An iPad in landscape: every min-width query up to 1194px, and the touch tablet query.
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => {
        const min = /min-width:\s*(\d+)px/.exec(query);
        const fits = !min || 1194 >= Number(min[1]);
        const matches = query.includes("pointer: coarse") || query.includes("hover: none") ? fits : fits && !query.includes("hover");
        return { matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      }),
    );
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/trips");
    await screen.findByRole("heading", { level: 1, name: "Trips" });
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Search entries" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/transactions");
    await waitFor(() => {
      expect(screen.getByRole("searchbox", { name: "Search transactions" })).toHaveFocus();
    });
    // The sheet over Home is for phones only.
    await act(() => router.navigate({ to: "/settings/appearance" }));
    await screen.findByRole("heading", { level: 2, name: "Appearance" });
    expect(document.querySelector(".app__behind")).toBeNull();
  });
});

describe("offline", () => {
  it("shows a banner while the browser is offline and removes it when back", async () => {
    stubServer();
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument();

    const onLine = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(screen.getByText("You're offline")).toBeInTheDocument();
      expect(screen.getByText(/Changes you can't save yet stay in their form/)).toBeInTheDocument();
    } finally {
      // Removing the own property falls back to the prototype getter (online in jsdom).
      Reflect.deleteProperty(navigator, "onLine");
      if (onLine) expect(navigator.onLine).toBe(true);
    }
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument();
  });
});
