import { createRootRouteWithContext, Link, Outlet, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import type { RouterContext } from "../app/router";
import { ServerStatus } from "../app/ServerStatus";
import { AuthGate } from "../auth/account";
import { AccountMenu } from "../features/auth/SignOut";
import { Icon, type IconName } from "../design/Icon";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

const NAV: { to: "/" | "/transactions"; label: string; icon: IconName }[] = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/transactions", label: "Activity", icon: "list" },
];

/** Everything but the OIDC callback needs a signed-in account; the callback finishes sign-in itself. */
function RootLayout() {
  const isCallback = useRouterState({ select: (state) => state.location.pathname === "/auth/callback" });
  if (isCallback) return <Outlet />;
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Shell() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell__sidebar">
        <Link to="/" className="brand" aria-label="Penny home">
          <Icon name="leaf" size={24} weight={40} />
          <span>Penny</span>
        </Link>
        <nav aria-label="Main">
          <ul className="nav">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link to={item.to} activeOptions={{ exact: item.to === "/", includeSearch: false }}>
                  <Icon name={item.icon} size={20} />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ServerStatus />
        <AccountMenu />
      </header>
      <main id="main" className="shell__main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>
        This address doesn't match a page in Penny. <Link to="/">Go to Home</Link>
      </p>
    </>
  );
}

function RouteError({ reset }: ErrorComponentProps) {
  return (
    <div role="alert">
      <h1>Something went wrong</h1>
      <p>Penny couldn't show this page. Your saved data isn't affected.</p>
      <button type="button" className="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
