import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeDisplayName, shownName } from "../src/api/profile";
import { people } from "../src/features/households/model";
import { initials } from "../src/design/controls";
import { clampCrop, cropRect } from "../src/features/settings/PictureCropDialog";
import { ALEX, bodyOf, callsTo, json, renderApp, stubServer } from "./render";

// MAZ-171: display names and pictures on the web.

const USER_ID = "u".repeat(32);
const AVATAR = `/api/users/${USER_ID}/avatar?v=${"a".repeat(32)}`;

const profile = (overrides: Record<string, unknown> = {}) => ({
  userId: USER_ID,
  email: ALEX,
  nameEditable: true,
  avatarEditable: true,
  needsName: false,
  signIn: "password",
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("display name rules", () => {
  it("trims and accepts 1 to 60 characters without control characters, as the server does", () => {
    expect(normalizeDisplayName("  Alex Martin\u00A0")).toBe("Alex Martin");
    expect(normalizeDisplayName("x".repeat(60))).toBe("x".repeat(60));
    expect(normalizeDisplayName("x".repeat(61))).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName("Line\nbreak")).toBeNull();
    expect(normalizeDisplayName("Separator\u2028here")).toBeNull();
  });

  it("falls back to the email without a name, and takes initials from the name", () => {
    expect(shownName({ email: ALEX })).toBe(ALEX);
    expect(shownName({ email: ALEX, displayName: "Alex Martin" })).toBe("Alex Martin");
    expect(initials("Alex Martin")).toBe("AM");
    expect(initials(ALEX)).toBe("AL");
  });

  it("names household members by display name, else email, and shows their pictures", () => {
    const detail = {
      household: { id: "h", name: "Home", currency: "CAD" as const, creatorId: "me", createdAt: 0, memberCount: 3 },
      members: [
        { userId: "me", email: ALEX, joinedAt: 0, displayName: "Alex Martin", avatarUrl: AVATAR },
        { userId: "bea", email: "bea@example.test", joinedAt: 0, displayName: "Béa Tremblay" },
        { userId: "cam", email: "cam@example.test", joinedAt: 0 },
      ],
    };
    const who = people(detail, ALEX);
    expect(who.name("me")).toBe("You");
    expect(who.avatar("me")).toBe("Alex Martin");
    expect(who.picture("me")).toBe(AVATAR);
    expect(who.name("bea")).toBe("Béa Tremblay");
    expect(who.picture("bea")).toBeUndefined();
    expect(who.name("cam")).toBe("cam@example.test");
    expect(who.name("gone")).toBe("Former member");
  });
});

describe("picture crop", () => {
  it("keeps the picture covering the square and maps the view to source pixels", () => {
    // A 2000×1000 picture in a 200px square: the height fills it at zoom 1.
    const clamped = clampCrop({ zoom: 1, x: 500, y: 40 }, 2000, 1000, 200);
    expect(clamped).toEqual({ zoom: 1, x: 100, y: 0 });
    expect(cropRect(clamped, 2000, 1000, 200)).toEqual({ x: 0, y: 0, size: 1000 });
    const centred = cropRect({ zoom: 2, x: 0, y: 0 }, 2000, 1000, 200);
    expect(centred).toEqual({ x: 750, y: 250, size: 500 });
    expect(clampCrop({ zoom: 9, x: 0, y: 0 }, 2000, 1000, 200).zoom).toBe(4);
  });
});

describe("the shell", () => {
  it("names the account by its display name with its picture, else its email", async () => {
    stubServer((url) => (url === "/api/auth/me" ? json({ email: ALEX, userId: USER_ID, displayName: "Alex Martin", avatarUrl: AVATAR, needsName: false }) : undefined));
    renderApp("/");
    const sidebar = await screen.findByRole("complementary", { name: "Penny" });
    expect(await within(sidebar).findByText("Alex Martin")).toBeInTheDocument();
    expect(sidebar.querySelector(`img[src="${AVATAR}"]`)).not.toBeNull();
  });

  it("asks for a name once, and Not now stops asking", async () => {
    const fetchMock = stubServer((url) => {
      if (url === "/api/auth/me") return json({ email: ALEX, userId: USER_ID, needsName: true });
      if (url === "/api/profile") return json(profile());
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/");
    const prompt = await screen.findByRole("dialog", { name: "What should people call you?" });
    expect(within(prompt).getByText(ALEX)).toBeInTheDocument();
    await user.click(within(prompt).getByRole("button", { name: "Not now" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "What should people call you?" })).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, "/api/profile").map(bodyOf)).toEqual([{ namePromptDismissed: true }]);
  });

  it("saves the name from the prompt and shows it at once", async () => {
    const fetchMock = stubServer((url) => {
      if (url === "/api/auth/me") return json({ email: ALEX, userId: USER_ID, needsName: true });
      if (url === "/api/profile") return json(profile({ displayName: "Alex Martin" }));
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/");
    const prompt = await screen.findByRole("dialog", { name: "What should people call you?" });
    await user.click(within(prompt).getByRole("button", { name: "Save name" }));
    expect(within(prompt).getByRole("alert")).toHaveTextContent("Enter a name of 1 to 60 characters");
    await user.type(within(prompt).getByLabelText("Name"), "  Alex Martin ");
    await user.click(within(prompt).getByRole("button", { name: "Save name" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "What should people call you?" })).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, "/api/profile").map(bodyOf)).toEqual([{ displayName: "Alex Martin" }]);
    expect(await within(screen.getByRole("complementary", { name: "Penny" })).findByText("Alex Martin")).toBeInTheDocument();
  });
});

describe("Settings › Profile", () => {
  it("changes and clears the name of a password account", async () => {
    let current = profile({ displayName: "Alex" });
    const fetchMock = stubServer((url, init) => {
      if (url === "/api/profile") {
        if (init?.method === "PATCH") {
          const { displayName } = bodyOf(init) as { displayName: string | null };
          current = profile(displayName ? { displayName } : {});
        }
        return json(current);
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/settings/profile");
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Alex");
    expect(name).toHaveAccessibleDescription(/People in your households and trips see your name and picture/);
    await user.clear(name);
    await user.type(name, "Alex Martin{Enter}");
    expect(await screen.findByText("Name saved")).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, "{Enter}");
    expect(await screen.findByText("Name removed")).toBeInTheDocument();
    expect(
      callsTo(fetchMock, "/api/profile")
        .filter((init) => init?.method === "PATCH")
        .map(bodyOf),
    ).toEqual([{ displayName: "Alex Martin" }, { displayName: null }]);
    expect(screen.getByText("Email and password")).toBeInTheDocument();
  });

  it("refuses a name that breaks the rules without sending it", async () => {
    const fetchMock = stubServer((url) => (url === "/api/profile" ? json(profile()) : undefined));
    const user = userEvent.setup();
    renderApp("/settings/profile");
    await user.type(await screen.findByLabelText("Name"), `${"x".repeat(61)}{Enter}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name of 1 to 60 characters");
    expect(callsTo(fetchMock, "/api/profile").filter((init) => init?.method === "PATCH")).toHaveLength(0);
  });

  it("removes the picture, so initials show", async () => {
    let current = profile({ displayName: "Alex Martin", avatarUrl: AVATAR });
    const fetchMock = stubServer((url, init) => {
      if (url === "/api/profile") return json(current);
      if (url === "/api/profile/avatar" && init?.method === "DELETE") {
        current = profile({ displayName: "Alex Martin" });
        return json(current);
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/settings/profile");
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Picture removed")).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/profile/avatar")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("refuses a file that isn't a supported picture before uploading", async () => {
    const fetchMock = stubServer((url) => (url === "/api/profile" ? json(profile()) : undefined));
    const user = userEvent.setup({ applyAccept: false });
    renderApp("/settings/profile");
    await screen.findByLabelText("Name");
    await user.upload(screen.getByTestId("profile-picture-input"), new File(["%PDF-1.7"], "statement.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a PNG, JPEG, HEIC or WebP picture up to 10 MB.");
    expect(callsTo(fetchMock, "/api/profile/avatar")).toHaveLength(0);
  });

  it("shows a provider's name and picture as read only, with no picture buttons", async () => {
    stubServer((url) =>
      url === "/api/profile"
        ? json(profile({ displayName: "Grace Hopper", avatarUrl: AVATAR, nameEditable: false, avatarEditable: false, signIn: "oidc", provider: "Authentik" }))
        : undefined,
    );
    renderApp("/settings/profile");
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Grace Hopper");
    expect(name).toHaveAttribute("readonly");
    expect(name).toHaveAccessibleDescription(/Authentik manages your name and picture\. Penny updates them each time you sign in/);
    expect(screen.queryByRole("button", { name: /picture/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.getByText(/You sign in to Penny with Authentik\. Your account has no password\./)).toBeInTheDocument();
  });

  it("says “your sign-in provider” when the server has no name for it", async () => {
    stubServer((url) => (url === "/api/profile" ? json(profile({ displayName: "Grace Hopper", nameEditable: false, signIn: "oidc" })) : undefined));
    renderApp("/settings/profile");
    expect(await screen.findByLabelText("Name")).toHaveAccessibleDescription(/^Your sign-in provider manages your name\./);
  });
});

describe("Change password", () => {
  it("shows when the password last changed and changes it, keeping this session", async () => {
    const changedAt = new Date(2026, 9, 3, 12).getTime();
    let current = profile({ displayName: "Alex Martin" });
    const fetchMock = stubServer((url, init) => {
      if (url === "/api/profile") return json(current);
      if (url === "/api/auth/password") {
        const body = bodyOf(init) as { currentPassword: string; newPassword: string };
        if (body.currentPassword !== "correct horse battery") return json({ error: "Your current password is incorrect." }, 400);
        current = profile({ displayName: "Alex Martin", passwordChangedAt: changedAt });
        return json({ ok: true });
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/settings/profile");
    await user.click(await screen.findByRole("button", { name: /Change password/ }));
    const dialog = await screen.findByRole("dialog", { name: "Change password" });
    await user.type(within(dialog).getByLabelText("Current password"), "wrong password!");
    await user.type(within(dialog).getByLabelText("New password"), "short");
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(within(dialog).getByText("Use a new password of 10 to 256 characters.")).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/auth/password")).toHaveLength(0);
    await user.clear(within(dialog).getByLabelText("New password"));
    await user.type(within(dialog).getByLabelText("New password"), "a brand new password");
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByText("Your current password is incorrect.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Current password")).toHaveFocus();
    await user.type(within(dialog).getByLabelText("Current password"), "correct horse battery");
    await user.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Change password" })).not.toBeInTheDocument();
    expect(await screen.findByText("Changed Oct 3")).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/auth/password").map(bodyOf).at(-1)).toEqual({ currentPassword: "correct horse battery", newPassword: "a brand new password" });
  });

  it("isn't offered to an account that signs in with a provider", async () => {
    stubServer((url) => (url === "/api/profile" ? json(profile({ displayName: "Grace Hopper", nameEditable: false, signIn: "oidc", provider: "Authentik" })) : undefined));
    renderApp("/settings/profile");
    await screen.findByLabelText("Name");
    expect(screen.queryByRole("button", { name: /Change password/ })).not.toBeInTheDocument();
  });
});

describe("sign-up", () => {
  it("asks for a name and sends it with the credentials", async () => {
    let signedIn = false;
    const fetchMock = stubServer((url) => {
      if (url === "/api/auth/me") return signedIn ? json({ email: "new@example.test", userId: USER_ID, displayName: "New Person", needsName: false }) : json({ error: "Please sign in to continue." }, 401);
      if (url === "/api/auth/register") {
        signedIn = true;
        return json({ token: "t".repeat(64), email: "new@example.test" }, 201);
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Email"), "new@example.test");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(callsTo(fetchMock, "/api/auth/register")).toHaveLength(0);
    await user.type(screen.getByLabelText("Name"), " New Person ");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/auth/register").map(bodyOf)).toEqual([{ email: "new@example.test", password: "correct horse battery", displayName: "New Person" }]);
    expect(await within(screen.getByRole("complementary", { name: "Penny" })).findByText("New Person")).toBeInTheDocument();
  });
});
