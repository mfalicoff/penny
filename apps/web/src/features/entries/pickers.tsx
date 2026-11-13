import { saveAccount, saveCategory, type LedgerChange } from "@domain/commands.ts";
import { accountTypeLabels, accountTypes, palette, uid, type AccountType, type Category, type Kind } from "@domain/ledger.ts";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { Button, ChoiceGroup, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import type { SaveReceipt } from "../../offline/engine";
import { RECORD_LIMIT } from "../organize/model";
import { categoryIcon, KIND_PLURAL } from "./model";

type Save = (change: LedgerChange) => Promise<SaveReceipt>;

const errorText = (error: unknown) => (error instanceof Error ? error.message : "That couldn't be saved. Try again.");

/**
 * "All categories" (specimen `category-picker`): every category of the kind, filterable, as a list
 * of buttons, so arrow keys never change the choice by accident. With `save`, a category can be
 * created inline: it is saved through the offline store and chosen at once, and the form behind
 * keeps its draft. Escape or Close returns focus to the button that opened the picker.
 */
export function CategoryPickerDialog({
  title = "Choose a category",
  kind,
  categories,
  selected,
  onSelect,
  onClose,
  save,
  allLabel,
}: {
  title?: string;
  kind?: Kind;
  categories: Category[];
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  onClose: () => void;
  save?: Save | null;
  /** Offer a "no filter" choice with this label (Activity's "All categories"). */
  allLabel?: string;
}) {
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { filter: useId(), name: useId(), error: useId() };
  const needle = filter.trim().toLowerCase();
  const shown = categories.filter((category) => !needle || category.name.toLowerCase().includes(needle));

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || !save || !kind) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 50) {
      setError("Give the category a name of up to 50 characters.");
      nameRef.current?.focus();
      return;
    }
    const category: Category = { id: uid(), name: trimmed, icon: "pricetag-outline", color: palette[categories.length % palette.length] ?? "#89918C", kind };
    setBusy(true);
    setError(null);
    try {
      // Checked against the stored ledger: the server refuses more than RECORD_LIMIT categories,
      // which would hold back every pending change.
      await save((ledger) => {
        if (ledger.categories.length >= RECORD_LIMIT) throw new Error(`You have ${String(RECORD_LIMIT)} categories, the most Penny keeps. Remove one you don't use to add another.`);
        return saveCategory(category)(ledger);
      });
      onSelect(category.id);
      onClose();
    } catch (failure) {
      setError(errorText(failure));
      nameRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose} initialFocus={filterRef}>
      <div className="form">
        <div className="form-field">
          <label htmlFor={ids.filter}>Find a category</label>
          <input id={ids.filter} ref={filterRef} type="search" autoComplete="off" value={filter} onChange={(event) => { setFilter(event.currentTarget.value); }} />
        </div>
        <ul className="picker-list" aria-label={kind ? `${KIND_PLURAL[kind]} categories` : "Categories"}>
          {allLabel ? (
            <li>
              <button type="button" className={cx("picker-option", selected === undefined && "picker-option--on")} aria-pressed={selected === undefined} onClick={() => { onSelect(undefined); onClose(); }}>
                <Icon name="list" size={18} />
                <span>{allLabel}</span>
              </button>
            </li>
          ) : null}
          {shown.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                className={cx("picker-option", category.id === selected && "picker-option--on")}
                aria-pressed={category.id === selected}
                onClick={() => {
                  onSelect(category.id);
                  onClose();
                }}
              >
                <span className="category-dot" style={{ color: category.color }}>
                  <Icon name={categoryIcon(category.icon)} size={18} />
                </span>
                <span>{category.name}</span>
                {category.id === selected ? <Icon name="checkmark" size={16} weight={48} label="Selected" /> : null}
              </button>
            </li>
          ))}
        </ul>
        {shown.length === 0 ? <p className="note">No category matches “{filter.trim()}”.</p> : null}
        {save && kind ? (
          <form className="inline-create" onSubmit={(event) => void create(event)} noValidate aria-label="Add a category">
            <div className="form-field">
              <label htmlFor={ids.name}>New category</label>
              <input
                id={ids.name}
                ref={nameRef}
                maxLength={50}
                autoComplete="off"
                value={name}
                onChange={(event) => { setName(event.currentTarget.value); }}
                {...(error ? { "aria-invalid": true, "aria-describedby": ids.error } : {})}
              />
              {error ? (
                <span id={ids.error} className="form-error" role="alert">
                  {error}
                </span>
              ) : null}
            </div>
            <Button type="submit" icon="add" busy={busy}>
              {busy ? "Adding…" : "Add category"}
            </Button>
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Inline account creation from the entry form (specimen `account-picker`). Saved through the offline
 * store, then chosen in the form; the draft behind stays as typed.
 */
export function NewAccountDialog({ save, onCreated, onClose }: { save: Save; onCreated: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("bank");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), error: useId(), form: useId() };

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 50) {
      setError("Give your account a name of up to 50 characters.");
      nameRef.current?.focus();
      return;
    }
    const id = uid();
    setBusy(true);
    setError(null);
    try {
      await save(saveAccount({ id, name: trimmed, type }));
      onCreated(id);
      onClose();
    } catch (failure) {
      setError(errorText(failure));
      nameRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="New account"
      description="Only you see your accounts."
      onClose={onClose}
      initialFocus={nameRef}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={ids.form} variant="primary" busy={busy}>
            {busy ? "Adding…" : "Add account"}
          </Button>
        </>
      }
    >
      <form id={ids.form} className="form" onSubmit={(event) => void create(event)} noValidate aria-label="New account">
        <div className="form-field">
          <label htmlFor={ids.name}>Name</label>
          <input
            id={ids.name}
            ref={nameRef}
            maxLength={50}
            autoComplete="off"
            value={name}
            onChange={(event) => { setName(event.currentTarget.value); }}
            {...(error ? { "aria-invalid": true, "aria-describedby": ids.error } : {})}
          />
          {error ? (
            <span id={ids.error} className="form-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
        <ChoiceGroup<AccountType>
          legend="Type"
          name="account-type"
          value={type}
          onChange={setType}
          appearance="list"
          options={accountTypes.map((value) => ({ value, label: accountTypeLabels[value] }))}
        />
      </form>
    </Dialog>
  );
}
