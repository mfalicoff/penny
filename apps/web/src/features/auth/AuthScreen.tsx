import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { z } from "zod";
import { login, oidcConfigQuery, register, type Credentials } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useSessionNotice } from "../../auth/account";
import { beginSession } from "../../auth/lifecycle";
import { OidcError, signInWithPopup, signInWithRedirect } from "../../auth/oidc";
import { startDemo } from "../../demo/demo";
import { Icon } from "../../design/Icon";

type Mode = "sign-in" | "create-account";

const emailSchema = z.email().max(254);
const passwordSchema = z.string().min(10).max(256);

/** Server and network failures in plain words. The API's own message is kept when it is safe to show. */
export function describeAuthError(error: unknown): string {
  if (error instanceof OidcError) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 0) return "Penny can't reach the server. Check your connection and try again.";
    if (error.status >= 500) return "The server had a problem. Try again in a moment.";
    return error.message;
  }
  return "Something went wrong. Try again.";
}

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const notice = useSessionNotice();
  const creating = mode === "create-account";

  return (
    <div className="auth">
      <section className="auth__brand" aria-label="About Penny">
        <p className="auth__logo">
          <Icon name="leaf" size={28} weight={40} />
          <span>Penny</span>
        </p>
        <p className="auth__tagline">A little more clarity about your money.</p>
        <p className="auth__sub">Personal and shared expenses on your own server. Penny never connects to your bank.</p>
      </section>
      <main className="auth__form" id="main" tabIndex={-1}>
        <h1>{creating ? "Create your account" : "Welcome back"}</h1>
        <p className="auth__lede">{creating ? "Start tracking on this server." : "Sign in to see your month."}</p>
        {notice === "expired" ? (
          <p className="notice" role="status">
            Your session ended. Sign in again to continue. Changes waiting to sync are kept on this device.
          </p>
        ) : null}
        <CredentialsForm key={mode} mode={mode} />
        <SsoButton />
        {creating ? null : <DemoButton />}
        <p className="auth__switch">
          {creating ? "Already have an account? " : "New here? "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(creating ? "sign-in" : "create-account");
            }}
          >
            {creating ? "Sign in" : "Create an account"}
          </button>
        </p>
      </main>
    </div>
  );
}

function CredentialsForm({ mode }: { mode: Mode }) {
  const queryClient = useQueryClient();
  const creating = mode === "create-account";
  const ids = { email: useId(), password: useId(), emailError: useId(), passwordError: useId(), formError: useId() };
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = useMutation({
    mutationKey: ["auth", mode],
    mutationFn: (credentials: Credentials) => (creating ? register(credentials) : login(credentials)),
    onSuccess: ({ email }) => beginSession(queryClient, email),
    onError: (error) => {
      setFormError(describeAuthError(error));
      // Recover where the user can act: a taken email is fixed in the email field, anything else by retyping the password.
      const target = error instanceof ApiError && error.status === 409 ? emailRef : passwordRef;
      if (target === passwordRef && passwordRef.current) passwordRef.current.value = "";
      requestAnimationFrame(() => target.current?.focus());
    },
  });

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (submit.isPending) return;
    const data = new FormData(event.currentTarget);
    const email = typeof data.get("email") === "string" ? (data.get("email") as string).trim() : "";
    const password = typeof data.get("password") === "string" ? (data.get("password") as string) : "";

    const errors: { email?: string; password?: string } = {};
    if (!emailSchema.safeParse(email).success) errors.email = "Enter a valid email address.";
    if (!passwordSchema.safeParse(password).success) {
      errors.password = creating ? "Use 10 to 256 characters." : "Enter your password (10 to 256 characters).";
    }
    setFieldErrors(errors);
    setFormError(null);
    if (errors.email) {
      emailRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }
    submit.mutate({ email, password });
  }

  return (
    <form className="auth__fields" onSubmit={onSubmit} noValidate aria-busy={submit.isPending}>
      {formError ? (
        <p className="form-error" role="alert" id={ids.formError}>
          {formError}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor={ids.email}>Email</label>
        <input
          ref={emailRef}
          id={ids.email}
          name="email"
          type="email"
          inputMode="email"
          autoComplete={creating ? "email" : "username"}
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? ids.emailError : undefined}
        />
        {fieldErrors.email ? (
          <span className="field__error" id={ids.emailError}>
            {fieldErrors.email}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor={ids.password}>Password</label>
        <input
          ref={passwordRef}
          id={ids.password}
          name="password"
          type="password"
          autoComplete={creating ? "new-password" : "current-password"}
          required
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={fieldErrors.password ? ids.passwordError : undefined}
        />
        {fieldErrors.password ? (
          <span className="field__error" id={ids.passwordError}>
            {fieldErrors.password}
          </span>
        ) : creating ? (
          <span className="field__hint">At least 10 characters.</span>
        ) : null}
      </div>
      <button type="submit" className="button button--block" aria-disabled={submit.isPending}>
        {submit.isPending ? (creating ? "Creating account…" : "Signing in…") : creating ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}

function SsoButton() {
  const queryClient = useQueryClient();
  const config = useQuery(oidcConfigQuery);
  const [state, setState] = useState<"idle" | "waiting" | "cancelled" | "blocked" | "error">("idle");
  const [mode, setMode] = useState<"popup" | "tab">("popup");
  const [message, setMessage] = useState<string | null>(null);
  const [popupClosed, setPopupClosed] = useState(false);
  const abort = useRef<AbortController | null>(null);

  if (!config.data?.enabled) return null;
  const label = config.data.label ?? "Single sign-on";

  const cancelled = () => {
    setState("cancelled");
    setMessage("Sign-in was cancelled. Nothing changed.");
  };

  function fail(error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      cancelled();
      return;
    }
    setState("error");
    setMessage(describeAuthError(error));
  }

  function onClick() {
    if (state === "waiting") return;
    const controller = new AbortController();
    abort.current = controller;
    setState("waiting");
    setMode("popup");
    setMessage(null);
    setPopupClosed(false);
    // signInWithPopup opens the window synchronously, before its first await.
    signInWithPopup({
      signal: controller.signal,
      onPopupClosed: () => {
        setPopupClosed(true);
      },
    }).then(
      async (result) => {
        if (result) await beginSession(queryClient, result.email);
        else cancelled();
      },
      (error: unknown) => {
        if (error instanceof OidcError && error.code === "blocked") {
          setState("blocked");
          setMessage("Your browser blocked the sign-in window. Allow pop-ups for this site, or continue in this tab.");
        } else {
          fail(error);
        }
      },
    );
  }

  function continueInTab() {
    setState("waiting");
    setMode("tab");
    setMessage(null);
    signInWithRedirect().catch(fail);
  }

  return (
    <div className="auth__sso">
      <p className="auth__or" aria-hidden="true">
        or
      </p>
      <button type="button" className="button button--secondary button--block" onClick={onClick} aria-disabled={state === "waiting"}>
        <Icon name="key" size={20} />
        {state === "waiting" ? `Waiting for ${label}…` : `Continue with ${label}`}
      </button>
      {state === "waiting" && mode === "popup" ? (
        <>
          {popupClosed ? (
            <p className="notice" role="status">
              The sign-in window looks closed. If you closed it, cancel and try again. If you are still signing in, keep going.
            </p>
          ) : null}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              abort.current?.abort();
            }}
          >
            Cancel sign-in
          </button>
        </>
      ) : null}
      {message ? (
        <p className={state === "error" ? "form-error" : "notice"} role={state === "error" ? "alert" : "status"}>
          {message}
        </p>
      ) : null}
      {state === "blocked" ? (
        <button type="button" className="button button--secondary button--block" onClick={continueInTab}>
          Continue in this tab
        </button>
      ) : null}
    </div>
  );
}

/** Temporary demo (MAZ-85): sample data in this tab only, without an account. */
function DemoButton() {
  const queryClient = useQueryClient();
  const hintId = useId();
  return (
    <div className="auth__demo">
      <button
        type="button"
        className="button button--secondary button--block"
        aria-describedby={hintId}
        onClick={() => {
          void startDemo(queryClient);
        }}
      >
        <Icon name="play" size={18} />
        Explore a demo
      </button>
      <p id={hintId} className="field__hint">
        Sample data in this tab only. Nothing is saved or sent to your server.
      </p>
    </div>
  );
}
