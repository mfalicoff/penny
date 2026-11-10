import type { z } from "zod";

/**
 * A failed call to the Penny API. `status` is the HTTP status (0 when the request
 * never reached the server); `message` is the API's `{ error }` text when present.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
  }

  /** Client errors are final: retrying the same request cannot succeed. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Where requests go. Normally the network; the temporary demo (src/demo) swaps in an in-memory
 * server so nothing it does reaches, or is read from, the real API.
 */
export type Transport = (path: `/api/${string}`, request: { method: string; body: unknown; signal: AbortSignal | null }) => Promise<Response>;

let transport: Transport | null = null;

/** Routes every request to `next` instead of the network, or back to the network with `null`. */
export function setTransport(next: Transport | null): void {
  transport = next;
}

const errorBody = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "error" in value && typeof value.error === "string"
    ? value.error
    : undefined;

/**
 * Calls the .NET API on the page's own origin. Paths must start with `/api/`: the
 * browser never knows a server URL, and the session cookie stays same-origin.
 * Every response body is validated against `schema` before it reaches the UI.
 */
export async function apiFetch<Schema extends z.ZodType>(
  path: `/api/${string}`,
  schema: Schema,
  init: ApiRequestInit = {},
): Promise<z.infer<Schema>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = transport
      ? await transport(path, { method: init.method ?? "GET", body: init.body, signal: init.signal ?? null })
      : await fetch(path, {
          method: init.method ?? "GET",
          headers,
          credentials: "same-origin",
          body: init.body === undefined ? null : JSON.stringify(init.body),
          signal: init.signal ?? null,
        });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, "Penny can't reach the server.", { cause });
  }

  const text = await response.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, errorBody(json) ?? `Request failed (${response.status}).`);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(response.status, "The server sent a response Penny doesn't understand.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
