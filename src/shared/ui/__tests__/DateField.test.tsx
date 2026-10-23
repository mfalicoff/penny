import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { DateField } from "../DateField";

test("the native picker selects a calendar date using the platform presentation", async () => {
  const onChange = jest.fn();
  await render(<DateField label="Start date" value="2026-10-04" onChange={onChange} />);
  await fireEvent.press(screen.getByRole("button", { name: "Start date" }));
  const picker = screen.getByTestId("system-date-picker");
  expect(picker.props.display).toBe(Platform.OS === "ios" ? "inline" : "default");
  await fireEvent(picker, "valueChange", {}, new Date(2026, 9, 12, 12));
  expect(onChange).toHaveBeenCalledWith("2026-10-12");
  if (Platform.OS === "ios") {
    expect(screen.getByTestId("system-date-picker")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Done choosing date" }));
  }
  expect(screen.queryByTestId("system-date-picker")).toBeNull();
});

test("dismissing the native picker leaves its date unchanged", async () => {
  const onChange = jest.fn();
  await render(<DateField label="End date" value="2026-10-04" onChange={onChange} />);
  await fireEvent.press(screen.getByRole("button", { name: "End date" }));
  await fireEvent(screen.getByTestId("system-date-picker"), "dismiss");
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "End date" }).props.accessibilityValue).toEqual({ text: "2026-10-04" });
});
