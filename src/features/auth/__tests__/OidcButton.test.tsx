import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as oidc from "../../../data/oidc";
import { OidcButton } from "../OidcButton";

jest.mock("../../../data/oidc", () => ({ oidcConfiguration: jest.fn(), prepareOidc: jest.fn(), signInOidc: jest.fn() }));
const attempt = { transaction: "secret", authorizationUrl: "https://id.test/authorize", expiresAt: Date.now() + 600000 };
beforeEach(() => {
  jest.mocked(oidc.oidcConfiguration).mockResolvedValue({ enabled: true, label: "My identity provider" });
  jest.mocked(oidc.prepareOidc).mockResolvedValue(attempt);
});

test("hides OIDC when the server has no provider", async () => {
  jest.mocked(oidc.oidcConfiguration).mockResolvedValue({ enabled: false });
  await render(<OidcButton onReady={jest.fn()} busy={false} onBusy={jest.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(oidc.prepareOidc).not.toHaveBeenCalled();
});

test("prepares before pressing, starts sign-in and forwards the established session", async () => {
  jest.mocked(oidc.signInOidc).mockResolvedValue("person@example.test");
  const onReady = jest.fn(); const onBusy = jest.fn();
  await render(<OidcButton onReady={onReady} busy={false} onBusy={onBusy} />);
  const button = await screen.findByRole("button", { name: "Continue with My identity provider" });
  await waitFor(() => expect(button).toBeEnabled());
  expect(oidc.signInOidc).not.toHaveBeenCalled();
  await fireEvent.press(button);
  expect(oidc.signInOidc).toHaveBeenCalledWith(attempt);
  expect(onReady).toHaveBeenCalledWith("person@example.test");
  expect(onBusy).toHaveBeenCalledWith(true);
  expect(onBusy).toHaveBeenLastCalledWith(false);
});

test("cancellation preserves the login screen and prepares a fresh attempt", async () => {
  jest.mocked(oidc.signInOidc).mockResolvedValue(null);
  const onReady = jest.fn();
  await render(<OidcButton onReady={onReady} busy={false} onBusy={jest.fn()} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Continue with My identity provider" }));
  expect(onReady).not.toHaveBeenCalled();
  expect(oidc.prepareOidc).toHaveBeenCalledTimes(2);
});

test("provider setup failures show an actionable retry", async () => {
  jest.mocked(oidc.prepareOidc).mockRejectedValueOnce(new Error("Provider unavailable"));
  await render(<OidcButton onReady={jest.fn()} busy={false} onBusy={jest.fn()} />);
  expect(await screen.findByText("Provider unavailable")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry single sign-on" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue with My identity provider" })).toBeEnabled());
});
