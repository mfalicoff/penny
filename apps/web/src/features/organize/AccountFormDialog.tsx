import { useId, useRef, useState, type SyntheticEvent } from "react";
import { saveAccount } from "@domain/commands.ts";
import { accountTypes, uid, type AccountType, type Ledger, type PaymentAccount } from "@domain/ledger.ts";
import { Button, ChoiceGroup } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { SaveErrorBanner, useToast } from "../../design/states";
import { ACCOUNT_TYPE_ICONS, accountNameProblem, accountTypeLabels, accountUsage, inUse, moveAccountAndRemove, NAME_MAX, RECORD_LIMIT, restoreAccount, usageOf, usageSentence, type Moved } from "./model";
import { describeSaveError, detailOf, savedDetail, type LedgerWorkspace } from "./workspace";

interface AccountFormDialogProps {
  /** The account to edit; omit to add one. */
  account?: PaymentAccount;
  workspace: Pick<LedgerWorkspace, "save"> & { ledger: Ledger };
  onClose: () => void;
  /**
   * Called with the saved account before the dialog closes. An entry form that opened this
   * inline uses it to select the new account and carry on with its own draft.
   */
  onSaved?: (account: PaymentAccount) => void;
}

/**
 * Add or edit a payment account (cards `iphone-account-form`, `account-edit`). Accounts are labels
 * for how money moves; Penny never connects to a bank or tracks balances. An account that entries
 * or schedules use can be renamed but not removed until they move to another account, which this
 * dialog can do in one step. Every failure keeps the draft and says what to do next.
 */
export function AccountFormDialog({ account, workspace, onClose, onSaved }: AccountFormDialogProps) {
  const { ledger, save } = workspace;
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "bank");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; retry: () => void } | null>(null);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { form: useId(), name: useId(), nameHint: useId(), nameError: useId(), remove: useId(), moveTo: useId(), typeNote: useId() };

  const usage = account ? usageOf(accountUsage(ledger), account.id) : null;
  const used = usage ? inUse(usage) : false;
  const others = account ? ledger.accounts.filter((item) => item.id !== account.id) : [];
  const atLimit = !account && ledger.accounts.length >= RECORD_LIMIT;

  async function run(kind: "save" | "remove", action: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setSaveError(null);
    try {
      await action();
    } catch (error) {
      setSaveError({ message: describeSaveError(error), retry: () => void run(kind, action) });
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    // This form can open over another form (inline creation); its submit must not reach that one.
    event.stopPropagation();
    const problem = accountNameProblem(ledger, name, account?.id);
    setNameError(problem);
    if (problem) {
      nameRef.current?.focus();
      return;
    }
    const item: PaymentAccount = { id: account?.id ?? uid(), name: name.trim(), type };
    void run("save", async () => {
      const receipt = await save(saveAccount(item, account));
      toast.show({ title: account ? "Account saved" : `${item.name} added`, ...detailOf(receipt) });
      onSaved?.(item);
      onClose();
    });
  }

  function remove() {
    if (!account) return;
    const target = others.find((item) => item.id === moveTo);
    if (used && !target) return;
    void run("remove", async () => {
      let moved: Moved = { entryIds: [], scheduleIds: [] };
      const change = target
        ? moveAccountAndRemove(account, target, (value) => {
            moved = value;
          })
        : saveAccount(account, account, true);
      const receipt = await save(change);
      toast.show({
        title: target ? `${account.name} removed` : "Account removed",
        detail: savedDetail(receipt) ?? (target ? `Its ${usage ? usageSentence(usage) : "links"} now use ${target.name}.` : account.name),
        onUndo: () => {
          void save(restoreAccount(account, moved, target?.id)).catch((error: unknown) => {
            toast.show({ title: "Couldn't undo", detail: describeSaveError(error), tone: "error" });
          });
        },
      });
      onClose();
    });
  }

  const title = account ? "Edit account" : "New account";
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
            {busy === "save" ? "Saving…" : account ? "Save" : "Add account"}
          </Button>
        </>
      }
    >
      <form id={ids.form} className="form" onSubmit={onSubmit} noValidate aria-label={title}>
        {saveError ? <SaveErrorBanner message={saveError.message} onRetry={saveError.retry} retrying={busy !== null} /> : null}
        {atLimit ? (
          <p className="form-error" role="alert">
            You have {String(RECORD_LIMIT)} accounts, the most Penny keeps. Remove one you don't use to add another.
          </p>
        ) : null}
        <div className="form-field">
          <label htmlFor={ids.name}>Name</label>
          <input
            id={ids.name}
            ref={nameRef}
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            placeholder="Main chequing, Visa, wallet"
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
        <ChoiceGroup<AccountType>
          legend="Type"
          name={`${ids.form}-type`}
          appearance="cards"
          value={type}
          describedBy={ids.typeNote}
          onChange={setType}
          options={accountTypes.map((value) => ({
            value,
            label: accountTypeLabels[value],
            preview: (
              <span className="organize-type-icon">
                <Icon name={ACCOUNT_TYPE_ICONS[value]} size={22} />
              </span>
            ),
          }))}
        />
        <p id={ids.typeNote} className="form-hint">
          Labels where money comes from or how you pay. No bank connection is needed, and Penny doesn't track balances.
        </p>
      </form>

      {account ? (
        <section className="organize-remove" aria-labelledby={ids.remove}>
          <h3 id={ids.remove}>Remove account</h3>
          {used && usage ? (
            <>
              <p className="form-hint">
                {account.name} is used by {usageSentence(usage)}. Move them to another account to remove it. Renaming keeps every link.
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
                      <option value="">Choose an account</option>
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
                  <Icon name="lock-closed" size={14} /> Add another account first, then move them there.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="form-hint">Nothing uses {account.name}. A shared expense you paid with it keeps it on the server until that link is removed.</p>
              <div>
                <Button variant="danger-quiet" icon="trash" onClick={remove} busy={busy === "remove"} disabled={busy !== null && busy !== "remove"}>
                  {busy === "remove" ? "Removing…" : "Remove account"}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </Dialog>
  );
}
