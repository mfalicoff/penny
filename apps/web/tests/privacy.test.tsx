import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serverInfoSchema } from "../src/api/info";
import { ALEX, json, renderApp, stubServer } from "./render";

const POLICY = "https://penny.example.com/privacy";

/** A server whose /api/info publishes `privacyPolicyUrl` (omitted when undefined); signed out unless `signedIn`. */
function server(privacyPolicyUrl: string | null | undefined, signedIn = false) {
  return stubServer((url) => {
    if (url === "/api/info") return json({ name: "penny", version: "2.0.0-test", ...(privacyPolicyUrl === undefined ? {} : { privacyPolicyUrl }) });
    if (url === "/api/auth/me" && !signedIn) return json({ error: "Please sign in to continue." }, 401);
    // Settings › Profile loads the profile before it renders its sections and the footer.
    if (url === "/api/profile" && signedIn) {
      return json({ userId: "u".repeat(32), email: ALEX, nameEditable: true, avatarEditable: true, needsName: false, signIn: "password" });
    }
    return undefined;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

function expectPolicyLink(link: HTMLElement) {
  expect(link).toHaveAttribute("href", POLICY);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
}

describe("privacy policy link", () => {
  it("links the server's policy from sign-in, in a new tab", async () => {
    server(POLICY);
    renderApp("/");
    const link = await screen.findByRole("link", { name: "Privacy Policy (opens in a new tab)" });
    expectPolicyLink(link);
    // The demo button's description stays the sample-data note alone.
    const demo = screen.getByRole("button", { name: "Take a look around with sample data" });
    expect(demo).toHaveAccessibleDescription("Sample data in this tab only. Nothing is saved or sent to your server.");
  });

  it("says that creating an account agrees to the policy (web-create-account)", async () => {
    const user = userEvent.setup();
    server(POLICY);
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Create an account" }));
    const line = await screen.findByText((_, element) => element?.tagName === "P" && element.textContent === "By creating an account you agree to the Privacy Policy.");
    expect(line.tagName).toBe("P");
    expectPolicyLink(within(line).getByRole("link", { name: "Privacy Policy (opens in a new tab)" }));
  });

  it("shows no link when the server publishes no policy, or is older than the setting", async () => {
    const user = userEvent.setup();
    for (const value of [null, undefined]) {
      server(value);
      const view = renderApp("/");
      await screen.findByRole("button", { name: "Sign in" });
      await user.click(screen.getByRole("button", { name: "Create an account" }));
      await screen.findByRole("button", { name: "Create account" });
      expect(screen.queryByRole("link", { name: /Privacy Policy/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/By creating an account/)).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("puts the policy in Settings › Profile's footer, beside the server the account lives on", async () => {
    server(POLICY, true);
    renderApp("/settings/profile");
    const link = await screen.findByRole("link", { name: "Privacy Policy (opens in a new tab)" });
    expectPolicyLink(link);
    expect(link.closest("p")).toHaveTextContent(`Your account lives on ${window.location.host}. Privacy Policy`);
  });

  it("never links anything but an http or https URL", () => {
    const parse = (privacyPolicyUrl: unknown) => serverInfoSchema.parse({ name: "penny", version: "1", privacyPolicyUrl }).privacyPolicyUrl;
    expect(parse(POLICY)).toBe(POLICY);
    expect(parse("http://penny.lan:8080/privacy")).toBe("http://penny.lan:8080/privacy");
    expect(parse("javascript:alert(1)")).toBeNull();
    expect(parse("/privacy")).toBeNull();
    expect(parse(42)).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse(undefined)).toBeNull();
  });
});
