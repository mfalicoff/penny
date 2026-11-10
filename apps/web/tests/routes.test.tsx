import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { bodyOf, callsTo, renderApp, stubServer } from "./render";

const info = () => stubServer();

describe("app shell", () => {
  it("renders Home with landmarks, a skip link and the server version", async () => {
    const fetchMock = info();
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Activity" })).not.toHaveAttribute("aria-current");
    expect(await screen.findByText("2.0.0-test")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/info", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("keeps rendering when the server is unavailable", async () => {
    stubServer((url) => (url === "/api/info" ? new Response("bad gateway", { status: 502 }) : undefined));
    renderApp("/");
    expect(await screen.findByText("Server unavailable")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("navigates between routes with the keyboard", async () => {
    info();
    const user = userEvent.setup();
    const { router } = renderApp("/");
    await screen.findByRole("heading", { name: "Home" });
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("link", { name: "Activity" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/transactions");
  });

  it("shows a not-found page for unknown paths", async () => {
    info();
    renderApp("/does-not-exist");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/");
  });
});

describe("/transactions search parameters", () => {
  const searchBodies = (fetchMock: ReturnType<typeof stubServer>) =>
    callsTo(fetchMock, "/api/v1/search/transactions").map((init) => bodyOf(init));

  it("reads typed parameters from a deep link and searches with them", async () => {
    const fetchMock = info();
    renderApp("/transactions?q=coffee&month=2026-11");
    expect(await screen.findByRole("searchbox", { name: "Search transactions" })).toHaveValue("coffee");
    expect(await screen.findByText("No matching transactions.")).toBeInTheDocument();
    expect(searchBodies(fetchMock)).toEqual([{ query: "coffee", from: "2026-11-01", to: "2026-11-30", pageSize: 50 }]);
  });

  it("drops invalid values instead of failing the page", async () => {
    const fetchMock = info();
    renderApp("/transactions?month=2026-13");
    expect(await screen.findByText("No matching transactions.")).toBeInTheDocument();
    expect(searchBodies(fetchMock)).toEqual([{ pageSize: 50 }]);
  });

  it("writes the query to the URL and clears it again", async () => {
    const fetchMock = info();
    const user = userEvent.setup();
    const { router } = renderApp("/transactions?month=2026-11");
    const box = await screen.findByRole("searchbox", { name: "Search transactions" });
    await user.type(box, "  rent {Enter}");
    await waitFor(() => {
      expect(searchBodies(fetchMock)).toContainEqual({ query: "rent", from: "2026-11-01", to: "2026-11-30", pageSize: 50 });
    });
    expect(router.state.location.search).toEqual({ month: "2026-11", q: "rent" });

    await user.clear(screen.getByRole("searchbox", { name: "Search transactions" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ month: "2026-11" });
    });
  });
});
