import { render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import NewExpenseRoute from "../../app/entries/new";

const mockSetForm = jest.fn();
jest.mock("../../providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({ setForm: mockSetForm }),
}));
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));

test("the widget expense link opens a blank entry and returns to overview", async () => {
  await render(<NewExpenseRoute />);
  await waitFor(() => {
    expect(mockSetForm).toHaveBeenCalledWith({});
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});
