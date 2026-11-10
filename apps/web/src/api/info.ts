import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

/** `GET /api/info`: public, credential-free server identity (contracts/openapi.json). */
export const serverInfoSchema = z.object({
  name: z.literal("penny"),
  version: z.string().min(1).max(100),
});

export type ServerInfo = z.infer<typeof serverInfoSchema>;

export const serverInfoQuery = queryOptions({
  queryKey: ["server", "info"] as const,
  queryFn: ({ signal }) => apiFetch("/api/info", serverInfoSchema, { signal }),
  staleTime: 5 * 60_000,
});
