import { emptyLedger } from "../../src/domain/ledger.ts";
import { credentialsSchema } from "../validation/auth.ts";
import { ApplicationError } from "./errors.ts";
import type { AccountRepository, OidcIdentity, Security, SessionRepository } from "./ports.ts";

export const SESSION_DURATION_MS = 30 * 86400000;
const duplicateEmail = "An account with this email already exists. Please sign in.";
const invalidCredentials = "Email or password is incorrect.";

export function createAuthService({ accounts, sessions, security, allowRegistration, now = Date.now }: {
  accounts: AccountRepository;
  sessions: SessionRepository;
  security: Security;
  allowRegistration: boolean;
  now?: () => number;
}) {
  function issueSession(userId: string) {
    const token = security.randomId(32);
    const issuedAt = now();
    sessions.create(security.hashToken(token), userId, issuedAt + SESSION_DURATION_MS, issuedAt);
    return token;
  }

  return {
    loginOidc(identity: OidcIdentity, allowOidcRegistration: boolean) {
      const existing = accounts.findByIdentity(identity.issuer, identity.subject);
      if (existing) return { token: issueSession(existing.id), email: existing.email };
      if (!allowOidcRegistration) throw new ApplicationError("forbidden", "New single sign-on accounts are disabled on this server.");
      if (accounts.findByEmail(identity.email)) throw new ApplicationError("conflict", "An account already uses this email. Sign in with its existing method; automatic account linking is disabled.");
      const user = { id: security.randomId(16), email: identity.email, password: "", salt: security.randomId(16) };
      if (!accounts.createOidc(user, identity, emptyLedger())) throw new ApplicationError("conflict", "This account already exists. Please try signing in again.");
      return { token: issueSession(user.id), email: user.email };
    },
    async register(body: unknown) {
      if (!allowRegistration) {
        throw new ApplicationError("forbidden", "Account registration is disabled on this server.");
      }
      const input = credentialsSchema.safeParse(body);
      if (!input.success) {
        throw new ApplicationError("invalid", "Enter a valid email and a password of 10–256 characters.");
      }
      const { email, password } = input.data;
      if (accounts.findByEmail(email)) throw new ApplicationError("conflict", duplicateEmail);
      const userId = security.randomId(16);
      const salt = security.randomId(16);
      const passwordHash = await security.hashPassword(password, salt);
      if (!accounts.create({ id: userId, email, password: passwordHash, salt }, emptyLedger())) {
        // Another registration may finish while password hashing yields.
        throw new ApplicationError("conflict", duplicateEmail);
      }
      return { token: issueSession(userId), email };
    },
    async login(body: unknown) {
      const input = credentialsSchema.safeParse(body);
      if (!input.success) throw new ApplicationError("unauthorized", invalidCredentials);
      const user = accounts.findByEmail(input.data.email);
      // Do the same expensive derivation when an email does not exist.
      const valid = await security.verifyPassword(input.data.password, user?.salt ?? "0".repeat(32), user?.password ?? "0".repeat(128));
      if (!user || !valid) throw new ApplicationError("unauthorized", invalidCredentials);
      return { token: issueSession(user.id), email: user.email };
    },
    authenticate(token: string | undefined) {
      if (token) {
        const tokenHash = security.hashToken(token);
        const userId = sessions.findUser(tokenHash, now());
        if (userId) return { userId, tokenHash };
      }
      throw new ApplicationError("unauthorized", "Please sign in to continue.");
    },
    me(userId: string) {
      const user = accounts.findEmail(userId);
      if (!user) throw new ApplicationError("unauthorized", "Please sign in to continue.");
      return user;
    },
    logout(tokenHash: string) {
      sessions.remove(tokenHash);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
