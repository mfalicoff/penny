import { useEffect, useId, useLayoutEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { duration } from "./motion";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalDialogProps {
  /** Id of the element that names the dialog. */
  labelledBy: string;
  /** Id of the element that describes it, if any. */
  describedBy?: string;
  onClose: () => void;
  /** Element to focus on open. Defaults to the first focusable element in the dialog. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Extra class on the panel, e.g. `dialog__panel--drawer`. */
  panelClassName?: string;
  children: ReactNode;
}

/**
 * A modal dialog that really is modal: it renders in a portal on `document.body`, makes every
 * other part of the page `inert` (so focus and assistive technology can't reach it), keeps Tab
 * inside while open, and closes on Escape. It focuses `initialFocus` (or the first control) on
 * open and returns focus to whatever had it before when it closes, if that is still on the page.
 */
export function ModalDialog({ labelledBy, describedBy, onClose, initialFocus, panelClassName, children }: ModalDialogProps) {
  const [host] = useState(() => document.createElement("div"));

  useLayoutEffect(() => {
    const node = host;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.append(node);
    const background = [...document.body.children].filter((child) => child !== node && !child.hasAttribute("inert"));
    for (const child of background) child.setAttribute("inert", "");
    return () => {
      for (const child of background) child.removeAttribute("inert");
      leaveBehind(node);
      node.remove();
      if (opener?.isConnected) opener.focus();
    };
  }, [host]);

  useEffect(() => {
    const target = initialFocus?.current ?? host.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    // Only on open: later re-renders must not steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // A dialog opened from this one (inline creation) is portaled elsewhere in the page but still
    // bubbles through React here; its own handler owns those keys.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        // A press on the scrim (not the panel) dismisses, like Escape.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={panelClassName ? `dialog__panel ${panelClassName}` : "dialog__panel"}>{children}</div>
    </div>,
    host,
  );
}

/**
 * Closing (docs/design/motion.md, Sheets): the dialog is gone at once, so focus returns and the
 * page works straight away, while an inert copy of it fades out over `quick` and is removed.
 */
function leaveBehind(host: HTMLElement) {
  const dialog = host.firstElementChild;
  const ms = duration("quick");
  if (!(dialog instanceof HTMLElement) || ms === 0) return;
  const ghost = dialog.cloneNode(true) as HTMLElement;
  // What the person typed is a property, not an attribute: copy it so the fading copy matches.
  const fields = dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  ghost.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach((field, index) => {
    const source = fields[index];
    if (!source) return;
    if (field instanceof HTMLInputElement && source instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) field.checked = source.checked;
    else field.value = source.value;
  });
  for (const element of [ghost, ...ghost.querySelectorAll("[id]")]) element.removeAttribute("id");
  ghost.removeAttribute("role");
  ghost.removeAttribute("aria-modal");
  ghost.removeAttribute("aria-labelledby");
  ghost.removeAttribute("aria-describedby");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.classList.add("dialog--leaving");
  document.body.append(ghost);
  window.setTimeout(() => {
    ghost.remove();
  }, ms + 50);
}

interface DialogProps {
  title: string;
  /** Short text under the title; announced as the dialog's description. */
  description?: ReactNode;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  /** Footer buttons. */
  actions?: ReactNode;
  /** Keyboard hint on the left of the footer. */
  hint?: ReactNode;
  wide?: boolean;
  /** `grouped`: the body is the sheet background, for solid grouped sections as in the cards. */
  grouped?: boolean;
  /** An icon tile before the title, e.g. the trash of a destructive confirmation. */
  icon?: ReactNode;
  /** Extra class on the panel. */
  className?: string;
  children?: ReactNode;
}

/** The web dialog from the design kit: header with a close button, body, footer with actions. */
export function Dialog({ title, description, onClose, initialFocus, actions, hint, wide, grouped, icon, className, children }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalDialog
      labelledBy={titleId}
      {...(description ? { describedBy: descriptionId } : {})}
      onClose={onClose}
      {...(initialFocus ? { initialFocus } : {})}
      panelClassName={["pk-dialog", wide && "dialog__panel--wide", grouped && "pk-dialog--grouped", className].filter(Boolean).join(" ")}
    >
      <div className="pk-dialog__head">
        {icon}
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="wbtn wbtn--icon" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} weight={44} />
        </button>
      </div>
      <div className="pk-dialog__body">
        {description ? (
          <p id={descriptionId} className="pk-dialog__desc">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {actions || hint ? (
        <div className="pk-dialog__foot">
          <span className="pk-dialog__hint">{hint}</span>
          {actions}
        </div>
      ) : null}
    </ModalDialog>
  );
}
