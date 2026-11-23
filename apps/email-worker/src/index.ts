import { recipientFetcher, handleEmail, type Env } from "./handler.ts";
import { RecipientList } from "./recipients.ts";

// The Worker entry module (MAZ-184): only the default export. workerd treats every named
// export here as an entrypoint, so the logic and its constants live in handler.ts.

// One list per isolate, created on the first message.
let isolateList: RecipientList | undefined;

// workerd needs a fetch handler to answer HTTP: without one, opening the local Worker's URL
// (as the Aspire dashboard does) shows "Handler does not export a fetch() function". It
// answers 404 and never reads env or the recipient list. It is unreachable in production:
// wrangler.toml sets workers_dev = false and defines no routes, so only Email Routing
// invokes this Worker.
const notFound = "Penny's email worker accepts mail only. Locally: POST /cdn-cgi/handler/email?from=…&to=…\n";

export default {
  fetch(): Response {
    return new Response(notFound, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const deps = { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init), now: () => Date.now() };
    isolateList ??= new RecipientList({
      ttlMs: Number(env.RECIPIENT_LIST_TTL_SECONDS ?? "60") * 1000,
      now: deps.now,
      fetchList: recipientFetcher(env, deps),
    });
    await handleEmail(message, env, { ...deps, recipients: isolateList });
  },
} satisfies ExportedHandler<Env>;
