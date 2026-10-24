import { act, fireEvent, render, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Text } from "react-native";
import { getServerUrl, normalizeServerUrl, defaultServerUrl } from "../../../../src/data/serverConnection";
import { ServerConnectionProvider } from "../../../../src/providers/ServerConnectionProvider";
import { ServerConnection } from "../../../../src/features/settings/ServerConnection";

beforeEach(async () => { await AsyncStorage.clear(); });
afterEach(() => jest.restoreAllMocks());
const renderConnection = (editable = true, disabled = false) => render(<ServerConnectionProvider>
  <ServerConnection editable={editable} disabled={disabled} />
</ServerConnectionProvider>);
const reply = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

test("checks identity and displays version before allowing a per-device server change", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(reply({ name: "penny", version: "2.4.1" }));
  await renderConnection();
  expect(screen.getByText(normalizeServerUrl(defaultServerUrl))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Change server" }));
  await fireEvent.changeText(screen.getByLabelText("Server URL"), "https://self-hosted.test/");
  expect(screen.queryByRole("button", { name: "Use this server" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Check server" }));
  expect(screen.getByText("Penny 2.4.1 · Server verified")).toBeOnTheScreen();
  expect(await getServerUrl()).toBe(normalizeServerUrl(defaultServerUrl));
  await fireEvent.press(screen.getByRole("button", { name: "Use this server" }));
  expect(await getServerUrl()).toBe("https://self-hosted.test");
  expect(screen.getByText("Penny 2.4.1")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Server URL")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("editing a verified URL invalidates the result and a failed check does not replace the server", async () => {
  jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply({ name: "penny", version: "1.0" }))
    .mockResolvedValueOnce(reply({ ok: true }));
  await renderConnection();
  await fireEvent.press(screen.getByRole("button", { name: "Change server" }));
  await fireEvent.changeText(screen.getByLabelText("Server URL"), "https://valid.test");
  await fireEvent.press(screen.getByRole("button", { name: "Check server" }));
  expect(screen.getByRole("button", { name: "Use this server" })).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Server URL"), "https://wrong.test");
  expect(screen.queryByRole("button", { name: "Use this server" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Check server" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/did not identify itself/);
  expect(await getServerUrl()).toBe(normalizeServerUrl(defaultServerUrl));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByLabelText("Server URL")).toBeNull();
});

test("signed-in settings show the address but require sign-out before switching", async () => {
  await renderConnection(false);
  expect(screen.getByText(/sync your entries and sign out first/)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Change server" })).toBeNull();
});

test("the server selector is locked during sign-in", async () => {
  await renderConnection(true, true);
  expect(screen.getByRole("button", { name: "Change server" })).toBeDisabled();
});

test("a failed device-setting read does not mount session children until retry succeeds", async () => {
  jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("Storage unavailable"));
  await render(<ServerConnectionProvider><Text>Session mounted</Text></ServerConnectionProvider>);
  expect(screen.queryByText("Session mounted")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByText("Session mounted")).toBeOnTheScreen();
});

test("a slow validation prevents duplicate requests and locks URL editing", async () => {
  let resolve!: (value: Response) => void;
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
  await renderConnection();
  await fireEvent.press(screen.getByRole("button", { name: "Change server" }));
  await fireEvent.changeText(screen.getByLabelText("Server URL"), "https://slow.test");
  await fireEvent.press(screen.getByRole("button", { name: "Check server" }));
  expect(screen.getByRole("button", { name: "Checking server…" })).toBeDisabled();
  expect(screen.getByLabelText("Server URL")).toHaveProp("editable", false);
  await act(async () => { resolve(reply({ name: "penny", version: "1.0" })); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Use this server" })).toBeEnabled();
});

test("failed persistence keeps the selected server and permits retry", async () => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue(reply({ name: "penny", version: "1.0" }));
  await renderConnection();
  await fireEvent.press(screen.getByRole("button", { name: "Change server" }));
  await fireEvent.changeText(screen.getByLabelText("Server URL"), "https://new.test");
  await fireEvent.press(screen.getByRole("button", { name: "Check server" }));
  jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("Disk full"));
  await fireEvent.press(screen.getByRole("button", { name: "Use this server" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/previous server is unchanged/);
  expect(await getServerUrl()).toBe(normalizeServerUrl(defaultServerUrl));
  await fireEvent.press(screen.getByRole("button", { name: "Use this server" }));
  expect(await getServerUrl()).toBe("https://new.test");
});
