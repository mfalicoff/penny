import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { useTopbarSlot } from "../../app/shell/pageTitle";
import { cx } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";

/**
 * A household's or trip's navigation-bar tools (MAZ-229): the round glass icons of the iPhone and
 * iPad cards (`iphone-shared`, `iphone-trip-detail`, `ipad-shared`, `ipad-trip`) and, from 1100px,
 * the `web-household` header's buttons. They go in the top bar's tools slot beside the title.
 *
 * `lead` (the month control) sits right after the title from 768px; the tools go to the end of
 * the bar. `ownAdd` says the page brings its own add action from 1100px, so the top bar's Add entry
 * and search step aside, as on the `web-household` and `ipad-*` cards.
 */
export function GroupToolbar({ lead, ownAdd, children }: { lead?: ReactNode; ownAdd?: boolean; children: ReactNode }) {
  const slot = useTopbarSlot();
  const bar = (
    <div className={cx("group-tools", ownAdd && "group-tools--own-add")}>
      {lead ? <div className="group-tools__lead">{lead}</div> : null}
      <div className="group-tools__end">{children}</div>
    </div>
  );
  return slot ? createPortal(bar, slot) : bar;
}

/**
 * One round tool. Its name is always the accessible name; `labelled` shows it beside the icon from
 * 1100px (the `web-household` card's Invite). `primary` is the copper add action, which pages
 * render from 1100px only: narrower, it's in the page's hero or the … menu.
 */
export function ToolButton({ ref, icon, label, labelled, primary, onClick }: { ref?: Ref<HTMLButtonElement>; icon: IconName; label: string; labelled?: boolean; primary?: boolean; onClick: () => void }) {
  const named = labelled || primary;
  return (
    <button ref={ref} type="button" className={cx("group-tool", !primary && "glass", labelled && "group-tool--labelled", primary && "group-tool--primary")} aria-label={named ? undefined : label} onClick={onClick}>
      <Icon name={icon} size={primary ? 18 : 20} />
      {named ? <span className="group-tool__label">{label}</span> : null}
    </button>
  );
}

/** The class of a tool that is a link (History and Invite keep their URL, so Back works). */
export function toolClass({ labelled }: { labelled?: boolean } = {}) {
  return cx("group-tool", "glass", labelled && "group-tool--labelled");
}

/** A tool link's content: the icon, and the name, shown from 1100px when `labelled`. */
export function ToolContent({ icon, label, labelled }: { icon: IconName; label: string; labelled?: boolean }) {
  return (
    <>
      <Icon name={icon} size={20} />
      <span className={labelled ? "group-tool__label" : "visually-hidden"}>{label}</span>
    </>
  );
}

export interface MoreItem {
  label: string;
  icon: IconName;
  onSelect: () => void;
}

/**
 * The cards' … button: a disclosure with the less frequent actions. It closes on Escape (focus
 * returns to the button), on a click outside, and once an item is chosen.
 */
export function MoreMenu({ items, label }: { items: MoreItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>(".more-menu__item")?.focus();
    function onPointer(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (!items.length) return null;
  return (
    <div
      ref={root}
      className="more-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button ref={button} type="button" className="group-tool glass" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setOpen((value) => !value); }}>
        <Icon name="ellipsis-horizontal" size={20} />
      </button>
      {open ? (
        <ul id={id} className="more-menu__list" aria-label={label}>
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                className="more-menu__item"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
