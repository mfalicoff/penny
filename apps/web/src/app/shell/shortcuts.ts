import { useEffect, useRef } from "react";
import { NAV_ITEMS, type NavPath } from "./navigation";

interface ShortcutHandlers {
  /** ⌘K, Ctrl+K or "/": focus search. */
  onSearch: () => void;
  /** N: open Add entry. */
  onAdd: () => void;
  /** G then a letter: go to a page. */
  onGo: (path: NavPath) => void;
}

/** How long after G the second key still counts. */
export const CHORD_MS = 1200;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
}

/**
 * Global keyboard shortcuts from the web design (⌘K, N, G H/A/I…). They never fire while the
 * user types in a field, while a modal dialog is open, or with Alt/Ctrl/⌘ held (except ⌘K/Ctrl+K),
 * so they can't swallow text or browser shortcuts. Every shortcut has a visible control too.
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    let chordUntil = 0;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "k") {
        if (document.querySelector('[aria-modal="true"]')) return;
        event.preventDefault();
        latest.current.onSearch();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || document.querySelector('[aria-modal="true"]')) return;

      if (Date.now() < chordUntil) {
        chordUntil = 0;
        const item = NAV_ITEMS.find((candidate) => candidate.key === key);
        if (item) {
          event.preventDefault();
          latest.current.onGo(item.to);
        }
        return;
      }
      if (key === "g") {
        chordUntil = Date.now() + CHORD_MS;
        return;
      }
      if (key === "/") {
        event.preventDefault();
        latest.current.onSearch();
      } else if (key === "n") {
        event.preventDefault();
        latest.current.onAdd();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
