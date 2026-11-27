import type { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "../routeTree.gen";

export interface RouterContext {
  queryClient: QueryClient;
}

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    // Loaders use the Query cache, so the router's own cache never holds stale copies.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    ...(history ? { history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Page title for the top bar `<h1>` and the document title (MAZ-85 shell). */
    title?: string;
    /** Show the top bar's search field. Default true; Activity has its own. */
    search?: boolean;
    /** Show the top bar's Add entry button. Default true; the year in review has Share your year in its place (MAZ-292). The N shortcut still works. */
    add?: boolean;
    /** On phones, a back button to this page in the top bar (pages pushed from a tab, MAZ-221, MAZ-229). */
    back?: "/" | "/insights" | "/households" | "/trips" | "/settings";
    /** The back button's accessible name. Default "Back to Home". */
    backLabel?: string;
    /** Keep the back button from 768px too, before the title (card `web-household`). */
    backWide?: boolean;
  }
}
