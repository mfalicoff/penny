// Font loading is native infrastructure; interaction tests exercise real controls.
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

// Replace the native host view while retaining the date field's interaction logic.
jest.mock("@expo/ui/community/datetime-picker", () => {
  const { View } = jest.requireActual("react-native");
  return { DateTimePicker: (props: object) => jest.requireActual("react").createElement(View, { ...props, testID: "system-date-picker" }) };
});
