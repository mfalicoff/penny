import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
    ["/settings/appearance", "Settings"],
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
    expect(screen.getByRole("dialog", { name: "Add entry" })).toBeInTheDocument();
    // The entry form (MAZ-88) once this browser's ledger has loaded; its own tests are in entries.test.tsx.
    expect(await within(await screen.findByRole("form", { name: "Add entry" })).findByLabelText("Amount (CAD)")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(add).toHaveFocus();
    expect(router.state.location.pathname).toBe("/trips");
  });

  it("opens Add entry from the /entries/new deep link and goes Home when it closes", async () => {
    stubServer();
    const user = userEvent.setup();
    const { router } = renderApp("/entries/new");
    const dialog = await screen.findByRole("dialog", { name: "Add entry" });
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
    expect(screen.getByRole("dialog", { name: "Add entry" })).toBeInTheDocument();
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
    const dialog = screen.getByRole("dialog", { name: "Add entry" });
    await user.keyboard("ga");
    expect(router.state.location.pathname).toBe("/");
    expect(dialog).toBeInTheDocument();
  });
});

describe("phone navigation", () => {
  it("offers the four tabs and a More drawer that traps focus and restores it", async () => {
    stubServer();
    const user = userEvent.setup();
    const { container } = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Home" });
    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual(["Home", "Activity", "Shared", "Trips"]);
    expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    const more = within(tabs).getByRole("button", { name: "More" });
    await user.click(more);
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    expect(container).toHaveAttribute("inert");
    expect(within(drawer).getByRole("button", { name: "Close menu" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(more).toHaveFocus();

    await user.click(more);
    // The link for the page already open still closes the drawer.
    await user.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("link", { name: "Home" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(more);
    await user.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("link", { name: "Categories" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Categories" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
