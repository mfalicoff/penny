import { createRootRouteWithContext, Link, Outlet, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import type { RouterContext } from "../app/router";
import { AppShell } from "../app/shell/AppShell";
import { usePageTitle } from "../app/shell/pageTitle";
import { AuthGate } from "../auth/account";
import { Button } from "../design/controls";
import { EmptyState, ToastProvider } from "../design/states";
import { PendingJoin } from "../features/households/PendingJoin";
import { OfflineLedgerProvider } from "../offline/OfflineLedgerProvider";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

/**
 * Pages that work without an account: the OIDC callback finishes sign-in itself, and password
 * reset (MAZ-123, MAZ-124) is for people who can't sign in.
 */
const PUBLIC_PATHS = new Set(["/auth/callback", "/forgot-password", "/reset-password"]);

/** Everything but the public pages needs a signed-in account. */
function RootLayout() {
  const isPublic = useRouterState({ select: (state) => PUBLIC_PATHS.has(state.location.pathname) });
  if (isPublic) return <Outlet />;
  return (
    <AuthGate>
      {/* Inside the gate, so a toast (and its Undo) never outlives the session it belongs to. */}
      <ToastProvider>
        {/* The account's durable offline ledger (MAZ-87), one per signed-in account. */}
        <OfflineLedgerProvider>
          <AppShell />
          {/* An emailed invitation's code (MAZ-124) opens the join dialog once signed in. */}
          <PendingJoin />
        </OfflineLedgerProvider>
      </ToastProvider>
    </AuthGate>
  );
}

function NotFound() {
  usePageTitle("Page not found");
  return (
    <EmptyState
      icon="alert-circle"
      title="This address doesn't match a page in Penny"
      action={
        <Link to="/" className="wbtn wbtn--secondary">
          Go to Home
        </Link>
      }
    >
      <p>Check the link, or start again from Home.</p>
    </EmptyState>
  );
}

function RouteError({ reset }: ErrorComponentProps) {
  return (
    <div role="alert" className="state state--error">
      <h2 className="state__title">Something went wrong</h2>
      <p className="state__body">Penny couldn't show this page. Your saved data isn't affected.</p>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
