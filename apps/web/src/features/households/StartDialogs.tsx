import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { createHousehold, householdsKey, joinHousehold, normalizeInviteCode } from "../../api/households";
import { useLedgerCurrency } from "../../offline/useLedgerCurrency";
import { invalidateSearch } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { Button, ChoiceGroup } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { SaveErrorBanner, useToast } from "../../design/states";
import { describeSharedError } from "./errors";

type Mode = "create" | "join";

export function CreateHouseholdDialog({ onClose }: { onClose: () => void }) {
  return <StartDialog initial="create" onClose={onClose} />;
}

/** `initialCode`: an emailed invitation's code (MAZ-124), filled in for the person to accept. */
export function JoinHouseholdDialog({ onClose, initialCode }: { onClose: () => void; initialCode?: string }) {
  return <StartDialog initial="join" onClose={onClose} initialCode={initialCode} />;
}

/** Join a shared trip with a code (MAZ-93). The same join as a household; the code decides which. */
export function JoinTripDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Join a trip" onClose={onClose}>
      <JoinForm onClose={onClose} trip />
    </Dialog>
  );
}

/**
 * Create or join (card `iphone-household-create`). The household uses the creator's ledger
 * currency, and joining needs the same currency, as the server enforces. Failures keep what was
 * typed and say why.
 */
function StartDialog({ initial, onClose, initialCode }: { initial: Mode; onClose: () => void; initialCode?: string | undefined }) {
  const [mode, setMode] = useState<Mode>(initial);
  return (
    <Dialog title={mode === "create" ? "New household" : "Join a household"} onClose={onClose}>
      <ChoiceGroup<Mode>
        legend="Create or join"
        hideLegend
        name="start-mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "create", label: "Create" },
          { value: "join", label: "Join" },
        ]}
      />
      {mode === "create" ? <CreateForm onClose={onClose} /> : <JoinForm onClose={onClose} initialCode={initialCode} />}
    </Dialog>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const currency = useLedgerCurrency();
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const errorId = useId();
  const noteId = useId();
  const detailsId = useId();

  const create = useMutation({
    mutationKey: ["households", "create"],
    mutationFn: (input: { name: string; currency: string }) => createHousehold(input.name, input.currency),
    onSuccess: async ({ household }) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: householdsKey(email) }), invalidateSearch(queryClient, email)]);
      toast.show({ title: `${household.name} created`, detail: "Invite people from People." });
      onClose();
      void navigate({ to: "/households/$id", params: { id: household.id }, search: { tab: "people" } });
    },
  });

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) {
      setInvalid(true);
      nameRef.current?.focus();
      return;
    }
    setInvalid(false);
    if (!currency.data || create.isPending) return;
    create.mutate({ name: trimmed, currency: currency.data });
  }

  return (
    <form className="form start-form" onSubmit={onSubmit} noValidate>
      <div className="start-form__intro">
        <span className="start-form__tile" aria-hidden="true">
          <Icon name="home" size={36} />
        </span>
        <p>Share rent, bills and groceries. Everyone sees the full expense; your reports count only your share.</p>
      </div>
      {create.isError ? <SaveErrorBanner message={describeSharedError(create.error).message} /> : null}
      <div className="form-field">
        <label htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          ref={nameRef}
          value={name}
          maxLength={80}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => { setName(event.currentTarget.value); }}
        />
        {invalid ? (
          <span id={errorId} className="form-error">
            Enter a name of up to 80 characters.
          </span>
        ) : null}
      </div>
      <div className="form-field">
        <span className="form-field__label" id={detailsId}>
          Details
        </span>
        <dl className="start-form__details" aria-labelledby={detailsId} aria-describedby={noteId}>
          <div>
            <dt>
              <Icon name="cash" size={20} />
              Currency
            </dt>
            <dd>
              {currency.data ?? (currency.isError ? "Unavailable" : "Loading…")}
              {currency.data ? <Icon name="lock-closed" size={14} label="Can't be changed" /> : null}
            </dd>
          </div>
          <div>
            <dt>
              <Icon name="person-add" size={20} />
              Invite people
            </dt>
            <dd>After creating</dd>
          </div>
        </dl>
      </div>
      <p id={noteId} className="form-hint">
        {currency.data
          ? `Uses your ledger currency. Everyone who joins must use ${currency.data} too.`
          : currency.isError
            ? "Penny couldn't read your ledger currency, so it can't create a household right now."
            : "Reading your ledger currency…"}
      </p>
      {/* The dialog footer of `web-join-code`: a tinted bar with Cancel and the action at the end. */}
      <div className="form-actions start-form__foot">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={create.isPending || !currency.data}>
          {create.isPending ? "Creating…" : "Create household"}
        </Button>
      </div>
    </form>
  );
}

function JoinForm({ onClose, trip = false, initialCode }: { onClose: () => void; trip?: boolean; initialCode?: string | undefined }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState(initialCode ?? "");
  const [invalid, setInvalid] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const codeId = useId();
  const hintId = useId();
  const errorId = useId();

  const join = useMutation({
    mutationKey: ["households", "join"],
    mutationFn: (value: string) => joinHousehold(value),
    onSuccess: async ({ household }) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: householdsKey(email) }), invalidateSearch(queryClient, email)]);
      toast.show({ title: `You joined ${household.name}`, detail: household.trip ? "You're included in trip expenses added from now on." : "You're included in expenses from today." });
      onClose();
      if (household.trip) void navigate({ to: "/trips/$id", params: { id: household.id } });
      else void navigate({ to: "/households/$id", params: { id: household.id } });
    },
    onError: () => {
      codeRef.current?.focus();
    },
  });

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[A-F0-9]{10}$/.test(normalizeInviteCode(code))) {
      setInvalid(true);
      codeRef.current?.focus();
      return;
    }
    setInvalid(false);
    if (!join.isPending) join.mutate(code);
  }

  const failure = join.isError ? describeSharedError(join.error) : null;
  const message = invalid ? "An invite code is 10 letters and numbers, like 7F3A9C01B2." : failure?.kind === "invalid" || failure?.kind === "conflict" || failure?.kind === "rate" ? failure.message : null;

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      {failure && !message ? <SaveErrorBanner message={failure.message} /> : null}
      <div className="form-field">
        <label htmlFor={codeId}>Invite code</label>
        <input
          id={codeId}
          ref={codeRef}
          className="invite-code-input"
          value={code}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${errorId} ${hintId}` : hintId}
          onChange={(event) => { setCode(event.currentTarget.value); }}
        />
        {message ? (
          <span id={errorId} className="form-error" role="alert">
            {message}
          </span>
        ) : null}
        <span id={hintId} className="form-hint">
          {trip
            ? "Ask the trip's creator to open People and choose Invite. Codes work for 10 minutes, and your ledger currency must match the trip's. Expenses added before you join stay with the people already on the trip."
            : "Ask a member to open the household's People section and choose Invite. Codes work for 10 minutes, and your ledger currency must match the household's."}
        </span>
      </div>
      {/* The dialog footer of `web-join-code`: a tinted bar with Cancel and the action at the end. */}
      <div className="form-actions start-form__foot">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={join.isPending}>
          {join.isPending ? "Joining…" : trip ? "Join trip" : "Join household"}
        </Button>
      </div>
    </form>
  );
}
