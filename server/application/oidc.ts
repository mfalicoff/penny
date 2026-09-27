import { z } from "zod";
import { ApplicationError } from "./errors.ts";
import type { AuthService } from "./auth.ts";
import type { Security, OidcOptions, OidcProvider } from "./ports.ts";

const completeSchema = z.object({ transaction: z.string().regex(/^[a-f0-9]{64}$/), callbackUrl: z.string().max(8192) });
const lifetime = 10 * 60 * 1000;

export function createOidcService(options: OidcOptions, provider: OidcProvider, auth: AuthService, security: Security, now = Date.now) {
  // Short-lived secrets stay on the server and in the initiating app's memory, never in redirect URLs.
  const pending = new Map<string, { redirectUri: string; state: string; nonce: string; verifier: string; expires: number }>();
  return {
    label: options.label || "Single sign-on",
    async start(body: unknown) {
      const input = z.object({ redirectUri: z.string() }).safeParse(body);
      if (!input.success || !options.redirectUris.includes(input.data.redirectUri)) {
        throw new ApplicationError("invalid", "This sign-in redirect is not configured on the server.");
      }
      for (const [key, value] of pending) if (value.expires <= now()) pending.delete(key);
      if (pending.size >= 1000) throw new ApplicationError("forbidden", "Too many sign-in attempts. Try again later.");
      const transaction = security.randomId(32);
      const attempt = { redirectUri: input.data.redirectUri, state: security.randomId(32), nonce: security.randomId(32), verifier: security.randomId(32), expires: now() + lifetime };
      pending.set(security.hashToken(transaction), attempt);
      try {
        const authorizationUrl = await provider.authorize(attempt.redirectUri, attempt.state, attempt.nonce, attempt.verifier);
        return { transaction, authorizationUrl, expiresAt: attempt.expires };
      } catch {
        pending.delete(security.hashToken(transaction));
        throw new ApplicationError("invalid", "The sign-in provider is unavailable. Please try again.");
      }
    },
    async complete(body: unknown) {
      const input = completeSchema.safeParse(body);
      if (!input.success) throw new ApplicationError("invalid", "Invalid sign-in response.");
      const key = security.hashToken(input.data.transaction);
      const attempt = pending.get(key);
      pending.delete(key); // Consume before asynchronous exchange to reject replay and concurrent redemption.
      if (!attempt || attempt.expires <= now()) throw new ApplicationError("unauthorized", "Sign-in expired. Please try again.");
      let identity;
      try {
        const callback = new URL(input.data.callbackUrl);
        const target = new URL(callback);
        target.search = "";
        if (target.href !== attempt.redirectUri || callback.searchParams.get("state") !== attempt.state) throw new Error("Invalid callback");
        identity = await provider.exchange(callback, attempt.state, attempt.nonce, attempt.verifier);
        if (identity.issuer !== options.issuer || !identity.subject) throw new Error("Invalid identity");
      } catch {
        throw new ApplicationError("unauthorized", "Sign-in could not be verified. Please try again and allow access to your verified email.");
      }
      return auth.loginOidc(identity, options.allowRegistration === true);
    },
  };
}
export type OidcService = ReturnType<typeof createOidcService>;
