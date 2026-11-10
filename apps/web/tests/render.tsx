import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { vi } from "vitest";
import { App } from "../src/app/App";
import { createQueryClient } from "../src/app/queryClient";
import { createAppRouter } from "../src/app/router";

export type FetchHandler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(input instanceof Request ? input.url : String(input), init)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const ALEX = "alex@example.test";
export const emptySearch = { version: 1, items: [], totalCount: 0, nextCursor: null };

type Override = (url: string, init: RequestInit | undefined) => Response | Promise<Response> | undefined;

/** A signed-in server: identity, info and an empty search. `override` answers first; returning undefined falls through. */
export function stubServer(override?: Override) {
  return stubFetch(async (url, init) => {
    const custom = await override?.(url, init);
    if (custom) return custom;
    if (url === "/api/info") return json({ name: "penny", version: "2.0.0-test" });
    if (url === "/api/auth/me") return json({ email: ALEX });
    if (url === "/api/auth/oidc") return json({ enabled: false });
    if (url === "/api/ledger") return json({ revision: 0, ledger: { currency: "CAD" } });
    if (url === "/api/v1/search/transactions") return json(emptySearch);
    return json({ error: "Not found." }, 404);
  });
}

type FetchMock = ReturnType<typeof stubFetch>;

const urlOf = (input: RequestInfo | URL) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/** Every recorded request to `url`, as its init. */
export const callsTo = (fetchMock: FetchMock, url: string) =>
  fetchMock.mock.calls.filter(([input]) => urlOf(input) === url).map(([, init]) => init);

/** Whether any request went to `url`. */
export const wasCalled = (fetchMock: FetchMock, url: string) => callsTo(fetchMock, url).length > 0;

/** Parsed JSON body of a recorded request. */
export function bodyOf(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
}

/** Renders the real app (router + Query) at `path` with in-memory history. */
export function renderApp(path: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(queryClient, history);
  const view = render(<App queryClient={queryClient} router={router} />);
  return { ...view, router, history, queryClient };
}

/** Sign-out lives in Settings › Account: open Settings from the sidebar, then press Sign out. */
export async function openSignOut(user: UserEvent) {
  await user.click(await screen.findByRole("link", { name: "Settings" }));
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
}
