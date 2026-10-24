import { fireEvent, render, screen } from "@testing-library/react-native";
import { signIn } from "../../../data/api";
import { Auth } from "../AuthScreen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ServerConnectionProvider } from "../../../providers/ServerConnectionProvider";

jest.mock("../../../data/api", () => ({ signIn: jest.fn() }));
jest.mock("../OidcButton", () => ({ OidcButton: () => null }));

beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); });
afterEach(() => jest.restoreAllMocks());

test("switching servers discards the old server's credentials and registration draft", async () => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ name: "penny", version: "2.0.0" }) } as Response);
  await render(<ServerConnectionProvider><Auth onReady={jest.fn()} onDemo={jest.fn()} /></ServerConnectionProvider>);
  await fireEvent.changeText(screen.getByLabelText("Email"), "old@example.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "private old password");
  await fireEvent.press(screen.getByRole("button", { name: "New here? Create an account" }));
  await fireEvent.press(screen.getByRole("button", { name: "Change server" }));
  await fireEvent.changeText(screen.getByLabelText("Server URL"), "https://new.test");
  await fireEvent.press(screen.getByRole("button", { name: "Check server" }));
  await fireEvent.press(screen.getByRole("button", { name: "Use this server" }));
  expect(screen.getByLabelText("Email")).toHaveProp("value", "");
  expect(screen.getByLabelText("Password")).toHaveProp("value", "");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  expect(signIn).not.toHaveBeenCalled();
});

test("signs in with a trimmed email and keeps the password private", async () => {
  jest.mocked(signIn).mockResolvedValue("alex@example.com");
  const onReady = jest.fn();
  await render(<Auth onReady={onReady} onDemo={jest.fn()} />);
  expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(true);
  await fireEvent.changeText(screen.getByLabelText("Email"), "  alex@example.com  ");
  await fireEvent.changeText(screen.getByLabelText("Password"), "correct horse battery");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(signIn).toHaveBeenCalledWith("alex@example.com", "correct horse battery", false);
  expect(onReady).toHaveBeenCalledWith("alex@example.com");
});

test("registration uses the create-account flow", async () => {
  jest.mocked(signIn).mockResolvedValue("new@example.com");
  await render(<Auth onReady={jest.fn()} onDemo={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "New here? Create an account" }));
  expect(screen.getByText("Make yourself at home.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Email"), "new@example.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "long password");
  await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
  expect(signIn).toHaveBeenCalledWith("new@example.com", "long password", true);
});

test("failed sign-in shows an error and the user can retry or explore demo", async () => {
  jest.mocked(signIn).mockRejectedValueOnce(new Error("Wrong password")).mockResolvedValue("alex@example.com");
  const onReady = jest.fn();
  const onDemo = jest.fn();
  await render(<Auth onReady={onReady} onDemo={onDemo} />);
  await fireEvent.changeText(screen.getByLabelText("Email"), "alex@example.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "bad password");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByText("Wrong password")).toBeOnTheScreen();
  expect(onReady).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
  expect(onReady).toHaveBeenCalledWith("alex@example.com");
  await fireEvent.press(screen.getByRole("button", { name: "Take a look around with sample data" }));
  expect(onDemo).toHaveBeenCalledTimes(1);
});
