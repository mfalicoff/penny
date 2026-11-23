import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type SyntheticEvent } from "react";
import { ApiError } from "../../api/client";
import { userKey } from "../../api/keys";
import { changePassword, PROFILE_MESSAGES } from "../../api/profile";
import { Button } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";
import { useToast } from "../../design/states";

const MIN = 10;
const MAX = 256;
const WRONG = "Your current password is incorrect.";

/**
 * Change password (MAZ-171), opened from the Sign-in group of Settings › Profile. The current
 * password and a new one of 10 to 256 characters, as at sign-up. Other devices are signed out;
 * this browser stays signed in.
 */
export function ChangePasswordDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const ids = { current: useId(), next: useId(), currentError: useId(), nextError: useId(), requirement: useId(), form: useId() };
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<{ current?: string; next?: string; form?: string }>({});

  const save = useMutation({
    mutationKey: ["profile", "password"],
    mutationFn: (change: { currentPassword: string; newPassword: string }) => changePassword(change),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKey(email, "profile") });
      toast.show({ title: "Password changed", detail: "You're still signed in here. Other devices need the new password." });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.message === WRONG) {
        setErrors({ current: WRONG });
        if (currentRef.current) currentRef.current.value = "";
        currentRef.current?.focus();
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        setErrors({ next: error.message });
        nextRef.current?.focus();
        return;
      }
      setErrors({ form: error instanceof ApiError && error.status !== 0 ? error.message : PROFILE_MESSAGES.offline });
    },
  });

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const data = new FormData(event.currentTarget);
    const currentPassword = typeof data.get("currentPassword") === "string" ? (data.get("currentPassword") as string) : "";
    const newPassword = typeof data.get("newPassword") === "string" ? (data.get("newPassword") as string) : "";
    const found: typeof errors = {};
    if (!currentPassword) found.current = "Enter your current password.";
    if (newPassword.length < MIN || newPassword.length > MAX) found.next = "Use a new password of 10 to 256 characters.";
    setErrors(found);
    if (found.current) {
      currentRef.current?.focus();
      return;
    }
    if (found.next) {
      nextRef.current?.focus();
      return;
    }
    save.mutate({ currentPassword, newPassword });
  }

  return (
    <Dialog
      title="Change password"
      description="Other devices are signed out and need the new password. This browser stays signed in."
      onClose={onClose}
      initialFocus={currentRef}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" form={ids.form} busy={save.isPending}>
            Change password
          </Button>
        </>
      }
    >
      <form id={ids.form} className="password-form" onSubmit={submit} noValidate aria-busy={save.isPending}>
        {errors.form ? (
          <p className="form-error" role="alert">
            {errors.form}
          </p>
        ) : null}
        {/* Lets password managers file the change under the right account. */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        <div className="password-form__field">
          <label htmlFor={ids.current}>Current password</label>
          <input
            ref={currentRef}
            id={ids.current}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            maxLength={MAX}
            aria-invalid={errors.current ? true : undefined}
            aria-describedby={errors.current ? ids.currentError : undefined}
          />
          {errors.current ? (
            <span className="field__error" id={ids.currentError} role="alert">
              {errors.current}
            </span>
          ) : null}
        </div>
        <div className="password-form__field">
          <label htmlFor={ids.next}>New password</label>
          <input
            ref={nextRef}
            id={ids.next}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            maxLength={MAX}
            aria-invalid={errors.next ? true : undefined}
            aria-describedby={errors.next ? `${ids.nextError} ${ids.requirement}` : ids.requirement}
          />
          {errors.next ? (
            <span className="field__error" id={ids.nextError} role="alert">
              {errors.next}
            </span>
          ) : null}
          <span className="password-form__hint" id={ids.requirement}>
            At least 10 characters
          </span>
        </div>
      </form>
    </Dialog>
  );
}
