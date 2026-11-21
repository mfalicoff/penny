import type { Kind } from "@domain/ledger.ts";
import {
  useId,
  useState,
  type FormHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  TABLET,
  TOUCH_TABLET,
  useMediaQuery,
  WIDE,
} from "../../app/useMediaQuery";
import { cx, Kbd } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";
import { tileStyle, type TintSource } from "../../design/categoryTint";
import { ModalDialog } from "../../design/ModalDialog";
import { categoryIcon } from "./model";
import "../../design/entry.css";

/**
 * The parts Add entry and the shared expense form are drawn from (MAZ-226), after the cards
 * `iphone-add-expense`, `iphone-add-income`, `ipad-add-entry` and `web-add-entry`: a large amount
 * leads, the title is a filled field, categories are chips filled with their color when chosen, and
 * Date, Account, Split, Repeat and Trip are labelled rows.
 */

/**
 * Which card the form follows: `phone` below 768px (`iphone-add-expense`), `tablet` on a touch
 * tablet or a narrow desktop window (`ipad-add-entry`), `desktop` from 1100px with a mouse
 * (`web-add-entry`).
 */
export type EntryLayout = "phone" | "tablet" | "desktop";

export function useEntryLayout(): EntryLayout {
  const tablet = useMediaQuery(TABLET);
  const wide = useMediaQuery(WIDE);
  const touch = useMediaQuery(TOUCH_TABLET);
  if (!tablet) return "phone";
  return wide && !touch ? "desktop" : "tablet";
}

export const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/** The segmented control's labels: the cards shorten Investment to Invest. */
export const KIND_SEGMENTS: Record<Kind, string> = {
  expense: "Expense",
  income: "Income",
  investment: "Invest",
};

/** The primary button of a new entry: "Add expense", "Add income", "Add investment". */
export const addLabel = (kind: Kind) => `Add ${kind}`;

interface EntryDialogProps {
  layout: EntryLayout;
  title: string;
  /** Under the title (the shared expense's household, `iphone-shared-expense-add`). */
  subtitle?: string;
  /** The Expense / Income / Invest control, in the header from the tablet width. */
  kindControl?: ReactNode;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  /** Footer buttons before the primary one (Cancel, Discard draft). Not shown on the tablet card. */
  secondary?: ReactNode;
  /** The primary button: in the header on the tablet card, in the footer otherwise. */
  primary: ReactNode;
  /** Two panes from the tablet width: the amount, title and categories, then the details. */
  main: ReactNode;
  details: ReactNode;
  /** Above both panes: banners and notes. */
  notices?: ReactNode;
  /** The form: the whole dialog, so the kind control and the footer buttons belong to it (id, submit, label). */
  form: FormHTMLAttributes<HTMLFormElement> & { id: string };
  /** ⌘↵ / Ctrl+Enter from anywhere in the dialog, the kind control included. */
  onKeyDown?: (event: KeyboardEvent<HTMLFormElement>) => void;
  /** Pickers opened from the form (rendered in their own portal). */
  children?: ReactNode;
}

/**
 * The entry dialog. On the web card (`web-add-entry`) it is titled with the kind control beside
 * the title, two panes, and a footer with the keyboard hint, Cancel and the primary button. The
 * iPad card puts close, the kind control and the primary button in the header, with only the
 * hint in the footer. On phones the title, then the kind control, the form in one column and a
 * Cancel/Save footer (the web conventions, MAZ-227).
 */
export function EntryDialog({
  layout,
  title,
  subtitle,
  kindControl,
  onClose,
  initialFocus,
  secondary,
  primary,
  main,
  details,
  notices,
  form,
  onKeyDown,
  children,
}: EntryDialogProps) {
  const titleId = useId();
  const mac = isMac();
  const close = (
    <button
      type="button"
      className="wbtn wbtn--icon entry-dialog__close"
      aria-label="Close"
      onClick={onClose}
    >
      <Icon name="close" size={16} weight={44} />
    </button>
  );
  const heading = (
    <div
      className={cx(
        "entry-dialog__title",
        layout === "tablet" && "visually-hidden",
      )}
    >
      <h2 id={titleId}>{title}</h2>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  );
  return (
    <ModalDialog
      labelledBy={titleId}
      onClose={onClose}
      {...(initialFocus ? { initialFocus } : {})}
      panelClassName={`pk-dialog entry-dialog entry-dialog--${layout}`}
    >
      <form {...form} className="entry-dialog__frame" noValidate onKeyDown={onKeyDown}>
        <div className="entry-dialog__head">
          {layout === "tablet" ? (
            <>
              {close}
              {heading}
              <span className="entry-dialog__kind">{kindControl}</span>
              {primary}
            </>
          ) : (
            <>
              {heading}
              {layout === "desktop" ? (
                <span className="entry-dialog__kind">{kindControl}</span>
              ) : null}
              {close}
            </>
          )}
        </div>
        {notices ? (
          <div className="entry-dialog__notices">{notices}</div>
        ) : null}
        {layout === "phone" && kindControl ? (
          <div className="entry-dialog__kind entry-dialog__kind--phone">
            {kindControl}
          </div>
        ) : null}
        <div className="form entry-dialog__body">
          <div className="entry-dialog__main">{main}</div>
          <div className="entry-dialog__details">{details}</div>
        </div>
        <div className="pk-dialog__foot entry-dialog__foot">
          {layout === "tablet" ? (
            <span className="pk-dialog__hint">
              <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>↵</Kbd> Add <Kbd>esc</Kbd> Cancel <Kbd>⇥</Kbd> Next field
            </span>
          ) : layout === "desktop" ? (
            <span className="pk-dialog__hint">
              <Kbd>Tab</Kbd> next field · <Kbd>{mac ? "⌘↵" : "Ctrl ↵"}</Kbd>{" "}
              save · <Kbd>Esc</Kbd> cancel
            </span>
          ) : null}
          {layout === "tablet" ? null : (
            <>
              {secondary}
              {primary}
            </>
          )}
        </div>
      </form>
      {children}
    </ModalDialog>
  );
}

/** The kind control in the header: Expense, Income, Invest. Native radios, so arrow keys move it. */
export function KindControl({
  value,
  onChange,
  name,
}: {
  value: Kind;
  onChange: (kind: Kind) => void;
  name: string;
}) {
  const kinds: Kind[] = ["expense", "income", "investment"];
  return (
    <fieldset className="choices choices--segmented entry-kind">
      <legend className="visually-hidden">Type</legend>
      <div className="choices__options">
        {kinds.map((kind) => (
          <label
            key={kind}
            className={cx("choice", kind === value && "choice--on")}
          >
            <input
              type="radio"
              name={name}
              value={kind}
              checked={kind === value}
              onChange={() => {
                onChange(kind);
              }}
            />
            <span className="choice__label">{KIND_SEGMENTS[kind]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The currency's symbol in Penny's locale ("$" for CAD, "US$" for USD). */
export function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat("en-CA", { style: "currency", currency })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}

/** "3200.5" as the cards draw it while not being typed: "3,200.5". Anything else is left as typed. */
export function groupAmount(value: string): string {
  const match = /^(\d+)(\.\d*)?$/.exec(value.trim());
  if (!match?.[1]) return value;
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[2] ?? ""}`;
}

interface AmountHeroProps {
  id: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  currency: string;
  kind: Kind;
  disabled?: boolean;
  /** `aria-invalid` and `aria-describedby` when the amount has an error. */
  invalid?: Record<string, unknown>;
  error?: ReactNode;
}

/**
 * The amount as the screen's one large number: the currency symbol faded before it, green with a
 * plus for income (`iphone-add-income`), the currency as a pill under it on the iPhone and iPad
 * cards. Typed with the keyboard (MAZ-227); grouped with commas when not being typed.
 */
export function AmountHero({
  id,
  inputRef,
  value,
  onChange,
  currency,
  kind,
  disabled,
  invalid,
  error,
}: AmountHeroProps) {
  const [focused, setFocused] = useState(false);
  const shown = focused ? value : groupAmount(value);
  return (
    <div className={`amount-hero amount-hero--${kind}`}>
      <label htmlFor={id} className="visually-hidden">
        Amount ({currency})
      </label>
      <div className="amount-hero__line">
        <span className="amount-hero__symbol" aria-hidden="true">
          {kind === "income" ? "+" : ""}
          {currencySymbol(currency)}
        </span>
        <input
          id={id}
          ref={inputRef}
          className="amount-hero__input"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          size={Math.max(shown.length, 4)}
          value={shown}
          disabled={disabled}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          onChange={(event) => {
            onChange(event.currentTarget.value.replace(/,/g, ""));
          }}
          {...invalid}
        />
      </div>
      <span className="amount-hero__currency" aria-hidden="true">
        {currency}
      </span>
      {error}
    </div>
  );
}

interface ChipCategory {
  key: string;
  name: string;
  /** For the chip's color: a ledger category, or a shared one matched to it. */
  tint: TintSource | undefined;
  icon: string | undefined;
}

interface CategoryChipsProps {
  id: string;
  name: string;
  categories: ChipCategory[];
  selected: string | undefined;
  onChoose: (key: string) => void;
  /** Opens every category (the card's "All…" chip). */
  onAll?: () => void;
  empty?: ReactNode;
  error?: ReactNode;
  describedBy?: string;
}

/**
 * The category chips (cards' `.wchip`): gray, with the chosen one filled with its category color
 * and white text. The last chip opens every category.
 */
export function CategoryChips({
  id,
  name,
  categories,
  selected,
  onChoose,
  onAll,
  empty,
  error,
  describedBy,
}: CategoryChipsProps) {
  return (
    <fieldset
      className="choices entry-chips"
      id={id}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
    >
      <legend className="entry-label">Category</legend>
      <div className="entry-chips__row">
        {categories.map((category) => {
          const on = category.key === selected;
          return (
            <label
              key={category.key}
              className={cx("entry-chip", on && "entry-chip--on")}
              style={tileStyle(category.tint)}
            >
              <input
                type="radio"
                name={name}
                value={category.key}
                checked={on}
                onChange={() => {
                  onChoose(category.key);
                }}
              />
              <Icon name={categoryIcon(category.icon)} size={15} weight={40} />
              <span>{category.name}</span>
            </label>
          );
        })}
        {onAll ? (
          <button
            type="button"
            className="entry-chip entry-chip--all"
            aria-label="All categories"
            aria-haspopup="dialog"
            onClick={onAll}
          >
            <span className="entry-chip__dots">
              <Icon name="ellipsis-horizontal" size={16} weight={44} />
            </span>
            <span className="entry-chip__all">All</span>
          </button>
        ) : null}
      </div>
      {empty}
      {error}
    </fieldset>
  );
}

/** A grouped list of detail rows (the cards' `.drow` and inset list). */
export function DetailList({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="entry-rows"
      role="group"
      {...(label ? { "aria-label": label } : {})}
    >
      {children}
    </div>
  );
}

interface RowProps {
  icon: IconName;
  label: string;
  /** The control's id, so the visible label names it. */
  htmlFor?: string;
  /** Chevron after the value: down for a menu, forward for something that opens. */
  chevron?: "down" | "forward";
  children: ReactNode;
  className?: string;
}

/** One labelled row: icon, label, then its value control on the right. */
export function DetailRow({
  icon,
  label,
  htmlFor,
  chevron,
  children,
  className,
}: RowProps) {
  return (
    <div className={cx("entry-row", className)}>
      <Icon name={icon} size={18} />
      {htmlFor ? (
        <label htmlFor={htmlFor} className="entry-row__label">
          {label}
        </label>
      ) : (
        <span className="entry-row__label">{label}</span>
      )}
      <span className="entry-row__value">
        {children}
        {chevron ? (
          <Icon
            name={chevron === "down" ? "chevron-down" : "chevron-forward"}
            size={13}
            weight={48}
          />
        ) : null}
      </span>
    </div>
  );
}

/**
 * The date row: shows "Today" or "Fri, Oct 30" as the card does, with the browser's date field
 * over it. The field shows itself while it has focus, so the date can be typed, and opens its
 * picker on a click.
 */
export function DateRowInput({
  id,
  value,
  onChange,
  today,
  long,
  invalid,
  inputRef,
  text,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  today: string;
  long: boolean;
  invalid?: Record<string, unknown>;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Shown instead of "Today" or "Fri, Oct 30" (the trip form's "Nov 12, 2026"). */
  text?: string;
}) {
  return (
    <span className="entry-date">
      <span className="entry-date__text" aria-hidden="true">
        {text ?? rowDate(value, today, long)}
      </span>
      <input
        id={id}
        ref={inputRef}
        type="date"
        min="2000-01-01"
        max="2100-12-31"
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker();
          } catch {
            // Not every browser opens the picker from script; the field is still typed.
          }
        }}
        {...invalid}
      />
    </span>
  );
}

/** "Today" (the web card: "Today, Oct 15"), otherwise "Fri, Oct 30". */
export function rowDate(value: string, today: string, long: boolean): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value ? value : "Choose a date";
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  const day = date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  });
  if (value === today) return long ? `Today, ${day}` : "Today";
  return `${date.toLocaleDateString("en-CA", { weekday: "short" })}, ${day}`;
}

/** "Monthly on the 15th" for the Repeat row (`iphone-add-income`). */
export function repeatText(
  repeat: "none" | "weekly" | "monthly" | "yearly",
  date: string,
): string {
  if (repeat === "none") return "Never";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match)
    return repeat === "weekly"
      ? "Weekly"
      : repeat === "monthly"
        ? "Monthly"
        : "Yearly";
  const when = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (repeat === "weekly")
    return `Weekly on ${when.toLocaleDateString("en-CA", { weekday: "long" })}`;
  if (repeat === "monthly") return `Monthly on the ${ordinal(when.getDate())}`;
  return `Yearly on ${when.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
}

function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen
    ? "th"
    : day % 10 === 1
      ? "st"
      : day % 10 === 2
        ? "nd"
        : day % 10 === 3
          ? "rd"
          : "th";
  return `${String(day)}${suffix}`;
}
