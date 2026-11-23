import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { z } from "zod";
import { requestPasswordReset, resetPassword } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useEmailEnabled } from "../../api/info";
import { RESET_CODE } from "../../api/schemas";
import { clearResetCode, peekResetCode } from "../../auth/fragmentCodes";
import { passwordWasReset } from "../../auth/lifecycle";
import { cx } from "../../design/controls";
import { Icon, MailIcon } from "../../design/Icon";
import { AuthFrame, describeAuthError } from "./AuthScreen";

/** How long Resend waits after a reset email is asked for. */
export const RESEND_SECONDS = 60;

const emailSchema = z.email().max(254);
const INVALID_CODE = /invalid or has expired/i;

/** The page's document title; these pages are outside the app shell, which sets it elsewhere. */
function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Penny`;
  }, [title]);
}

function BackToSignIn() {
  return (
    <Link to="/" className="auth__back-link">
      <Icon name="chevron-back" size={14} weight={48} />
      Back to sign in
    </Link>
  );
}

/** Rate limits and failures in plain words; the server's own 400 text otherwise. */
function describeResetError(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  return describeAuthError(error);
}

/**
 * `/forgot-password` (cards `web-forgot-password-request`, then `web-forgot-password`): the email
 * the person signs in with, then a note that a link is on its way if the address has an account,
 * which reads the same whether or not it does, and Resend after a minute. A server that stopped
 * sending email (404) sends the person to the reset code page instead.
 */
export function ForgotPasswordPage() {
  useDocumentTitle("Reset your password");
  const navigate = useNavigate();
  const ids = { email: useId(), emailError: useId(), formError: useId() };
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const request = useMutation({
    mutationKey: ["auth", "password-reset", "request"],
    mutationFn: (address: string) => requestPasswordReset(address),
    onSuccess: (_, address) => {
      setSentTo(address);
      setSentAt(Date.now());
      setFormError(null);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) {
        void navigate({ to: "/reset-password", replace: true });
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        setFieldError(error.message);
        requestAnimationFrame(() => emailRef.current?.focus());
        return;
      }
      setFormError(describeResetError(error));
    },
  });

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.isPending) return;
    const address = email.trim();
    if (!emailSchema.safeParse(address).success) {
      setFieldError("Enter a valid email address.");
      emailRef.current?.focus();
      return;
    }
    setFieldError(null);
    setFormError(null);
    request.mutate(address);
  }

  return (
    <AuthFrame className="auth__form--create auth__form--reset">
      <h1>Reset your password</h1>
      <p className="auth__lede">Enter the email you sign in with. We'll send a link to choose a new password.</p>
      {sentTo ? (
        <div className="auth__fields">
          <div className="auth__group">
            <div className="auth__field">
              <label htmlFor={ids.email}>Email</label>
              <input id={ids.email} type="email" value={sentTo} readOnly />
            </div>
          </div>
          <div className="auth__sent" role="status">
            <span className="auth__sent-icon">
              <MailIcon size={20} />
            </span>
            <p>
              <strong>Check your email</strong>
              <span>If {sentTo} has a Penny account on this server, a reset link is on its way. The link works once.</span>
            </p>
          </div>
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <ResendButton
            key={sentAt}
            sentAt={sentAt}
            busy={request.isPending}
            onResend={() => {
              setFormError(null);
              request.mutate(sentTo);
            }}
          />
        </div>
      ) : (
        <>
          <form className="auth__fields" onSubmit={onSubmit} noValidate aria-busy={request.isPending}>
            {formError ? (
              <p className="form-error" role="alert" id={ids.formError}>
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
                  required
                  value={email}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? ids.emailError : undefined}
                  onChange={(event) => {
                    setEmail(event.currentTarget.value);
                  }}
                />
              </div>
            </div>
            {fieldError ? (
              <span className="field__error" id={ids.emailError}>
                {fieldError}
              </span>
            ) : null}
            <button type="submit" className="button button--block" aria-disabled={request.isPending}>
              {request.isPending ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <p className="auth__alt">
            Have a reset code from your server's administrator?{" "}
            <Link to="/reset-password" className="auth__alt-link">
              Enter it
            </Link>
          </p>
        </>
      )}
      <BackToSignIn />
    </AuthFrame>
  );
}

/** "Resend in 0:42", counting down from a minute after each request, then Resend. */
function ResendButton({ sentAt, busy, onResend }: { sentAt: number; busy: boolean; onResend: () => void }) {
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
  const waiting = remaining > 0 || busy;
  const clock = `${String(Math.floor(remaining / 60))}:${String(remaining % 60).padStart(2, "0")}`;
  return (
    <button
      type="button"
      className={cx("button button--block auth__resend", waiting && "auth__resend--waiting")}
      aria-disabled={waiting}
      onClick={() => {
        if (!waiting) onResend();
      }}
    >
      {busy ? (
        "Sending…"
      ) : remaining > 0 ? (
        <>
          Resend in <span className="pk-num">{clock}</span>
        </>
      ) : (
        "Resend"
      )}
    </button>
  );
}

/**
 * `/reset-password`: a new password for a reset code. From the emailed link (card
 * `web-password-reset-link`) the code came in the fragment, which the route kept and dropped from
 * the address bar, so only the new password is asked. Otherwise (card `web-password-reset`) the
 * code from the server's administrator is typed in first. The API takes no email, so the card's
 * Email field isn't here. Success signs every device out and returns to sign-in with a notice.
 */
export function ResetPasswordPage() {
  useDocumentTitle("Set a new password");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const emailEnabled = useEmailEnabled();
  const [linkCode] = useState(peekResetCode);
  const fromLink = linkCode !== null;
  const ids = { code: useId(), password: useId(), codeError: useId(), passwordError: useId(), requirement: useId() };
  const codeRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ code?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);

  const reset = useMutation({
    mutationKey: ["auth", "password-reset"],
    mutationFn: (input: { token: string; password: string }) => resetPassword(input),
    onSuccess: async () => {
      clearResetCode();
      await passwordWasReset(queryClient);
      await navigate({ to: "/", replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400 && INVALID_CODE.test(error.message)) {
        if (fromLink) {
          clearResetCode();
          setLinkExpired(true);
        } else {
          setErrors({ code: error.message });
          requestAnimationFrame(() => codeRef.current?.focus());
        }
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        setErrors({ password: error.message });
        requestAnimationFrame(() => passwordRef.current?.focus());
        return;
      }
      setFormError(describeResetError(error));
    },
  });

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reset.isPending) return;
    const token = fromLink ? linkCode : code.replace(/\s/g, "").toLowerCase();
    const next: { code?: string; password?: string } = {};
    if (!RESET_CODE.test(token)) next.code = "A reset code is 64 letters and numbers. Copy it exactly as your administrator sent it.";
    if (password.length < 10 || password.length > 256) next.password = "Use 10 to 256 characters.";
    setErrors(next);
    setFormError(null);
    if (next.code) {
      codeRef.current?.focus();
      return;
    }
    if (next.password) {
      passwordRef.current?.focus();
      return;
    }
    reset.mutate({ token, password });
  }

  if (linkExpired) {
    return (
      <AuthFrame className="auth__form--create auth__form--reset">
        <h1>Set a new password</h1>
        <p className="form-error" role="alert">
          This reset link is invalid or has expired. Each link works once, and a newer link replaces it.
        </p>
        {emailEnabled ? (
          <Link to="/forgot-password" className="button button--block auth__cta">
            Send a new link
          </Link>
        ) : null}
        <BackToSignIn />
      </AuthFrame>
    );
  }

  const met = password.length >= 10;
  return (
    <AuthFrame className="auth__form--create auth__form--reset">
      <h1>Set a new password</h1>
      <p className="auth__lede">
        {fromLink
          ? "Choose a new password. The link from your email works once, and every signed-in device is signed out."
          : "Enter the reset code your Penny server's administrator gave you, then choose a new password."}
      </p>
      <form className="auth__fields" onSubmit={onSubmit} noValidate aria-busy={reset.isPending}>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="auth__group">
          {fromLink ? null : (
            <div className="auth__field">
              <label htmlFor={ids.code}>Reset code</label>
              <input
                ref={codeRef}
                id={ids.code}
                name="code"
                className="pk-num auth__code"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={80}
                value={code}
                aria-invalid={errors.code ? true : undefined}
                aria-describedby={errors.code ? ids.codeError : undefined}
                onChange={(event) => {
                  setCode(event.currentTarget.value);
                }}
              />
            </div>
          )}
          <div className="auth__field">
            <label htmlFor={ids.password}>New password</label>
            <input
              ref={passwordRef}
              id={ids.password}
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={cx(errors.password && ids.passwordError, ids.requirement)}
              onChange={(event) => {
                setPassword(event.currentTarget.value);
              }}
            />
          </div>
        </div>
        {errors.code ? (
          <span className="field__error" id={ids.codeError}>
            {errors.code}
          </span>
        ) : null}
        {errors.password ? (
          <span className="field__error" id={ids.passwordError}>
            {errors.password}
          </span>
        ) : null}
        <p className="auth__requirement auth__requirement--reset" id={ids.requirement}>
          {met ? <Icon name="checkmark" size={15} weight={56} /> : <span className="auth__requirement-dot" aria-hidden="true" />}
          At least 10 characters
          <span className="visually-hidden">{met ? ", done" : ""}</span>
        </p>
        <button type="submit" className="button button--block" aria-disabled={reset.isPending}>
          {reset.isPending ? "Setting password…" : "Set password"}
        </button>
      </form>
      <BackToSignIn />
    </AuthFrame>
  );
}
