import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { createSharedTrip, joinHousehold } from "../../../data/households";
import TripsScreen from "../TripsScreen";

const mockRefresh = jest.fn();
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../../../providers/LedgerProvider", () => ({ useLedger: () => ({ ledger: { trips: [], transactions: [], currency: "CAD" }, demo: false, commit: jest.fn() }) }));
jest.mock("../../../providers/HouseholdProvider", () => ({ useHouseholds: () => ({ households: [], refresh: mockRefresh }) }));
jest.mock("../../../data/households", () => ({ createSharedTrip: jest.fn(), joinHousehold: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test("creates a trip people can join and opens its shared detail", async () => {
  jest.mocked(createSharedTrip).mockResolvedValue({ household: {
    id: "coast", name: "Coast", currency: "CAD", creatorId: "alex", createdAt: 1, memberCount: 1,
    trip: { startDate: "2026-10-04", endDate: "2026-10-04" },
  } });
  await render(<TripsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Create shared trip" }));
  await fireEvent.changeText(screen.getByLabelText("Trip name"), "  Coast  ");
  await fireEvent.press(screen.getAllByRole("button", { name: "Create shared trip" }).at(-1)!);
  await waitFor(() => expect(createSharedTrip).toHaveBeenCalledWith("Coast", "CAD", expect.any(String), expect.any(String)));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: "/trips/[id]", params: { id: "coast" } }));
  expect(mockRefresh).toHaveBeenCalled();
});

test("joins a shared trip through an invitation code", async () => {
  jest.mocked(joinHousehold).mockResolvedValue({ household: {
    id: "coast", name: "Coast", currency: "CAD", creatorId: "alex", createdAt: 1, memberCount: 2,
    trip: { startDate: "2026-11-01", endDate: "2026-11-08" },
  } });
  await render(<TripsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Join trip" }));
  await fireEvent.changeText(screen.getByLabelText("Invitation code"), "abc123def0");
  await fireEvent.press(screen.getAllByRole("button", { name: "Join trip" }).at(-1)!);
  await waitFor(() => expect(joinHousehold).toHaveBeenCalledWith("ABC123DEF0"));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: "/trips/[id]", params: { id: "coast" } }));
});
