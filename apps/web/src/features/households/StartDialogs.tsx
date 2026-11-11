import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { createHousehold, householdsKey, joinHousehold, normalizeInviteCode } from "../../api/households";
import { ledgerCurrencyQuery } from "../../api/ledger";
import { invalidateSearch } from "../../api/search";
import { useAccountEmail } from "../../auth/account";
import { Button, ChoiceGroup } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { SaveErrorBanner, useToast } from "../../design/states";
import { describeSharedError } from "./errors";

type Mode = "create" | "join";

export function CreateHouseholdDialog({ onClose }: { onClose: () => void }) {
  return <StartDialog initial="create" onClose={onClose} />;
}

export function JoinHouseholdDialog({ onClose }: { onClose: () => void }) {
  return <StartDialog initial="join" onClose={onClose} />;
}

/**
 * Create or join (card `iphone-household-create`). The household uses the creator's ledger
 * currency, and joining needs the same currency, as the server enforces. Failures keep what was
 * typed and say why.
 */
function StartDialog({ initial, onClose }: { initial: Mode; onClose: () => void }) {
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
      {mode === "create" ? <CreateForm onClose={onClose} /> : <JoinForm onClose={onClose} />}
    </Dialog>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const currency = useQuery(ledgerCurrencyQuery(email));
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const errorId = useId();
  const noteId = useId();

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
    <form className="form" onSubmit={onSubmit} noValidate>
      <p className="note">Share rent, bills and groceries. Everyone sees the full expense; your reports count only your share.</p>
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
      <dl className="detail-grid" aria-describedby={noteId}>
        <dt>Currency</dt>
        <dd>{currency.data ?? (currency.isError ? "Unavailable" : "Loading…")}</dd>
        <dt>Invite people</dt>
        <dd>After creating</dd>
      </dl>
      <p id={noteId} className="note">
        {currency.data
          ? `Uses your ledger currency. Everyone who joins must use ${currency.data} too.`
          : currency.isError
            ? "Penny couldn't read your ledger currency, so it can't create a household right now."
            : "Reading your ledger currency…"}
      </p>
      <div className="form-actions">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={create.isPending || !currency.data}>
          {create.isPending ? "Creating…" : "Create household"}
        </Button>
      </div>
    </form>
  );
}

function JoinForm({ onClose }: { onClose: () => void }) {
  const email = useAccountEmail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState("");
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
      toast.show({ title: `You joined ${household.name}`, detail: "You're included in expenses from today." });
      onClose();
      void navigate({ to: "/households/$id", params: { id: household.id } });
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
          Ask a member to open the household's People section and choose Invite. Codes work for 10 minutes, and your ledger currency must match the household's.
        </span>
      </div>
      <div className="form-actions">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={join.isPending}>
          {join.isPending ? "Joining…" : "Join household"}
        </Button>
      </div>
    </form>
  );
}
