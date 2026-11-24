import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { ACCOUNT_MESSAGES, deleteAccount } from "../../api/account";
import { ApiError } from "../../api/client";
import { householdsQuery } from "../../api/households";
import type { Profile } from "../../api/schemas";
import { accountDeleted } from "../../auth/lifecycle";
import { beginSignOut } from "../../auth/pendingChanges";
import { Button } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";
import { Dialog } from "../../design/ModalDialog";
import { PrivacyPolicyLink } from "../legal/PrivacyPolicyLink";

const DELETED: { icon: IconName; text: string }[] = [
  { icon: "list", text: "Your entries, accounts, categories and schedules" },
  { icon: "receipt", text: "Receipts and your receipt email address" },
  { icon: "people", text: "Your name, picture and email" },
  { icon: "log-out", text: "Sign-ins on every device" },
];

/** "Apartment", "Apartment and Lisbon", "Apartment, Lisbon and Cottage". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/**
 * Delete account (MAZ-152, card `web-delete-account`): what goes, what stays for the other members
 * of the person's households and trips, and the password to confirm. An account that signs in with
 * a provider has no password, so its session confirms. The server refuses while a household rule
 * blocks leaving (a balance to settle, a creator with other members); the dialog shows that reason
 * and nothing is deleted. Afterwards this browser's copy is removed and the app returns to sign-in.
 */
export function DeleteAccountDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const queryClient = useQueryClient();
  const households = useQuery(householdsQuery(profile.email));
  const ids = { form: useId(), password: useId(), error: useId() };
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const needsPassword = profile.signIn === "password";
  // Households first, then trips, as the card lists them.
  const names = [...(households.data ?? [])].sort((a, b) => Number(Boolean(a.trip)) - Number(Boolean(b.trip))).map((household) => household.name);

  const remove = useMutation({
    mutationKey: ["account", "delete"],
    mutationFn: async (password: string | undefined) => {
      // Saves in this tab stop while the account goes; this browser's copy is removed after.
      const hold = await beginSignOut(profile.email);
      try {
        await deleteAccount(password);
      } catch (failure) {
        hold.cancel();
        throw failure;
      }
      await hold.finish(Number.POSITIVE_INFINITY).catch(() => undefined);
    },
    onSuccess: () => accountDeleted(queryClient),
    onError: (failure) => {
      if (failure instanceof ApiError && failure.status === 400) {
        setError(failure.message || ACCOUNT_MESSAGES.wrongPassword);
        if (passwordRef.current) passwordRef.current.value = "";
        passwordRef.current?.focus();
        return;
      }
      setError(failure instanceof ApiError && failure.status !== 0 ? failure.message : ACCOUNT_MESSAGES.offline);
    },
  });

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (remove.isPending) return;
    const value = new FormData(event.currentTarget).get("password");
    const password = typeof value === "string" ? value : "";
    if (needsPassword && !password) {
      setError(ACCOUNT_MESSAGES.enterPassword);
      passwordRef.current?.focus();
      return;
    }
    setError(null);
    remove.mutate(needsPassword ? password : undefined);
  }

  return (
    <Dialog
      title="Delete your account?"
      onClose={onClose}
      className="delete-account"
      {...(needsPassword ? { initialFocus: passwordRef } : {})}
      icon={
        <span className="delete-account__icon" aria-hidden="true">
          <Icon name="trash" size={18} />
        </span>
      }
      hint={
        <span className="delete-account__note">
          Backups keep deleted data for up to 30 days. <PrivacyPolicyLink className="privacy-link--tint" />
        </span>
      }
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" form={ids.form} busy={remove.isPending}>
            Delete account
          </Button>
        </>
      }
    >
      <form id={ids.form} className="delete-account__form" onSubmit={submit} noValidate aria-busy={remove.isPending}>
        <p className="delete-account__lead">
          This can't be undone.{" "}
          <Link to="/settings/export" onClick={onClose}>
            Export your data
          </Link>{" "}
          first if you want a copy.
        </p>
        <div className="delete-account__cols">
          <section className="delete-account__box" aria-labelledby={`${ids.form}-deleted`}>
            <h3 id={`${ids.form}-deleted`}>Deleted</h3>
            <ul>
              {DELETED.map((item) => (
                <li key={item.icon}>
                  <Icon name={item.icon} size={14} />
                  {item.text}
                </li>
              ))}
            </ul>
          </section>
          {names.length ? (
            <section className="delete-account__box" aria-labelledby={`${ids.form}-stays`}>
              <h3 id={`${ids.form}-stays`}>Stays for others</h3>
              <ul>
                <li>
                  <Icon name="home" size={14} />
                  {`Shared expenses in ${joinNames(names)}. Members keep them and see you as “Former member”.`}
                </li>
              </ul>
            </section>
          ) : null}
        </div>
        {/* Lets password managers fill the right account. */}
        <input type="text" name="username" autoComplete="username" value={profile.email} readOnly hidden />
        {needsPassword ? (
          <div className="password-form__field delete-account__password">
            <label htmlFor={ids.password}>Enter your password to confirm</label>
            <input
              ref={passwordRef}
              id={ids.password}
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={256}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ids.error : undefined}
            />
          </div>
        ) : null}
        {error ? (
          <p className="field__error" id={ids.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
