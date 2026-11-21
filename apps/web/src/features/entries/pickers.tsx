import { saveAccount, saveCategory, type LedgerChange } from "@domain/commands.ts";
import { accountTypeLabels, accountTypes, kindLabels, palette, uid, type AccountType, type Category, type Kind } from "@domain/ledger.ts";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { Button, ChoiceGroup, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { tileStyle } from "../../design/categoryTint";
import { Dialog } from "../../design/ModalDialog";
import type { SaveReceipt } from "../../offline/engine";
import { RECORD_LIMIT } from "../organize/model";
import { categoryIcon } from "./model";

type Save = (change: LedgerChange) => Promise<SaveReceipt>;

const errorText = (error: unknown) => (error instanceof Error ? error.message : "That couldn't be saved. Try again.");

/**
 * "All categories" (`iphone-category-picker`, MAZ-175): a search field, then Most used and every
 * other category as a grid of icon tiles. Tiles are buttons, so arrow keys never change the choice
 * by accident; the chosen one is pressed, ringed and bold. With `save`, the New tile opens a name
 * field: the category is saved through the offline store and chosen at once, and the form behind
 * keeps its draft. Escape or Close returns focus to the button that opened the picker.
 */
export function CategoryPickerDialog({
  title,
  kind,
  categories,
  mostUsed = [],
  selected,
  onSelect,
  onClose,
  save,
  allLabel,
  onEditCategories,
}: {
  /** Defaults to "Expense category" (or the kind's), as on the card. */
  title?: string;
  kind?: Kind;
  categories: Category[];
  /** Shown first, under Most used, while nothing is typed (`mostUsedCategories`). */
  mostUsed?: Category[];
  selected: string | undefined;
  /** The chosen category's id, with the category itself (also one just created, before the ledger shows it). */
  onSelect: (id: string | undefined, category?: Category) => void;
  onClose: () => void;
  save?: Save | null;
  /** Offer a "no filter" choice with this label (Activity's "All categories"). */
  allLabel?: string;
  /** The card's "Edit categories" link at the end: opens Manage › Categories. */
  onEditCategories?: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { filter: useId(), name: useId(), error: useId(), most: useId(), all: useId() };
  const needle = filter.trim().toLowerCase();
  const canCreate = Boolean(save && kind);
  const heading = title ?? (kind ? `${kindLabels[kind]} category` : "Choose a category");
  const top = needle ? [] : mostUsed.filter((category) => categories.some((item) => item.id === category.id));
  const rest = categories.filter((category) => (needle ? category.name.toLowerCase().includes(needle) : !top.includes(category)));

  function choose(category: Category) {
    onSelect(category.id, category);
    onClose();
  }

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
      choose(category);
    } catch (failure) {
      setError(errorText(failure));
      nameRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const tile = (category: Category) => (
    <li key={category.id}>
      <button type="button" className={cx("category-tile", category.id === selected && "category-tile--on")} aria-pressed={category.id === selected} onClick={() => { choose(category); }}>
        <span className="category-tile__icon" style={tileStyle(category)}>
          <Icon name={categoryIcon(category.icon)} size={24} />
        </span>
        <span className="category-tile__name">{category.name}</span>
      </button>
    </li>
  );

  return (
    <Dialog title={heading} onClose={onClose} initialFocus={filterRef}>
      <div className="form category-picker">
        <div className="form-field">
          <label htmlFor={ids.filter} className="visually-hidden">
            Search categories
          </label>
          <div className="category-picker__search">
            <Icon name="search" size={18} />
            <input id={ids.filter} ref={filterRef} type="search" placeholder="Search categories" autoComplete="off" value={filter} onChange={(event) => { setFilter(event.currentTarget.value); }} />
          </div>
        </div>
        {allLabel ? (
          <button type="button" className={cx("picker-option", selected === undefined && "picker-option--on")} aria-pressed={selected === undefined} onClick={() => { onSelect(undefined); onClose(); }}>
            <Icon name="list" size={18} />
            <span>{allLabel}</span>
            {selected === undefined ? <Icon name="checkmark" size={16} weight={48} label="Selected" /> : null}
          </button>
        ) : null}
        {top.length ? (
          <section className="category-picker__section" aria-labelledby={ids.most}>
            <h3 id={ids.most} className="category-picker__heading">
              Most used
            </h3>
            <ul className="category-grid">{top.map(tile)}</ul>
          </section>
        ) : null}
        {rest.length || (canCreate && !needle) ? (
          <section className="category-picker__section" aria-labelledby={ids.all}>
            <h3 id={ids.all} className="category-picker__heading">
              {needle ? "Matches" : top.length ? "All categories" : kind ? `${kindLabels[kind]} categories` : "Categories"}
            </h3>
            <ul className="category-grid">
              {rest.map(tile)}
              {canCreate && !needle ? (
                <li>
                  <button
                    type="button"
                    className="category-tile category-tile--new"
                    aria-label="New category"
                    aria-expanded={creating}
                    aria-controls={ids.name}
                    onClick={() => {
                      setCreating(true);
                      setTimeout(() => nameRef.current?.focus(), 0);
                    }}
                  >
                    <span className="category-tile__icon">
                      <Icon name="add" size={24} />
                    </span>
                    <span className="category-tile__name">New</span>
                  </button>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
        {needle && rest.length === 0 ? <p className="note">No category matches “{filter.trim()}”.</p> : null}
        {canCreate && (creating || needle) ? (
          <form className="inline-create" onSubmit={(event) => void create(event)} noValidate aria-label="Add a category">
            <div className="form-field">
              <label htmlFor={ids.name}>New category name</label>
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
        {onEditCategories ? (
          <button type="button" className="link-button category-picker__edit" onClick={onEditCategories}>
            Edit categories
          </button>
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
