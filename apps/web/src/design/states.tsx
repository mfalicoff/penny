import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, cx } from "./controls";
import { Icon, type IconName } from "./Icon";

/**
 * Named loading, empty, error, offline and saving states (MAZ-85; specimens `offline`,
 * `save-error`, `saved-toast`). Each failure keeps the user's work and names the next step.
 */

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state state--loading" role="status">
      <span className="state__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = "leaf", title, children, action }: EmptyStateProps) {
  return (
    <div className="state state--empty">
      <span className="state__icon">
        <Icon name={icon} size={28} />
      </span>
      <h2 className="state__title">{title}</h2>
      {children ? <div className="state__body">{children}</div> : null}
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  children?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorState({ title = "Penny couldn't load this", children, onRetry, retrying }: ErrorStateProps) {
  return (
    <div className="state state--error" role="alert">
      <span className="state__icon">
        <Icon name="alert-circle" size={28} />
      </span>
      <h2 className="state__title">{title}</h2>
      <div className="state__body">{children ?? "Nothing was changed. Check your connection and try again."}</div>
      {onRetry ? (
        <Button variant="secondary" busy={retrying ?? false} onClick={onRetry}>
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      ) : null}
    </div>
  );
}

type BannerTone = "offline" | "error" | "info";

interface BannerProps {
  tone: BannerTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

const BANNER_ICON: Record<BannerTone, IconName> = { offline: "cloud-offline", error: "alert-circle", info: "play" };

/** Inline status bar (kit `Banner`). Errors are alerts; the rest are polite status messages. */
export function Banner({ tone, title, children, action }: BannerProps) {
  return (
    <div className={cx("pk-banner", `pk-banner--${tone}`, tone === "offline" && "glass")} role={tone === "error" ? "alert" : "status"}>
      <Icon name={BANNER_ICON[tone]} size={20} />
      <div className="pk-banner__body">
        <div className="pk-banner__title">{title}</div>
        {children ? <div className="pk-banner__msg">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** The browser's own connectivity signal. It can say online while the server is down; requests still report that. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

/** Shell-level offline banner (specimen `offline`). Nothing is lost: reads retry when the connection returns. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <Banner tone="offline" title="You're offline">
      Penny shows what it already loaded. Changes you can't save yet stay in their form until you're back online.
    </Banner>
  );
}

/**
 * Shell-level banner when the browser is online but the Penny server doesn't answer. Nothing is
 * signed out or cleared; reads keep retrying.
 */
export function ServerUnreachableBanner({ unreachable }: { unreachable: boolean }) {
  const online = useOnline();
  if (!online || !unreachable) return null;
  return (
    <Banner tone="error" title="Can't reach your Penny server">
      Penny shows what it already loaded and keeps trying. Nothing was signed out or deleted.
    </Banner>
  );
}

/** Save failure next to a form (specimen `save-error`): the draft is kept and the next step is named. */
export function SaveErrorBanner({ message, onRetry, retrying }: { message: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <Banner
      tone="error"
      title="Couldn't save"
      action={
        onRetry ? (
          <Button variant="secondary" busy={retrying ?? false} onClick={onRetry}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        ) : undefined
      }
    >
      {message} Your changes are still here.
    </Banner>
  );
}

/* ---------- toast ---------- */

export interface ToastInput {
  title: string;
  detail?: string;
  tone?: "success" | "error";
  /** Shows an Undo button that calls this, then dismisses. */
  onUndo?: () => void;
}

interface ToastState extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (toast: ToastInput) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** How long a toast stays. Paused while keyboard focus or a mouse pointer is on it, so Undo stays reachable. */
export const TOAST_MS = 6000;

/**
 * Safety net for a resting mouse pointer: a hovered toast still closes after this long, so a
 * pointer left on it never keeps it over the page for good. Keyboard focus has no limit: moving
 * focus away is the person's own choice, and closing would pull focus out from under them.
 */
export const TOAST_MAX_HOVER_MS = 30_000;

/** What is holding a toast open. */
export interface ToastHold {
  hovered: boolean;
  focused: boolean;
}

/** Milliseconds until the toast closes on its own, or null while keyboard focus holds it. */
export function toastDelay({ hovered, focused }: ToastHold): number | null {
  if (focused) return null;
  return hovered ? TOAST_MAX_HOVER_MS : TOAST_MS;
}

/**
 * Whether a pointer entering the toast should pause it: only a mouse, on a device that can hover
 * with a fine pointer. On touch screens a tap leaves a "hover" behind that never ends, which kept
 * the toast over the rows beneath it (MAZ-162).
 */
export function pointerCanPause(pointerType: string): boolean {
  if (pointerType !== "mouse") return false;
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/** Whether focus came from the keyboard rather than a tap or click; only that pauses the toast. */
function keyboardFocus(target: Element): boolean {
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** Hosts one toast at a time (specimen `saved-toast`), announced politely, with optional Undo. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const sequence = useRef(0);

  const dismiss = useCallback(() => {
    setToast(null);
    setHovered(false);
    setFocused(false);
  }, []);
  const show = useCallback((input: ToastInput) => {
    sequence.current += 1;
    setToast({ ...input, id: sequence.current });
    // A new toast is a new element: whatever held the last one doesn't hold this one.
    setHovered(false);
    setFocused(false);
  }, []);

  const delay = toastDelay({ hovered, focused });
  useEffect(() => {
    if (!toast || delay === null) return;
    const timer = window.setTimeout(dismiss, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast, delay, dismiss]);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast ? (
          <div
            key={toast.id}
            className={cx("pk-toast", "glass", toast.tone === "error" && "pk-toast--error")}
            onPointerEnter={(event) => {
              if (pointerCanPause(event.pointerType)) setHovered(true);
            }}
            onPointerLeave={() => {
              setHovered(false);
            }}
            onFocus={(event) => {
              if (keyboardFocus(event.target)) setFocused(true);
            }}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (!(next instanceof Node && event.currentTarget.contains(next))) setFocused(false);
            }}
          >
            <Icon name={toast.tone === "error" ? "alert-circle" : "checkmark-circle"} size={22} />
            <div className="pk-toast__body">
              <div className="pk-toast__title">{toast.title}</div>
              {toast.detail ? <div className="pk-toast__sub">{toast.detail}</div> : null}
            </div>
            {toast.onUndo ? (
              <Button
                variant="quiet"
                onClick={() => {
                  toast.onUndo?.();
                  dismiss();
                }}
              >
                Undo
              </Button>
            ) : null}
            <Button variant="quiet" iconOnly icon="close" aria-label="Dismiss" onClick={dismiss} />
          </div>
        ) : null}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error("useToast must be used inside ToastProvider");
  return api;
}
