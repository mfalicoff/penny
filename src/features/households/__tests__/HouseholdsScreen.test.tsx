import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { createHousehold, joinHousehold } from "../../../data/households";
import HouseholdsScreen from "../HouseholdsScreen";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../../../providers/LedgerProvider", () => ({ useLedger: () => ({ ledger: { currency: "CAD" }, demo: false }) }));
jest.mock("../../../providers/HouseholdProvider", () => ({ useHouseholds: () => ({ households: [], loading: false, error: "", refresh: jest.fn() }) }));
jest.mock("../../../data/households", () => ({ createHousehold: jest.fn(), joinHousehold: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test("creating a household uses the personal ledger currency and opens the new household", async () => {
  jest.mocked(createHousehold).mockResolvedValue({ household: { id: "home", name: "Family", currency: "CAD", creatorId: "alice", createdAt: 1, memberCount: 1 } });
  await render(<HouseholdsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Create household" }));
  await fireEvent.changeText(screen.getByLabelText("Household name"), "  Family  ");
  await fireEvent.press(screen.getAllByRole("button", { name: "Create household" }).at(-1)!);
  await waitFor(() => expect(createHousehold).toHaveBeenCalledWith("Family", "CAD"));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith("/households/home"));
});

test("an invalid invitation keeps the code for correction", async () => {
  jest.mocked(joinHousehold).mockRejectedValue(new Error("Code expired."));
  await render(<HouseholdsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Join with code" }));
  await fireEvent.changeText(screen.getByLabelText("Invitation code"), "abcd12");
  await fireEvent.press(screen.getByRole("button", { name: "Join household" }));
  await waitFor(() => expect(joinHousehold).toHaveBeenCalledWith("ABCD12"));
  expect(screen.getByText("Code expired.")).toBeOnTheScreen();
  expect(screen.getByLabelText("Invitation code")).toHaveDisplayValue("abcd12");
});
