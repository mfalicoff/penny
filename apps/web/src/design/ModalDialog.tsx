import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalDialogProps {
  /** Id of the element that names the dialog. */
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal dialog that really is modal: it renders in a portal on `document.body`, makes every
 * other part of the page `inert` (so focus and assistive technology can't reach it), keeps Tab
 * inside while open, and closes on Escape. The caller moves initial focus and restores it on close.
 */
export function ModalDialog({ labelledBy, onClose, children }: ModalDialogProps) {
  const [host] = useState(() => document.createElement("div"));

  useEffect(() => {
    const node = host;
    document.body.append(node);
    const background = [...document.body.children].filter((child) => child !== node && !child.hasAttribute("inert"));
    for (const child of background) child.setAttribute("inert", "");
    return () => {
      for (const child of background) child.removeAttribute("inert");
      node.remove();
    };
  }, [host]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      <div className="dialog__panel">{children}</div>
    </div>,
    host,
  );
}
