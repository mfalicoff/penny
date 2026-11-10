import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createDemoServer, DEMO_EMAIL, sampleEntries } from "../src/demo/demoServer";
import { json, renderApp, stubServer, wasCalled } from "./render";

const signedOut = () => stubServer((url) => (url === "/api/auth/me" ? json({ error: "Please sign in to continue." }, 401) : undefined));

async function enterDemo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Explore a demo" }));
  return screen.findByText("You're exploring a demo");
}

describe("temporary demo", () => {
  it("starts from sign-in, explains itself, and never calls the real API", async () => {
    const fetchMock = signedOut();
    const user = userEvent.setup();
    renderApp("/transactions");
    expect(await screen.findByRole("button", { name: "Explore a demo" })).toHaveAccessibleDescription(/Nothing is saved or sent to your server/);
    const calls = fetchMock.mock.calls.length;

    await enterDemo(user);
    expect(screen.getByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    expect(await screen.findByText("Weekly groceries")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search transactions" }), "rent{Enter}");
    await waitFor(() => {
      expect(screen.queryByText("Weekly groceries")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Rent")).toBeInTheDocument();

    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(wasCalled(fetchMock, "/api/v1/search/transactions")).toBe(false);
    expect(wasCalled(fetchMock, "/api/ledger")).toBe(false);
  });

  it("leaves back to sign-in and drops everything it cached", async () => {
    const fetchMock = signedOut();
    const user = userEvent.setup();
    const { queryClient } = renderApp("/transactions");
    await enterDemo(user);
    await screen.findByText("Weekly groceries");

    await user.click(screen.getByRole("button", { name: "Leave demo" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    const keys = queryClient.getQueryCache().getAll().map((query) => JSON.stringify(query.queryKey));
    expect(keys.filter((key) => key.includes(DEMO_EMAIL))).toEqual([]);

    // Requests go to the network again.
    const before = fetchMock.mock.calls.length;
    await queryClient.refetchQueries({ queryKey: ["session"], exact: true });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it("offers Leave demo instead of sign-out, and no server settings", async () => {
    signedOut();
    const user = userEvent.setup();
    renderApp("/settings");
    await enterDemo(user);
    const account = screen.getByRole("region", { name: "Account" });
    expect(within(account).getByText(/exploring sample data/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Server" }));
    expect(await screen.findByRole("heading", { name: "The demo doesn't use a server" })).toBeInTheDocument();
  });

  it("isn't offered on the create-account form", async () => {
    signedOut();
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Create an account" }));
    expect(screen.queryByRole("button", { name: "Explore a demo" })).not.toBeInTheDocument();
  });
});

describe("demo server", () => {
  const call = async (server: ReturnType<typeof createDemoServer>, method: string, path: `/api/${string}`, body?: unknown) => {
    const response = await server(path, { method, body, signal: null });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it("pages search results with an opaque cursor, newest first", async () => {
    const server = createDemoServer(new Date(2026, 10, 25));
    const first = await call(server, "POST", "/api/v1/search/transactions", { pageSize: 4 });
    expect(first.body.totalCount).toBe(sampleEntries().length);
    expect(first.body.nextCursor).toBe("4");
    const dates = (first.body.items as { entry: { date: string } }[]).map((item) => item.entry.date);
    expect(dates).toEqual([...dates].sort().reverse());
    const last = await call(server, "POST", "/api/v1/search/transactions", { pageSize: 50, cursor: "8" });
    expect(last.body.nextCursor).toBeNull();
  });

  it("checks revisions on ledger writes like the API", async () => {
    const server = createDemoServer();
    const { body } = await call(server, "GET", "/api/ledger");
    expect((await call(server, "PUT", "/api/ledger", { ...body, revision: 0 })).status).toBe(409);
    expect((await call(server, "PUT", "/api/ledger", body)).body.revision).toBe(2);
  });

  it("starts fresh every time, and answers unknown paths with 404", async () => {
    const one = createDemoServer();
    const ledger = (await call(one, "GET", "/api/ledger")).body;
    await call(one, "PUT", "/api/ledger", { ...ledger, ledger: { ...(ledger.ledger as object), transactions: [] } });
    const two = createDemoServer();
    expect(((await call(two, "GET", "/api/ledger")).body.ledger as { transactions: unknown[] }).transactions).toHaveLength(sampleEntries().length);
    expect((await call(two, "GET", "/api/households")).status).toBe(404);
  });
});
