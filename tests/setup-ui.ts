// Font loading is native infrastructure; interaction tests exercise real controls.
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
