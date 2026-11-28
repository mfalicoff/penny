import { currencyInfo } from "@domain/currency.ts";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { cx, Kbd } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { menuSections, type SuggestedCurrency } from "./currency";

/**
 * The entry's currency (MAZ-151, `web-add-entry-currency`): a chip beside the amount on the web
 * card (the pill under it on narrower layouts) that opens a menu: Search currencies, Suggested (the
 * home currency), Recent, then every currency A–Z, with "No decimals" for currencies without minor
 * units. Keyboard: ↓ from the search moves into the list, ↑ and ↓ move, Enter picks (in the search,
 * the first match), Escape closes and focus returns to the chip. Like the Activity menus, it is a
 * non-modal panel inside the dialog, so the dialog's focus trap and Escape keep working.
 */
export function CurrencyMenu({
  code,
  home,
  recent,
  onPick,
  locked,
  className,
  suggested,
  lockedTo,
  named = false,
}: {
  code: string;
  home: string;
  recent: readonly string[];
  onPick: (code: string) => void;
  /** Why only the home currency (or `lockedTo`) can be picked now (a repeating entry), or null. */
  locked: string | null;
  className?: string;
  /** A trip's or household's currency, suggested above the home one (MAZ-151 phase 2). */
  suggested?: SuggestedCurrency | null;
  /** The one currency `locked` still allows, when it isn't the home one (a household's own). */
  lockedTo?: string;
  /** The chip also names the currency ("EUR Euro"), as the trip form's Currency row (`web-trip-form-currency`). */
  named?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const name = currencyInfo(code)?.name ?? code;
  return (
    <span className={cx("currency-menu-anchor", className)}>
      <button
        ref={triggerRef}
        type="button"
        className={cx("currency-chip", named && "currency-chip--named", open && "currency-chip--open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Currency: ${code}, ${name}`}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className="currency-chip__code">{code}</span>
        {named ? <span className="currency-chip__name">{name}</span> : null}
        <Icon name="chevron-down" size={12} weight={48} />
      </button>
      {open ? (
        <CurrencyPanel
          id={id}
          code={code}
          home={home}
          recent={recent}
          locked={locked}
          lockedTo={lockedTo ?? home}
          suggested={suggested ?? null}
          triggerRef={triggerRef}
          onClose={() => {
            setOpen(false);
          }}
          onPick={(next) => {
            setOpen(false);
            triggerRef.current?.focus();
            if (next !== code) onPick(next);
          }}
        />
      ) : null}
    </span>
  );
}

const OPTION = ".currency-menu__option";

function CurrencyPanel({
  id,
  code,
  home,
  recent,
  locked,
  lockedTo,
  suggested,
  triggerRef,
  onClose,
  onPick,
}: {
  id: string;
  code: string;
  home: string;
  recent: readonly string[];
  locked: string | null;
  lockedTo: string;
  suggested: SuggestedCurrency | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onPick: (code: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const sections = menuSections(query, home, recent, suggested);
  const unavailable = (option: string) => locked !== null && option !== lockedTo;

  useEffect(() => {
    searchRef.current?.focus();
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) onClose();
    }
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [onClose, triggerRef]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Enter" && event.target === searchRef.current) {
      // In the search, Enter picks the first match instead of submitting the entry.
      event.preventDefault();
      const first = sections[0]?.items.find((item) => !unavailable(item.info.code));
      if (first) onPick(first.info.code);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const all = [...(panelRef.current?.querySelectorAll<HTMLElement>(OPTION) ?? [])];
    if (all.length === 0) return;
    event.preventDefault();
    const index = all.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = all.length - 1;
    else if (index < 0) next = event.key === "ArrowDown" ? 0 : all.length - 1;
    else if (event.key === "ArrowUp" && index === 0) {
      searchRef.current?.focus();
      return;
    } else next = Math.min(all.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
    all[next]?.focus();
    (all[next] as Partial<HTMLElement> | undefined)?.scrollIntoView?.({ block: "nearest" });
  }

  return (
    <div ref={panelRef} id={id} className="currency-menu" role="dialog" aria-label="Currency" onKeyDown={onKeyDown}>
      <label className="currency-menu__search">
        <Icon name="search" size={14} />
        <span className="visually-hidden">Search currencies</span>
        <input
          ref={searchRef}
          type="search"
          autoComplete="off"
          placeholder="Search currencies"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />
        <span aria-hidden="true">
          <Kbd>↓</Kbd>
        </span>
      </label>
      {locked ? (
        <p className="currency-menu__note">
          <Icon name="repeat" size={14} />
          {locked}
        </p>
      ) : null}
      {sections.length === 0 ? <p className="currency-menu__empty">No currency matches “{query.trim()}”.</p> : null}
      {sections.map((section) => (
        <section key={section.title} className="currency-menu__section" aria-label={section.title}>
          <h3 className="currency-menu__heading">{section.title}</h3>
          <ul className="currency-menu__list">
            {section.items.map(({ info, note }) => {
              const on = info.code === code;
              const off = unavailable(info.code);
              return (
                <li key={info.code}>
                  <button
                    type="button"
                    className={cx("currency-menu__option", on && "currency-menu__option--on")}
                    aria-label={`${info.code}, ${info.name}${note ? `, ${note}` : ""}`}
                    aria-current={on ? "true" : undefined}
                    aria-disabled={off || undefined}
                    onClick={() => {
                      if (!off) onPick(info.code);
                    }}
                  >
                    <b className="currency-menu__code">{info.code}</b>
                    <span className="currency-menu__name">{info.name}</span>
                    {note ? <span className="currency-menu__aside">{note}</span> : null}
                    {on ? <Icon name="checkmark" size={14} weight={48} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
