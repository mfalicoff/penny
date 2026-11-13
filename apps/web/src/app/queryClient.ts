import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { sessionKey } from "../api/keys";
import { expireSession } from "../auth/lifecycle";

const MAX_RETRIES = 2;

/** Retry network and server failures a couple of times; never retry 4xx responses. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.isClientError) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  // Any 401 from a private request while signed in means the session ended. Sign-in
  // calls are exempt: their 401 is "wrong password", and the session query handles its own.
  const onUnauthorized = (error: unknown, isAuthRequest: boolean) => {
    if (isAuthRequest || !(error instanceof ApiError) || error.status !== 401) return;
    if (queryClient.getQueryData(sessionKey)) void expireSession(queryClient);
  };

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        onUnauthorized(error, query.queryKey[0] === "session");
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        onUnauthorized(error, mutation.options.mutationKey?.[0] === "auth");
      },
    }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
  return queryClient;
}
