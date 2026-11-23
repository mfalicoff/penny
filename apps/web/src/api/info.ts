import { queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

/**
 * The operator's privacy policy: an absolute http(s) URL. Anything else (a `javascript:` URL, a
 * relative path) is dropped rather than linked, so a bad value never becomes a link.
 */
const policyUrlSchema = z
  .string()
  .max(2048)
  .nullish()
  .catch(null)
  .transform((value) => {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  });

/** `GET /api/info`: public, credential-free server identity (contracts/openapi.json). */
export const serverInfoSchema = z.object({
  name: z.literal("penny"),
  version: z.string().min(1).max(100),
  // Optional: servers older than this field don't send it, and then there's no link.
  privacyPolicyUrl: policyUrlSchema,
  // MAZ-124: whether the server sends email. Absent on older servers, and anything but a boolean, means no.
  emailEnabled: z.boolean().optional().catch(false),
});

export type ServerInfo = z.infer<typeof serverInfoSchema>;

export const serverInfoQuery = queryOptions({
  queryKey: ["server", "info"] as const,
  queryFn: ({ signal }) => apiFetch("/api/info", serverInfoSchema, { signal }),
  staleTime: 5 * 60_000,
});

/** The server's privacy policy URL (`Legal__PrivacyPolicyUrl`), or null while loading or when it publishes none. */
export function usePrivacyPolicyUrl(): string | null {
  return useQuery(serverInfoQuery).data?.privacyPolicyUrl ?? null;
}

/**
 * Whether the server sends email (MAZ-124): password reset by email and invitations by email.
 * False while loading, on older servers and when the server is off, so screens fall back to codes.
 */
export function useEmailEnabled(): boolean {
  return useQuery(serverInfoQuery).data?.emailEnabled === true;
}
