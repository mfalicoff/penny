import { recipientFetcher, handleEmail, type Env } from "./handler.ts";
import { RecipientList } from "./recipients.ts";

// The Worker entry module (MAZ-184): only the default export. workerd treats every named
// export here as an entrypoint, so the logic and its constants live in handler.ts.

// One list per isolate, created on the first message.
let isolateList: RecipientList | undefined;

export default {
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
