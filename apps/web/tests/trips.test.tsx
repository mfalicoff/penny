import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHouseholdServer, type HouseholdServer } from "./fakes/householdServer";
import { ALEX, bodyOf, callsTo, json, renderApp, stubServer } from "./render";

/**
 * Trips (MAZ-93) in the real app: personal trips through the durable offline ledger
 * (fake-indexeddb) and a revision-checked `/api/ledger`, shared trips through the in-memory
 * household fake, which follows the documented server rules. Synthetic data only.
 */

const BEA = "bea@example.test";
let server: HouseholdServer;

/** Routes /api/ledger and /api/households… to the fake as `email`; everything else as the usual signed-in stub. */
function serve(email = ALEX, options: { offline?: () => boolean } = {}) {
  return stubServer((url, init) => {
    if (url === "/api/auth/me") return json({ email });
    if (!url.startsWith("/api/households") && url !== "/api/ledger") return undefined;
    if (options.offline?.()) throw new TypeError("Failed to fetch");
    const result = server.handle(email, init?.method ?? "GET", url, (bodyOf(init) ?? {}) as Record<string, unknown>);
    return json(result.body, result.status);
  });
}

const dialog = (name: string | RegExp) => screen.findByRole("dialog", { name });

async function setDate(user: UserEvent, field: HTMLElement, value: string) {
  await user.clear(field);
  await user.type(field, value);
}

async function fillTrip(user: UserEvent, form: HTMLElement, name: string, start: string, end: string) {
  await user.clear(within(form).getByLabelText("Trip name"));
  await user.type(within(form).getByLabelText("Trip name"), name);
  await setDate(user, within(form).getByLabelText("Starts"), start);
  await setDate(user, within(form).getByLabelText("Ends"), end);
}

const ledgerTrips = (email = ALEX) => server.ledger(email).ledger.trips;

/** Seeds Alex's ledger on the server with a personal trip and expenses, before the app loads it. */
function seedPersonal(entries: { id: string; date: string; share: number; total?: number }[] = []) {
  server.writeLedger(ALEX, (ledger) => ({
    ...ledger,
    trips: [{ id: "lis", name: "Lisbon", startDate: "2026-11-12", endDate: "2026-11-19" }],
    transactions: entries.map((entry) => ({ id: entry.id, title: `Paid ${entry.id}`, kind: "expense", total: entry.total ?? entry.share, share: entry.share, categoryId: "c-groceries", date: entry.date, note: "", tripId: "lis" })),
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  server = createHouseholdServer();
  // Each page loads its route code on first use, which is slow on a cold, busy test worker.
  configure({ asyncUtilTimeout: 5000 });
});

afterEach(() => {
  vi.useRealTimers();
  configure({ asyncUtilTimeout: 1000 });
});

describe("personal trips", { timeout: 20_000 }, () => {
  it("creates a trip offline first, shows it, edits its dates and syncs each change once", async () => {
    serve();
    const user = userEvent.setup();
    renderApp("/trips");
    expect(await screen.findByRole("heading", { name: "Your next trip starts here" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New trip" }));
    const form = await dialog("New trip");

    // Validation names the field and keeps focus there; nothing is saved.
    await user.clear(within(form).getByLabelText("Trip name"));
    await user.click(within(form).getByRole("button", { name: "Create trip" }));
    expect(within(form).getByLabelText("Trip name")).toHaveFocus();
    expect(within(form).getByText("Give your trip a name of up to 80 characters.")).toBeInTheDocument();
    await fillTrip(user, form, "Lisbon", "2026-11-19", "2026-11-12");
    await user.click(within(form).getByRole("button", { name: "Create trip" }));
    expect(within(form).getByText("The trip can't end before it starts.")).toBeInTheDocument();
    expect(within(form).getByLabelText("Ends")).toHaveFocus();

    await setDate(user, within(form).getByLabelText("Ends"), "2026-11-19");
    await setDate(user, within(form).getByLabelText("Starts"), "2026-11-12");
    await user.click(within(form).getByRole("button", { name: "Create trip" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Lisbon" })).toBeInTheDocument();
    expect(screen.getByText("Thu, Nov 12 – Thu, Nov 19, 2026")).toBeInTheDocument();
    await waitFor(() => {
      expect(ledgerTrips()).toEqual([expect.objectContaining({ name: "Lisbon", startDate: "2026-11-12", endDate: "2026-11-19" })]);
    });

    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const edit = await dialog("Edit trip");
    await setDate(user, within(edit).getByLabelText("Starts"), "2026-11-10");
    await user.click(within(edit).getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(ledgerTrips()[0]?.startDate).toBe("2026-11-10");
    });
    expect(screen.getByText("Tue, Nov 10 – Thu, Nov 19, 2026")).toBeInTheDocument();

    // Back on the list the trip is featured as the next one.
    await user.click(screen.getByRole("link", { name: /All trips/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Lisbon" })).toBeInTheDocument();
    expect(screen.getByText("In 21 days")).toBeInTheDocument();
  });

  it("adds a trip expense, counts expenses outside the dates, and only deletes an empty trip", async () => {
    seedPersonal([{ id: "flight", date: "2026-09-28", share: 41200, total: 82400 }]);
    serve();
    const user = userEvent.setup();
    renderApp("/trips/lis");
    expect(await screen.findByRole("heading", { level: 1, name: "Lisbon" })).toBeInTheDocument();
    expect(screen.getByText("1 outside the trip dates")).toBeInTheDocument();
    expect(screen.getByText(/Only your share of a split expense counts/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Trip expense" }));
    const add = await dialog("Add entry");
    expect(within(add).getByLabelText("Trip")).toHaveValue("lis");
    await user.type(within(add).getByLabelText("Amount (CAD)"), "30");
    await user.type(within(add).getByLabelText("Title"), "Tram pass");
    await user.click(within(add).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add entry" })).not.toBeInTheDocument();
    });
    const list = await screen.findByRole("list", { name: "Trip expenses" });
    expect(within(list).getByText("Tram pass")).toBeInTheDocument();
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    await waitFor(() => {
      expect(server.ledger(ALEX).ledger.transactions.find((entry) => entry.title === "Tram pass")?.tripId).toBe("lis");
    });

    // A trip with expenses can't be deleted: the button says why.
    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const edit = await dialog("Edit trip");
    expect(within(edit).getByRole("button", { name: "Delete trip" })).toBeDisabled();
    expect(within(edit).getByText(/2 expenses are assigned to this trip/)).toBeInTheDocument();
    await user.click(within(edit).getByRole("button", { name: "Cancel" }));
  });

  it("deletes an empty trip after asking, and refuses a duplicate name at the field", async () => {
    server.writeLedger(ALEX, (ledger) => ({
      ...ledger,
      trips: [
        { id: "lis", name: "Lisbon", startDate: "2026-11-12", endDate: "2026-11-19" },
        { id: "ski", name: "Ski week", startDate: "2027-02-14", endDate: "2027-02-21" },
      ],
    }));
    serve();
    const user = userEvent.setup();
    renderApp("/trips/lis");
    await user.click(await screen.findByRole("button", { name: "Edit trip" }));
    const edit = await dialog("Edit trip");
    await user.clear(within(edit).getByLabelText("Trip name"));
    await user.type(within(edit).getByLabelText("Trip name"), "ski WEEK");
    await user.click(within(edit).getByRole("button", { name: "Save changes" }));
    expect(await within(edit).findByText("You already have a trip with this name.")).toBeInTheDocument();
    expect(within(edit).getByLabelText("Trip name")).toHaveFocus();

    await user.click(within(edit).getByRole("button", { name: "Delete trip" }));
    const confirm = await dialog("Delete Lisbon?");
    await user.click(within(confirm).getByRole("button", { name: "Delete trip" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Trips" })).toBeInTheDocument();
    await waitFor(() => {
      expect(ledgerTrips().map((trip) => trip.id)).toEqual(["ski"]);
    });
  });

  it("opens a trip that isn't there with a way back", async () => {
    serve();
    renderApp("/trips/nowhere");
    expect(await screen.findByRole("heading", { name: "This trip isn't here" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All trips/ })).toHaveAttribute("href", "/trips");
  });
});

describe("shared trips", { timeout: 20_000 }, () => {
  it("shares a personal trip: the earlier expense stays private and the trip is listed once", async () => {
    seedPersonal([{ id: "train", date: "2026-09-28", share: 2400 }]);
    const fetchMock = serve();
    const user = userEvent.setup();
    renderApp("/trips/lis");
    await user.click(await screen.findByRole("button", { name: "Share trip" }));
    const share = await dialog("Share Lisbon?");
    expect(within(share).getByText("Your 1 expense stays private.")).toBeInTheDocument();
    await user.click(within(share).getByRole("button", { name: "Share trip" }));

    // The shared trip opens on People to invite; the personal trip now points at it.
    expect(await screen.findByRole("button", { name: "Create invite code" })).toBeInTheDocument();
    const householdId = server.state.households[0]?.id ?? "";
    expect(server.state.households[0]).toMatchObject({ name: "Lisbon", trip: { startDate: "2026-11-12", endDate: "2026-11-19" } });
    await waitFor(() => {
      expect(ledgerTrips()[0]?.sharedHouseholdId).toBe(householdId);
    });
    // The private expense never went to the server's trip.
    expect(callsTo(fetchMock, `/api/households/${householdId}/expenses`).filter((init) => init?.method === "POST")).toHaveLength(0);

    await user.click(screen.getByRole("link", { name: "Expenses" }));
    const onlyYou = await screen.findByRole("region", { name: "Only you" });
    expect(within(onlyYou).getByText("Paid train")).toBeInTheDocument();
    expect(screen.getByText(/includes \$24\.00 only you can see/)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /All trips/ }));
    await screen.findByRole("heading", { level: 1, name: "Trips" });
    expect(screen.getAllByRole("heading", { level: 2, name: "Lisbon" })).toHaveLength(1);
    expect(screen.queryByText("Personal")).not.toBeInTheDocument();
  });

  it("creates a shared trip from New trip, and a member who joins later isn't in earlier expenses", async () => {
    serve();
    const user = userEvent.setup();
    const { unmount } = renderApp("/trips");
    await user.click(await screen.findByRole("button", { name: "New trip" }));
    const form = await dialog("New trip");
    await fillTrip(user, form, "Coast", "2026-11-01", "2026-11-03");
    await user.click(within(form).getByRole("switch", { name: "Share with others" }));
    expect(within(form).getByText(/A shared trip in CAD/)).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Create shared trip" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Coast" })).toBeInTheDocument();
    const id = server.state.households[0]?.id ?? "";
    expect(ledgerTrips()).toEqual([]);

    // Alex adds an expense before anyone joins; it is split among the members then (Alex only).
    server.handle(ALEX, "POST", `/api/households/${id}/expenses`, {
      title: "Cabin deposit",
      totalCents: 30000,
      payerUserId: server.userId(ALEX),
      splitMode: "equal",
      date: "2026-10-15",
      category: { name: "Home", icon: "home", color: "#C27C4E" },
    });
    const invite = server.handle(ALEX, "POST", `/api/households/${id}/invites`).body as { code: string };
    unmount();

    serve(BEA);
    renderApp("/trips");
    await user.click(await screen.findByRole("button", { name: "Join a trip" }));
    const join = await dialog("Join a trip");
    await user.type(within(join).getByLabelText("Invite code"), invite.code);
    await user.click(within(join).getByRole("button", { name: "Join trip" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Coast" })).toBeInTheDocument();
    const row = (await screen.findByText("Cabin deposit")).closest("a");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Not part of your share")).toBeInTheDocument();
    // Bea isn't the organizer: no Edit trip, no Invite.
    expect(screen.queryByRole("button", { name: "Edit trip" })).not.toBeInTheDocument();
  });

  it("lets the organizer change the dates without moving expenses, and keeps balances monthly", async () => {
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const trip = server.handle(ALEX, "POST", "/api/households/trips", { name: "Coast", currency: "CAD", startDate: "2026-11-01", endDate: "2026-11-03" }).body as { household: { id: string } };
    const id = trip.household.id;
    const invite = server.handle(ALEX, "POST", `/api/households/${id}/invites`).body as { code: string };
    server.handle(BEA, "POST", "/api/households/join", { code: invite.code });
    server.handle(ALEX, "POST", `/api/households/${id}/expenses`, {
      title: "Ferry",
      totalCents: 8000,
      payerUserId: server.userId(ALEX),
      splitMode: "equal",
      date: "2026-10-02",
      category: { name: "Home", icon: "home", color: "#C27C4E" },
    });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    serve();
    const user = userEvent.setup();
    renderApp(`/trips/${id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Coast" })).toBeInTheDocument();
    expect(await screen.findByText(/1 expense is dated outside the trip and still belongs to it/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const edit = await dialog("Edit shared trip");
    await setDate(user, within(edit).getByLabelText("Ends"), "2026-11-05");
    await user.click(within(edit).getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(server.state.households[0]?.trip).toEqual({ startDate: "2026-11-01", endDate: "2026-11-05" });
    });
    expect(await screen.findByText(/Thu, Nov 5, 2026/)).toBeInTheDocument();
    expect(server.state.expenses[0]?.date).toBe("2026-10-02");

    // Balances settle month by month: October has the ferry, the URL keeps the month.
    await user.click(screen.getByRole("link", { name: "Balances" }));
    expect(await screen.findByText(/A trip settles month by month/)).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Next month" }));
    expect(await within(screen.getByRole("navigation", { name: "Month" })).findByText("November 2026")).toBeInTheDocument();
  });

  it("opens a shared expense with ?expense= and sends a household id under /trips to the household", async () => {
    const trip = server.handle(ALEX, "POST", "/api/households/trips", { name: "Coast", currency: "CAD", startDate: "2026-11-01", endDate: "2026-11-03" }).body as { household: { id: string } };
    const expense = server.handle(ALEX, "POST", `/api/households/${trip.household.id}/expenses`, {
      title: "Ferry",
      totalCents: 8000,
      payerUserId: server.userId(ALEX),
      splitMode: "equal",
      date: "2026-10-02",
      category: { name: "Home", icon: "home", color: "#C27C4E" },
    }).body as { expense: { id: string } };
    const home = server.handle(ALEX, "POST", "/api/households", { name: "Maison", currency: "CAD" }).body as { household: { id: string } };
    serve();
    const user = userEvent.setup();
    const { router } = renderApp(`/trips/${trip.household.id}?expense=${expense.expense.id}`);
    const detail = await dialog("Ferry");
    await user.click(within(detail).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    await router.navigate({ to: "/trips/$id", params: { id: home.household.id } });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/households/${home.household.id}`);
    });
  });
});
