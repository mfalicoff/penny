import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { beginSession } from "../../auth/lifecycle";
import { completeRedirectedSignIn, deliverCallback } from "../../auth/oidc";
import { describeAuthError } from "./AuthScreen";

type State = { status: "working" } | { status: "handed-off" } | { status: "failed"; message: string };

/**
 * `/auth/callback`, where the OpenID provider sends the browser back. In the popup flow it
 * passes the URL to the window that opened it and closes. In the redirect flow (popup
 * blocked) it finishes the sign-in itself and continues to Home.
 * The page never reads or stores the `code`: the API checks the state and exchanges it.
 */
export function CallbackPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "working" });
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in development; the attempt is single-use.
    if (started.current) return;
    started.current = true;
    const url = window.location.href;
    void (async () => {
      try {
        if (await deliverCallback(url)) {
          setState({ status: "handed-off" });
          window.close();
          return;
        }
        const { email } = await completeRedirectedSignIn(url);
        await beginSession(queryClient, email);
        await navigate({ to: "/", replace: true });
      } catch (error) {
        setState({ status: "failed", message: describeAuthError(error) });
      }
    })();
  }, [navigate, queryClient]);

  return (
    <main className="callback" id="main" tabIndex={-1}>
      {state.status === "working" ? (
        <p role="status">Finishing sign-in…</p>
      ) : state.status === "handed-off" ? (
        <>
          <h1>You're signed in</h1>
          <p role="status">You can close this window and return to Penny.</p>
        </>
      ) : (
        <>
          <h1>Sign-in didn't finish</h1>
          <p role="alert">{state.message}</p>
          <Link to="/" className="button">
            Back to sign-in
          </Link>
        </>
      )}
    </main>
  );
}
