import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { ApiError } from "../../api/client";
import { DISPLAY_NAME_MAX, normalizeDisplayName, PROFILE_MESSAGES, rememberProfile, updateProfile } from "../../api/profile";
import { useAccountMe } from "../../auth/account";
import { Avatar } from "../../design/controls";
import { ModalDialog } from "../../design/ModalDialog";

/**
 * "What should people call you?" (card `iphone-name-prompt`, MAZ-171): asked once of an account with
 * no name that may set one, such as one created before names existed. Not now (or Escape) skips it
 * for good, and the email keeps showing; the name can still be set in Settings › Profile.
 */
export function NamePrompt() {
  const me = useAccountMe();
  const [closed, setClosed] = useState(false);
  if (!me.needsName || closed) return null;
  return (
    <NamePromptDialog
      email={me.email}
      onDone={() => {
        setClosed(true);
      }}
    />
  );
}

function NamePromptDialog({ email, onDone }: { email: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const ids = { title: useId(), description: useId(), name: useId(), hint: useId(), error: useId() };
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationKey: ["profile", "name-prompt"],
    mutationFn: (update: { displayName: string } | { namePromptDismissed: true }) => updateProfile(update),
    onSuccess: (profile) => {
      rememberProfile(queryClient, profile);
      onDone();
    },
    onError: (failure, update) => {
      // Skipping is best effort: the prompt closes, and comes back next time if the server missed it.
      if ("namePromptDismissed" in update) {
        onDone();
        return;
      }
      setError(failure instanceof ApiError && failure.status !== 0 ? failure.message : PROFILE_MESSAGES.offline);
    },
  });

  const skip = () => {
    if (!save.isPending) save.mutate({ namePromptDismissed: true });
  };

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const normalized = normalizeDisplayName(name);
    if (!normalized) {
      setError(PROFILE_MESSAGES.name);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    save.mutate({ displayName: normalized });
  }

  return (
    <ModalDialog labelledBy={ids.title} describedBy={ids.description} onClose={skip} initialFocus={inputRef} panelClassName="name-prompt">
      <form onSubmit={submit} noValidate>
        <div className="name-prompt__head">
          <Avatar name={name.trim() || email} size={56} />
          <div>
            <h2 id={ids.title}>What should people call you?</h2>
            <span className="name-prompt__email">{email}</span>
          </div>
        </div>
        <p id={ids.description} className="name-prompt__text">
          Your households and trips show this name instead of your email. You can add a picture later in Settings › Profile.
        </p>
        <div className="name-prompt__field">
          <label htmlFor={ids.name}>Name</label>
          <input
            ref={inputRef}
            id={ids.name}
            name="displayName"
            value={name}
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX + 20}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids.error} ${ids.hint}` : ids.hint}
            onChange={(event) => {
              setName(event.currentTarget.value);
              if (error) setError(null);
            }}
          />
        </div>
        {error ? (
          <p className="field__error" id={ids.error} role="alert">
            {error}
          </p>
        ) : null}
        <p className="name-prompt__hint" id={ids.hint}>
          Up to 60 characters.
        </p>
        <button type="submit" className="name-prompt__save" aria-disabled={save.isPending || undefined}>
          {save.isPending ? "Saving…" : "Save name"}
        </button>
        <button type="button" className="name-prompt__skip" onClick={skip}>
          Not now
        </button>
      </form>
    </ModalDialog>
  );
}
