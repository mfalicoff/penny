import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { z } from "zod";
import { login, oidcConfigQuery, register, type Credentials } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useSessionNotice } from "../../auth/account";
import { beginSession } from "../../auth/lifecycle";
import { OidcError, signInWithPopup, signInWithRedirect } from "../../auth/oidc";
import { startDemo } from "../../demo/demo";
import { cx } from "../../design/controls";
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
      {/* Wide windows only (card web-sign-in); phones open straight on the form, as on iphone-sign-in. */}
      <section className="auth__brand" aria-label="About Penny">
        <div className="auth__glow" aria-hidden="true" />
        <p className="brand auth__logo">
          <span className="logo">
            <Icon name="leaf" size={18} weight={40} />
          </span>
          <span>penny.</span>
        </p>
        <p className="auth__tagline">
          A little more clarity <br />
          about your money.
        </p>
        <p className="auth__sub">Personal and shared expenses on your own server. Penny never connects to your bank.</p>
        <BrandPreview />
      </section>
      <main className={cx("auth__form", creating && "auth__form--create")} id="main" tabIndex={-1}>
        {/* Phones: the copper glow behind the header and, on sign-in, the brand tile (iphone-sign-in, iphone-create-account). */}
        <div className="auth__phone-glow" aria-hidden="true" />
        {creating ? null : (
          <span className="auth__mark" aria-hidden="true">
            <Icon name="leaf" size={34} weight={36} />
          </span>
        )}
        <h1>
          {creating ? "Make yourself at home" : "Welcome back"}
          {/* The phone cards end the title with a period; the wide web card doesn't. Visual only, so the heading's name stays the same. */}
          <span className="auth__period" aria-hidden="true">
            .
          </span>
        </h1>
        <p className="auth__lede">{creating ? "Your account lives on this server. Penny never connects to your bank." : "Sign in to see your month."}</p>
        {notice === "expired" ? (
          <p className="notice" role="status">
            Your session ended. Sign in again to continue. Changes waiting to sync are kept on this device.
          </p>
        ) : null}
        <CredentialsForm key={mode} mode={mode} />
        <SsoButton />
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
        {creating ? null : <DemoButton />}
      </main>
    </div>
  );
}

function CredentialsForm({ mode }: { mode: Mode }) {
  const queryClient = useQueryClient();
  const creating = mode === "create-account";
  const ids = { email: useId(), password: useId(), emailError: useId(), passwordError: useId(), formError: useId(), requirement: useId() };
  const [password, setPassword] = useState("");
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
      if (target === passwordRef && passwordRef.current) {
        passwordRef.current.value = "";
        setPassword("");
      }
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
      <div className="auth__group">
        <div className="auth__field">
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
        </div>
        <div className="auth__field">
          <label htmlFor={ids.password}>Password</label>
          <input
            ref={passwordRef}
            id={ids.password}
            name="password"
            type="password"
            autoComplete={creating ? "new-password" : "current-password"}
            placeholder={creating ? undefined : "Your password"}
            required
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={cx(fieldErrors.password && ids.passwordError, creating && ids.requirement) || undefined}
            onInput={
              creating
                ? (event) => {
                    setPassword(event.currentTarget.value);
                  }
                : undefined
            }
          />
        </div>
      </div>
      {fieldErrors.email ? (
        <span className="field__error" id={ids.emailError}>
          {fieldErrors.email}
        </span>
      ) : null}
      {fieldErrors.password ? (
        <span className="field__error" id={ids.passwordError}>
          {fieldErrors.password}
        </span>
      ) : null}
      {creating ? <PasswordStrength password={password} requirementId={ids.requirement} /> : null}
      <button type="submit" className="button button--block" aria-disabled={submit.isPending}>
        {submit.isPending ? (creating ? "Creating account…" : "Signing in…") : creating ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}

/**
 * How strong a new password looks, in four steps (iphone-create-account): long enough first, then
 * longer and more varied. A guide only: the server's rule is the 10 to 256 characters.
 */
export function passwordStrength(password: string): number {
  if (password.length < 10) return password.length ? 1 : 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((kind) => kind.test(password)).length;
  let score = 2;
  if (password.length >= 12 && kinds >= 2) score += 1;
  if (password.length >= 16 && kinds >= 3) score += 1;
  return score;
}

const STRENGTH = ["", "Too short", "Fair", "Good", "Strong"];

/** The create-account strength meter and its requirement (iphone-create-account). */
function PasswordStrength({ password, requirementId }: { password: string; requirementId: string }) {
  const score = passwordStrength(password);
  const met = password.length >= 10;
  return (
    <div className="auth__strength">
      <div className="auth__meter" role="img" aria-label={`Strength: ${score ? (STRENGTH[score] ?? "") : "none yet"}`}>
        {[1, 2, 3, 4].map((step) => (
          <i key={step} className={step <= score ? "auth__meter-on" : undefined} />
        ))}
      </div>
      <p className="auth__requirement" id={requirementId}>
        {met ? <Icon name="checkmark" size={15} weight={56} /> : <span className="auth__requirement-dot" aria-hidden="true" />}
        At least 10 characters
        <span className="visually-hidden">{met ? ", done" : ""}</span>
      </p>
    </div>
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
      <button type="button" className="button button--sso button--block" onClick={onClick} aria-disabled={state === "waiting"}>
        <Icon name="key" size={19} />
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

/** Temporary demo (MAZ-85): sample data in this tab only, without an account. A quiet link under the form, as on iphone-sign-in. */
function DemoButton() {
  const queryClient = useQueryClient();
  const hintId = useId();
  return (
    <div className="auth__demo">
      <button
        type="button"
        className="link-button auth__demo-link"
        aria-describedby={hintId}
        onClick={() => {
          void startDemo(queryClient);
        }}
      >
        Take a look around with sample data
      </button>
      <p id={hintId} className="field__hint">
        Sample data in this tab only. Nothing is saved or sent to your server.
      </p>
    </div>
  );
}

/** The brand panel's Left to spend sample (card web-sign-in). Decorative, so hidden from assistive technology. */
function BrandPreview() {
  return (
    <div className="auth__preview glass" aria-hidden="true">
      <p className="auth__preview-label">Left to spend</p>
      <p className="auth__preview-amount pk-num">
        $1,116<span>.65</span>
      </p>
      <div className="auth__preview-flow">
        <i className="auth__preview-spent" />
        <i className="auth__preview-invested" />
        <i className="auth__preview-left" />
      </div>
    </div>
  );
}
