import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
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

/** Renders the real app (router + Query) at `path` with in-memory history. */
export function renderApp(path: string) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(queryClient, history);
  const view = render(<App queryClient={queryClient} router={router} />);
  return { ...view, router, history, queryClient };
}
