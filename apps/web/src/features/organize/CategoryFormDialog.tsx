import { useId, useRef, useState, type SyntheticEvent } from "react";
import { saveCategory } from "@domain/commands.ts";
import { kinds, uid, type Category, type Kind, type Ledger } from "@domain/ledger.ts";
import { Button, ChoiceGroup, cx } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { SaveErrorBanner, useToast } from "../../design/states";
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  categoryIcon,
  categoryNameProblem,
  categoryUsage,
  inUse,
  kindLabels,
  moveCategoryAndRemove,
  NAME_MAX,
  RECORD_LIMIT,
  restoreCategory,
  storedIcon,
  usageOf,
  usageSentence,
  type Moved,
} from "./model";
import { describeSaveError, detailOf, savedDetail, type LedgerWorkspace } from "./workspace";

interface CategoryFormDialogProps {
  /** The category to edit; omit to add one. */
  category?: Category;
  workspace: Pick<LedgerWorkspace, "save"> & { ledger: Ledger };
  /** The kind a new category starts with. */
  initialKind?: Kind;
  /** Inline creation from an entry form: the kind is the entry's and can't change here. */
  fixedKind?: boolean;
  onClose: () => void;
  /** Called with the saved category before the dialog closes (inline creation selects it). */
  onSaved?: (category: Category) => void;
}

/**
 * Add or edit a category (card `iphone-category-form`): name, kind, a color from the category
 * palette and an icon. The kind of a category that entries use can't change, because each entry
 * must keep a category of its own kind. An in-use category can't be removed until its entries move
 * to another category of the same kind, which this dialog can do in one step.
 */
export function CategoryFormDialog({ category, workspace, initialKind = "expense", fixedKind = false, onClose, onSaved }: CategoryFormDialogProps) {
  const { ledger, save } = workspace;
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<Kind>(category?.kind ?? initialKind);
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0]?.value ?? "#3B82F6");
  const [icon, setIcon] = useState<IconName>(category ? categoryIcon(category.icon) : "pricetag");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; retry: () => void } | null>(null);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { form: useId(), name: useId(), nameError: useId(), kindNote: useId(), color: useId(), icon: useId(), remove: useId(), moveTo: useId() };

  const usage = category ? usageOf(categoryUsage(ledger), category.id) : null;
  const used = usage ? inUse(usage) : false;
  const kindLocked = fixedKind || used;
  const others = category ? ledger.categories.filter((item) => item.id !== category.id && item.kind === category.kind) : [];
  const atLimit = !category && ledger.categories.length >= RECORD_LIMIT;
  // A color saved by an older app (not in today's palette) stays selectable, so editing never forces a change.
  const colors = CATEGORY_COLORS.some((option) => option.value.toLowerCase() === color.toLowerCase()) || !category
    ? CATEGORY_COLORS
    : [{ value: category.color, name: "Current color" }, ...CATEGORY_COLORS];

  async function run(kindOfWork: "save" | "remove", action: () => Promise<void>) {
    if (busy) return;
    setBusy(kindOfWork);
    setSaveError(null);
    try {
      await action();
    } catch (error) {
      setSaveError({ message: describeSaveError(error), retry: () => void run(kindOfWork, action) });
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    // This form can open over an entry form (inline creation); its submit must not reach that one.
    event.stopPropagation();
    const problem = categoryNameProblem(ledger, name, kind, category?.id);
    setNameError(problem);
    if (problem) {
      nameRef.current?.focus();
      return;
    }
    // Keep the stored icon when it wasn't changed, so an icon the web can't draw isn't rewritten.
    const iconValue = category && categoryIcon(category.icon) === icon ? category.icon : storedIcon(icon);
    const item: Category = { id: category?.id ?? uid(), name: name.trim(), icon: iconValue, color, kind };
    void run("save", async () => {
      const receipt = await save(saveCategory(item, category));
      toast.show({ title: category ? "Category saved" : `${item.name} added`, ...detailOf(receipt) });
      onSaved?.(item);
      onClose();
    });
  }

  function remove() {
    if (!category) return;
    const target = others.find((item) => item.id === moveTo);
    if (used && !target) return;
    void run("remove", async () => {
      let moved: Moved = { entryIds: [], scheduleIds: [] };
      const change = target
        ? moveCategoryAndRemove(category, target, (value) => {
            moved = value;
          })
        : saveCategory(category, category, true);
      const receipt = await save(change);
      toast.show({
        title: target ? `${category.name} removed` : "Category removed",
        detail: savedDetail(receipt) ?? (target ? `Its ${usage ? usageSentence(usage) : "entries"} now use ${target.name}.` : category.name),
        onUndo: () => {
          void save(restoreCategory(category, moved, target?.id)).catch((error: unknown) => {
            toast.show({ title: "Couldn't undo", detail: describeSaveError(error), tone: "error" });
          });
        },
      });
      onClose();
    });
  }

  const title = category ? "Edit category" : fixedKind ? `New ${kindLabels[kind].toLowerCase()} category` : "New category";
  return (
    <Dialog
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      initialFocus={nameRef}
      actions={
        <>
          <Button variant="quiet" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={ids.form} busy={busy === "save"} disabled={atLimit}>
            {busy === "save" ? "Saving…" : category ? "Save" : "Add category"}
          </Button>
        </>
      }
    >
      <form id={ids.form} className="form" onSubmit={onSubmit} noValidate aria-label={title}>
        {saveError ? <SaveErrorBanner message={saveError.message} onRetry={saveError.retry} retrying={busy !== null} /> : null}
        {atLimit ? (
          <p className="form-error" role="alert">
            You have {String(RECORD_LIMIT)} categories, the most Penny keeps. Remove one you don't use to add another.
          </p>
        ) : null}
        <span className="organize-preview" style={{ background: color }} aria-hidden="true">
          <Icon name={icon} size={32} />
        </span>
        <div className="form-field">
          <label htmlFor={ids.name}>Name</label>
          <input
            id={ids.name}
            ref={nameRef}
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            placeholder="Coffee, rent, side project"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? ids.nameError : undefined}
            onChange={(event) => {
              setName(event.currentTarget.value);
              if (nameError) setNameError(null);
            }}
          />
          {nameError ? (
            <span id={ids.nameError} className="form-error" role="alert">
              {nameError}
            </span>
          ) : null}
        </div>
        {fixedKind ? null : (
          <>
            <ChoiceGroup<Kind>
              legend="Kind"
              name={`${ids.form}-kind`}
              value={kind}
              onChange={(value) => {
                setKind(value);
                if (nameError) setNameError(null);
              }}
              options={kinds.map((value) => ({ value, label: kindLabels[value], disabled: kindLocked && value !== kind }))}
              {...(kindLocked ? { describedBy: ids.kindNote } : {})}
            />
            {kindLocked ? (
              <p id={ids.kindNote} className="form-hint">
                Entries use this category, so it stays an {kindLabels[kind].toLowerCase()} category.
              </p>
            ) : null}
          </>
        )}
        <fieldset className="organize-swatches">
          <legend className="choices__legend">Color</legend>
          <div className="organize-swatches__options">
            {colors.map((option) => (
              <label key={option.value} className="organize-swatch" title={option.name}>
                <input
                  type="radio"
                  name={ids.color}
                  value={option.value}
                  aria-label={option.name}
                  checked={option.value.toLowerCase() === color.toLowerCase()}
                  onChange={() => {
                    setColor(option.value);
                  }}
                />
                <span className="organize-swatch__dot" style={{ background: option.value }} aria-hidden="true">
                  <Icon name="checkmark" size={16} weight={56} />
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="organize-icons">
          <legend className="choices__legend">Icon</legend>
          <div className="organize-icons__options">
            {CATEGORY_ICONS.map((option) => (
              <label key={option.name} className={cx("organize-icon", option.name === icon && "organize-icon--on")} title={option.label}>
                <input
                  type="radio"
                  name={ids.icon}
                  value={option.name}
                  aria-label={option.label}
                  checked={option.name === icon}
                  onChange={() => {
                    setIcon(option.name);
                  }}
                />
                <span className="organize-icon__glyph" aria-hidden="true" style={option.name === icon ? { background: color } : undefined}>
                  <Icon name={option.name} size={22} />
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>

      {category ? (
        <section className="organize-remove" aria-labelledby={ids.remove}>
          <h3 id={ids.remove}>Remove category</h3>
          {used && usage ? (
            <>
              <p className="form-hint">
                {category.name} is used by {usageSentence(usage)}. Move them to another {kindLabels[category.kind].toLowerCase()} category to remove it. Renaming keeps every
                entry in it.
              </p>
              {others.length ? (
                <div className="organize-remove__move">
                  <div className="form-field">
                    <label htmlFor={ids.moveTo}>Move them to</label>
                    <select
                      id={ids.moveTo}
                      value={moveTo}
                      onChange={(event) => {
                        setMoveTo(event.currentTarget.value);
                      }}
                    >
                      <option value="">Choose a category</option>
                      {others.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button variant="danger" icon="trash" onClick={remove} busy={busy === "remove"} disabled={!moveTo || (busy !== null && busy !== "remove")}>
                    {busy === "remove" ? "Removing…" : "Move and remove"}
                  </Button>
                </div>
              ) : (
                <p className="note">
                  <Icon name="lock-closed" size={14} /> Add another {kindLabels[category.kind].toLowerCase()} category first, then move them there.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="form-hint">Nothing uses {category.name}. Shared expenses keep their own copy of a category, so removing it changes none of them.</p>
              <div>
                <Button variant="danger-quiet" icon="trash" onClick={remove} busy={busy === "remove"} disabled={busy !== null && busy !== "remove"}>
                  {busy === "remove" ? "Removing…" : "Remove category"}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </Dialog>
  );
}
