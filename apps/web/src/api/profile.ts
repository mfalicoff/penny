import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./client";
import { sessionKey, userKey } from "./keys";
import { profileSchema, type Me, type Profile, type ProfileUpdate } from "./schemas";

/**
 * Display names and pictures (MAZ-171). The shell reads the summary from the session (`/me`);
 * Settings › Profile reads the full profile with what may be changed. A field the sign-in provider
 * sends is read only, and the server refuses a change with 403.
 */

export const DISPLAY_NAME_MAX = 60;

/** The server's picture rules: PNG, JPEG, WebP, HEIC or HEIF, 1 byte to 10 MiB. */
export const AVATAR_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export type AvatarMime = (typeof AVATAR_MIMES)[number];
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
export const AVATAR_ACCEPT = [...AVATAR_MIMES, ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"].join(",");

export const PROFILE_MESSAGES = {
  name: "Enter a name of 1 to 60 characters, without line breaks or control characters.",
  pictureType: "Choose a PNG, JPEG, HEIC or WebP picture up to 10 MB.",
  pictureFailed: "The picture didn't upload. Try again.",
  offline: "Penny can't reach the server. Check your connection, then try again.",
} as const;

/** Unicode control characters (Cc) and line and paragraph separators, as the server refuses them. */
const CONTROL = /[\p{Cc}\u2028\u2029]/u;
const TRIM = /^[\s\uFEFF\u00A0]+|[\s\uFEFF\u00A0]+$/g;

/** The server's name rule (`DisplayName.Normalize`): the trimmed name, or null with a reason in `PROFILE_MESSAGES.name`. */
export function normalizeDisplayName(value: string): string | null {
  const trimmed = value.replace(TRIM, "");
  return trimmed.length >= 1 && trimmed.length <= DISPLAY_NAME_MAX && !CONTROL.test(trimmed) ? trimmed : null;
}

/** Who to show for an account: the display name, else the email (the fallback the cards allow). */
export const shownName = (person: { displayName?: string | undefined; email: string }) => person.displayName ?? person.email;

export const profileQuery = (email: string) =>
  queryOptions({
    queryKey: userKey(email, "profile"),
    queryFn: ({ signal }) => apiFetch("/api/profile", profileSchema, { signal }),
    staleTime: 60_000,
  });

/** A changed profile updates the session summary too, so the sidebar and prompt follow at once. */
export function rememberProfile(queryClient: QueryClient, profile: Profile): void {
  queryClient.setQueryData(userKey(profile.email, "profile"), profile);
  queryClient.setQueryData<Me | null>(sessionKey, (session) =>
    session && session.email === profile.email
      ? { ...session, userId: profile.userId, displayName: profile.displayName, avatarUrl: profile.avatarUrl, needsName: profile.needsName }
      : session,
  );
  // Member lists carry names and pictures: refetch them so the household screens agree.
  void queryClient.invalidateQueries({ queryKey: userKey(profile.email, "households") });
}

export function updateProfile(update: ProfileUpdate, signal?: AbortSignal): Promise<Profile> {
  return apiFetch("/api/profile", profileSchema, { method: "PATCH", body: update, ...(signal ? { signal } : {}) });
}

export function removeAvatar(signal?: AbortSignal): Promise<Profile> {
  return apiFetch("/api/profile/avatar", profileSchema, { method: "DELETE", ...(signal ? { signal } : {}) });
}

/** The picture type of `file`: its browser type, or its extension when the browser leaves it blank. */
export function avatarMimeOf(file: Pick<File, "name" | "type">): AvatarMime | null {
  if ((AVATAR_MIMES as readonly string[]).includes(file.type)) return file.type as AvatarMime;
  if (file.type && file.type !== "application/octet-stream") return null;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  const byExtension: Record<string, AvatarMime> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };
  return extension ? (byExtension[extension] ?? null) : null;
}

/** `PUT /api/profile/avatar` with the picture as the body. The server crops, resizes and strips metadata. */
export async function uploadAvatar(picture: Blob, mime: AvatarMime, signal?: AbortSignal): Promise<Profile> {
  if (picture.size === 0 || picture.size > MAX_AVATAR_BYTES) throw new ApiError(400, PROFILE_MESSAGES.pictureType);
  let response: Response;
  try {
    response = await fetch("/api/profile/avatar", {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": mime },
      credentials: "same-origin",
      body: picture,
      signal: signal ?? null,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, PROFILE_MESSAGES.offline, { cause });
  }
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (!response.ok) {
    const message = typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : undefined;
    if (response.status === 413) throw new ApiError(413, PROFILE_MESSAGES.pictureType);
    throw new ApiError(response.status, message ?? PROFILE_MESSAGES.pictureFailed);
  }
  const parsed = profileSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(response.status, PROFILE_MESSAGES.pictureFailed, { cause: parsed.error });
  return parsed.data;
}
