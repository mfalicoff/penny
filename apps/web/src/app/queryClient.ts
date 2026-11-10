import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";

const MAX_RETRIES = 2;

/** Retry network and server failures a couple of times; never retry 4xx responses. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.isClientError) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}
