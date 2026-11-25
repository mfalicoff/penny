import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type SyntheticEvent } from "react";
import { z } from "zod";
import { changeEmail, resendVerification, sessionQuery, verifyEmail } from "../../api/auth";
import { ApiError, hasCode } from "../../api/client";
import { serverInfoQuery } from "../../api/info";
import { userKey } from "../../api/keys";
import { profileQuery } from "../../api/profile";
import { clearVerifyCode, peekVerifyCode, subscribeVerifyCode, verifyCodeVersion } from "../../auth/fragmentCodes";
import { beginSession } from "../../auth/lifecycle";
import { Icon, MailIcon } from "../../design/Icon";
import { AuthFrame, describeAuthError } from "./AuthScreen";
import { RESEND_SECONDS, useDocumentTitle } from "./PasswordReset";

/**
 * Email verification (MAZ-172). Verification only records that the address is proven: nothing in
 * Penny waits for it, so every page here leads straight on into the app.
 *
 * - From the emailed link (card `web-email-verified`) the route kept the code; it is redeemed once,
 *   signed in or not, since the link may be opened on another device.
 * - Otherwise (card `web-verify-email`) a signed-in account that isn't verified yet, on a server
 *   that sends email, sees "Check your email" with Resend after a minute and Change email.
 *   Anyone else goes on to Penny.
 */
export function VerifyEmailPage() {
  useDocumentTitle("Verify your email");
  // A link opened over this page (only the fragment changes) starts the page afresh.
  const version = useSyncExternalStore(subscribeVerifyCode, verifyCodeVersion);
  return <VerifyEmailContent key={version} />;
}

function VerifyEmailContent() {
  const [linkCode] = useState(peekVerifyCode);
  return linkCode ? <VerifyLink code={linkCode} /> : <CheckYourEmail />;
}

const INVALID_LINK = /invalid or has expired/i;
const emailSchema = z.email().max(254);

function describeError(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  return describeAuthError(error);
}

function OpenPenny({ label }: { label: string }) {
  return (
    <Link to="/" className="button button--block auth__cta auth__verify-cta">
      {label}
    </Link>
  );
}

function VerifyLink({ code }: { code: string }) {
  const queryClient = useQueryClient();
  const [resent, setResent] = useState(0);
  const verify = useMutation({
    mutationKey: ["auth", "email-verification"],
    mutationFn: () => verifyEmail(code),
    onSuccess: (email) => {
      clearVerifyCode();
      // Signed in here as this account: Settings › Profile shows the Verified mark at once.
      void queryClient.invalidateQueries({ queryKey: userKey(email, "profile") });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400) clearVerifyCode();
    },
  });
  const { mutate } = verify;
  // Once per page: the code works once, and a development double effect must not spend it twice.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate();
  }, [mutate]);

  if (resent > 0) return <CheckYourEmail sentAt={resent} />;
  if (verify.isSuccess) {
    return (
      <AuthFrame className="auth__form--create auth__form--verify">
        <span className="auth__tile auth__tile--done" aria-hidden="true">
          <Icon name="checkmark-circle" size={28} />
        </span>
        <h1>Your email is verified</h1>
        <p className="auth__lede">
          <strong>{verify.data}</strong> is confirmed as yours.
        </p>
        <OpenPenny label="Open Penny" />
        <p className="auth__alt auth__alt--small">Opened this on another device? Penny updates there the next time it syncs.</p>
      </AuthFrame>
    );
  }
  if (verify.isError) {
    const expired = verify.error instanceof ApiError && verify.error.status === 400 && INVALID_LINK.test(verify.error.message);
    return (
      <AuthFrame className="auth__form--create auth__form--verify">
        <h1>Verify your email</h1>
        <p className="form-error" role="alert">
          {expired ? "This verification link is invalid or has expired. Each link works once, and a newer link replaces it." : describeError(verify.error)}
        </p>
        {expired ? (
          <ResendFromFailedLink
            onSent={() => {
              setResent(Date.now());
            }}
          />
        ) : (
          <button
            type="button"
            className="button button--block auth__cta"
            onClick={() => {
              mutate();
            }}
          >
            Try again
          </button>
        )}
        <OpenPenny label="Open Penny" />
      </AuthFrame>
    );
  }
  return (
    <AuthFrame className="auth__form--create auth__form--verify">
      <h1>Verify your email</h1>
      <p className="auth__lede" role="status">
        Verifying your email…
      </p>
    </AuthFrame>
  );
}

/** A refused link, signed in to an unverified account on a server that sends email: send a new one. */
function ResendFromFailedLink({ onSent }: { onSent: () => void }) {
  const state = useVerificationState();
  const [error, setError] = useState<string | null>(null);
  const resend = useMutation({
    mutationKey: ["auth", "email-verification", "resend"],
    mutationFn: () => resendVerification(),
    onSuccess: onSent,
    onError: (failure) => {
      setError(describeError(failure));
    },
  });
  if (state.kind !== "unverified") return null;
  return (
    <>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--block auth__cta"
        aria-disabled={resend.isPending}
        onClick={() => {
          if (!resend.isPending) resend.mutate();
        }}
      >
        {resend.isPending ? "Sending…" : "Send a new link"}
      </button>
    </>
  );
}

type VerificationState = { kind: "loading" } | { kind: "none" } | { kind: "unverified"; email: string };

/** Whether this browser is signed in to an unverified account on a server that sends email. */
function useVerificationState(): VerificationState {
  const session = useQuery(sessionQuery);
  const info = useQuery(serverInfoQuery);
  const email = session.data?.email ?? null;
  const profile = useQuery({ ...profileQuery(email ?? ""), enabled: email !== null && info.data?.emailEnabled === true });
  if (session.isPending || info.isPending) return { kind: "loading" };
  if (email === null || info.data?.emailEnabled !== true) return { kind: "none" };
  if (profile.isPending) return { kind: "loading" };
  if (profile.data?.signIn !== "password" || profile.data.emailVerified) return { kind: "none" };
  return { kind: "unverified", email: profile.data.email };
}

/**
 * "Check your email" (card `web-verify-email`). Right after sign-up the email is already on its
 * way, so Resend counts down a minute first, as the server does.
 */
function CheckYourEmail({ sentAt: initialSentAt }: { sentAt?: number }) {
  const state = useVerificationState();
  const [sentAt, setSentAt] = useState(() => initialSentAt ?? Date.now());
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resend = useMutation({
    mutationKey: ["auth", "email-verification", "resend"],
    mutationFn: () => resendVerification(),
    onSuccess: () => {
      setSentAt(Date.now());
      setError(null);
    },
    onError: (failure) => {
      setError(describeError(failure));
    },
  });

  if (state.kind === "loading") return <AuthFrame className="auth__form--create auth__form--verify">{null}</AuthFrame>;
  // Verified, signed out, or a server without email: nothing to verify here.
  if (state.kind === "none") return <Navigate to="/" replace />;
  if (changing) {
    return (
      <ChangeEmailForm
        email={state.email}
        onCancel={() => {
          setChanging(false);
        }}
        onChanged={() => {
          setChanging(false);
          setSentAt(Date.now());
          setError(null);
        }}
      />
    );
  }
  return (
    <AuthFrame className="auth__form--create auth__form--verify">
      <span className="auth__tile" aria-hidden="true">
        <MailIcon size={28} />
      </span>
      <h1>Check your email</h1>
      <p className="auth__lede">
        We sent a link to <strong>{state.email}</strong>. Open it to verify your address.
      </p>
      <div className="auth__note">
        <Icon name="people" size={18} />
        <span>You can use Penny right away, households, trips and invites included. Verifying shows this address is yours.</span>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <OpenPenny label="Continue to Penny" />
      <p className="auth__alt">
        Didn't get it?{" "}
        <ResendLink
          key={sentAt}
          sentAt={sentAt}
          busy={resend.isPending}
          onResend={() => {
            resend.mutate();
          }}
        />{" "}
        ·{" "}
        <button
          type="button"
          className="auth__alt-link auth__link-button"
          onClick={() => {
            setChanging(true);
          }}
        >
          Change email
        </button>
      </p>
    </AuthFrame>
  );
}

/** "Resend in 0:42", counting down from a minute after each email, then a Resend link. */
function ResendLink({ sentAt, busy, onResend }: { sentAt: number; busy: boolean; onResend: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.max(0, Math.ceil((sentAt + RESEND_SECONDS * 1000 - now) / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [sentAt]);
  if (busy) return <span className="auth__resend-wait">Sending…</span>;
  if (remaining > 0) {
    const clock = `${String(Math.floor(remaining / 60))}:${String(remaining % 60).padStart(2, "0")}`;
    return (
      <span className="auth__resend-wait">
        Resend in <span className="pk-num">{clock}</span>
      </span>
    );
  }
  return (
    <button type="button" className="auth__alt-link auth__link-button" onClick={onResend}>
      Resend
    </button>
  );
}

/**
 * Change email, from "Check your email": the new address and the account's password, in the
 * layout of the reset request card. The account stays signed in under the new address and a new
 * link goes there; the earlier link stops working.
 */
function ChangeEmailForm({ email, onCancel, onChanged }: { email: string; onCancel: () => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const ids = { email: useId(), password: useId(), emailError: useId(), passwordError: useId() };
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState(email);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  const change = useMutation({
    mutationKey: ["auth", "email"],
    mutationFn: (input: { email: string; password: string }) => changeEmail(input),
    onSuccess: async (profile) => {
      // The account's private data is keyed by its email: start over under the new one.
      if (profile.email !== email) await beginSession(queryClient, profile.email);
      queryClient.setQueryData(userKey(profile.email, "profile"), profile);
      onChanged();
    },
    onError: (error) => {
      if (hasCode(error, "auth.email_in_use") || hasCode(error, "password_reset.invalid_email")) {
        setErrors({ email: error.message });
        requestAnimationFrame(() => emailRef.current?.focus());
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        setErrors({ password: error.message });
        setPassword("");
        requestAnimationFrame(() => passwordRef.current?.focus());
        return;
      }
      setFormError(describeError(error));
    },
  });

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (change.isPending) return;
    const next = address.trim();
    const found: { email?: string; password?: string } = {};
    if (!emailSchema.safeParse(next).success) found.email = "Enter a valid email address.";
    if (password.length === 0) found.password = "Enter your password.";
    setErrors(found);
    setFormError(null);
    if (found.email) {
      emailRef.current?.focus();
      return;
    }
    if (found.password) {
      passwordRef.current?.focus();
      return;
    }
    change.mutate({ email: next, password });
  }

  return (
    <AuthFrame className="auth__form--create auth__form--reset auth__form--verify">
      <h1>Change your email</h1>
      <p className="auth__lede">Enter the address you want to sign in with. We'll send a new link to verify it.</p>
      <form className="auth__fields" onSubmit={onSubmit} noValidate aria-busy={change.isPending}>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="auth__group">
          <div className="auth__field">
            <label htmlFor={ids.email}>Email</label>
            <input
              ref={emailRef}
              id={ids.email}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={address}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? ids.emailError : undefined}
              onChange={(event) => {
                setAddress(event.currentTarget.value);
              }}
            />
          </div>
          <div className="auth__field">
            <label htmlFor={ids.password}>Password</label>
            <input
              ref={passwordRef}
              id={ids.password}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? ids.passwordError : undefined}
              onChange={(event) => {
                setPassword(event.currentTarget.value);
              }}
            />
          </div>
        </div>
        {errors.email ? (
          <span className="field__error" id={ids.emailError}>
            {errors.email}
          </span>
        ) : null}
        {errors.password ? (
          <span className="field__error" id={ids.passwordError}>
            {errors.password}
          </span>
        ) : null}
        <button type="submit" className="button button--block" aria-disabled={change.isPending}>
          {change.isPending ? "Sending…" : "Send link"}
        </button>
      </form>
      <button type="button" className="auth__back-link auth__link-button" onClick={onCancel}>
        <Icon name="chevron-back" size={14} weight={48} />
        Back
      </button>
    </AuthFrame>
  );
}
