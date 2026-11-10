import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Accessible DOM versions of the design kit's controls (MAZ-85). The kit in `design-kit/` is a
 * visual reference only; these components keep its `pk-*` look but use native elements, so
 * keyboard, focus and assistive technology work without extra code.
 */

export function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(" ");
}

/** Keyboard shortcut chip (⌘K, N, Esc). Decorative: the action it sits next to carries the name. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="pk-kbd" aria-hidden="true">
      {children}
    </kbd>
  );
}

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "danger-quiet";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  icon?: IconName;
  /** Shortcut shown in the button, e.g. "N". The shortcut itself is registered elsewhere. */
  shortcut?: string;
  /** Icon-only button: `aria-label` is required. */
  iconOnly?: boolean;
  /** Busy: stays focusable and announces itself, but ignores presses. */
  busy?: boolean;
}

/** The web button (kit `WebButton`). One copper `primary` per page. 44px tall on touch screens. */
export function Button({ variant = "secondary", icon, shortcut, iconOnly, busy, className, children, onClick, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx("wbtn", `wbtn--${variant}`, iconOnly && "wbtn--icon", className)}
      aria-disabled={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {icon ? <Icon name={icon} size={16} weight={44} /> : null}
      {children}
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </button>
  );
}

interface SwitchRowProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** A settings row with a switch (kit `Switch` + `ListRow`). The label toggles it; the description is announced with it. */
export function SwitchRow({ label, description, checked, onChange, disabled }: SwitchRowProps) {
  const id = useId();
  const descriptionId = useId();
  return (
    <div className="setting-row">
      <div className="setting-row__body">
        <label htmlFor={id} className="setting-row__title">
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className="setting-row__desc">
            {description}
          </span>
        ) : null}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
    </div>
  );
}

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** Visual sample shown above the label (theme cards). */
  preview?: ReactNode;
  disabled?: boolean;
}

interface ChoiceGroupProps<T extends string> {
  legend: string;
  /** Hide the legend visually but keep it for assistive technology. */
  hideLegend?: boolean;
  name: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  /** `segmented` is the kit's SegmentedControl; `cards` the appearance swatches. */
  appearance?: "segmented" | "cards" | "list";
  describedBy?: string;
}

/**
 * One choice from a few (kit `SegmentedControl`, theme cards, currency list). Native radios, so
 * arrow keys move the selection and screen readers announce "1 of 3".
 */
export function ChoiceGroup<T extends string>({ legend, hideLegend, name, value, options, onChange, appearance = "segmented", describedBy }: ChoiceGroupProps<T>) {
  return (
    <fieldset className={cx("choices", `choices--${appearance}`)} aria-describedby={describedBy}>
      <legend className={hideLegend ? "visually-hidden" : "choices__legend"}>{legend}</legend>
      <div className="choices__options">
        {options.map((option) => (
          <label key={option.value} className={cx("choice", option.value === value && "choice--on", option.disabled && "choice--disabled")}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => {
                onChange(option.value);
              }}
            />
            {option.preview}
            <span className="choice__label">{option.label}</span>
            {option.description ? <span className="choice__desc">{option.description}</span> : null}
            {appearance === "list" && option.value === value ? <Icon name="checkmark" size={18} weight={48} /> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type Tone = "neutral" | "income" | "investment" | "pending" | "danger";

/** Small status label. Always text, so meaning never rests on color alone. */
export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`pk-badge pk-badge--${tone}`}>
      {icon ? <Icon name={icon} size={12} weight={48} /> : null}
      {children}
    </span>
  );
}

/** Gray monogram, like iOS Contacts (kit `Avatar`). Decorative next to a visible name. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className="pk-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials(name)}
    </span>
  );
}

export function initials(name: string): string {
  const words = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : (words[0]?.slice(0, 2) ?? "");
  return letters.toUpperCase() || "?";
}

/** Panel surface (kit `Card`): solid, never glass, because money lives on it. */
export function Card({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  const headingId = useId();
  return (
    <section className={cx("card", className)} aria-labelledby={title ? headingId : undefined}>
      {title ? (
        <div className="card__head">
          <h2 id={headingId} className="card__title">
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
