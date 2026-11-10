import { createRootRouteWithContext, Link, Outlet, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import type { RouterContext } from "../app/router";
import { AppShell } from "../app/shell/AppShell";
import { usePageTitle } from "../app/shell/pageTitle";
import { AuthGate } from "../auth/account";
import { Button } from "../design/controls";
import { EmptyState, ToastProvider } from "../design/states";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

/** Everything but the OIDC callback needs a signed-in account; the callback finishes sign-in itself. */
function RootLayout() {
  const isCallback = useRouterState({ select: (state) => state.location.pathname === "/auth/callback" });
  if (isCallback) return <Outlet />;
  return (
    <AuthGate>
      {/* Inside the gate, so a toast (and its Undo) never outlives the session it belongs to. */}
      <ToastProvider>
        <AppShell />
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
