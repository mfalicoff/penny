import { useQuery } from "@tanstack/react-query";
import { createContext, use, type ReactNode } from "react";
import { sessionQuery } from "../api/auth";
import { sessionNoticeKey } from "../api/keys";
import { AuthScreen } from "../features/auth/AuthScreen";
import type { SessionNotice } from "./lifecycle";

const AccountContext = createContext<string | null>(null);

/** The signed-in account's email. Only callable below `AuthGate`. It scopes every private query key. */
export function useAccountEmail(): string {
  const email = use(AccountContext);
  if (email === null) throw new Error("useAccountEmail must be used inside a signed-in AuthGate");
  return email;
}

/** Why the user is looking at sign-in, when it isn't their own doing. */
export function useSessionNotice(): SessionNotice {
  const { data } = useQuery({
    queryKey: sessionNoticeKey,
    queryFn: () => null as SessionNotice,
    enabled: false,
    initialData: null as SessionNotice,
    staleTime: Infinity,
  });
  return data;
}

/**
 * Renders the app only for a signed-in account, and sign-in otherwise. Children are
 * unmounted the moment the session ends, so no screen keeps showing private data.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useQuery(sessionQuery);

  if (session.isPending) {
    return (
      <p className="gate-status" role="status">
        Checking your session…
      </p>
    );
  }
  if (session.data === undefined) {
    return (
      <div className="gate-status" role="alert">
        <h1>Penny can't reach the server</h1>
        <p>Your data is safe. Check your connection and try again.</p>
        <button type="button" className="button" onClick={() => void session.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (session.data === null) return <AuthScreen />;
  return <AccountContext value={session.data.email}>{children}</AccountContext>;
}
