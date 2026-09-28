// Font loading is native infrastructure; interaction tests exercise real controls.
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

// Push delivery is native infrastructure; screen tests exercise app behavior without a device token.
jest.mock("../src/providers/PushRegistration", () => ({
  PushRegistration: () => null,
  unregisterPushForLogout: jest.fn().mockResolvedValue(undefined),
}));

// Replace the native host view while retaining the date field's interaction logic.
jest.mock("@expo/ui/community/datetime-picker", () => {
  const { View } = jest.requireActual("react-native");
  return { DateTimePicker: (props: object) => jest.requireActual("react").createElement(View, { ...props, testID: "system-date-picker" }) };
});
