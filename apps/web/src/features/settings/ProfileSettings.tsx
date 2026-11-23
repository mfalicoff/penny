import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type SyntheticEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../../api/client";
import {
  AVATAR_ACCEPT,
  avatarMimeOf,
  DISPLAY_NAME_MAX,
  MAX_AVATAR_BYTES,
  normalizeDisplayName,
  PROFILE_MESSAGES,
  profileQuery,
  rememberProfile,
  removeAvatar,
  updateProfile,
  uploadAvatar,
  type AvatarMime,
} from "../../api/profile";
import type { Profile } from "../../api/schemas";
import { useTopbarSlot } from "../../app/shell/pageTitle";
import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { Avatar, Button, Card, cx } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { ErrorState, LoadingState, useToast } from "../../design/states";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { AccountPrivacyFooter } from "../legal/PrivacyPolicyLink";
import { PictureCropDialog } from "./PictureCropDialog";
import { SectionTitle } from "./SectionTitle";
import { useSettingsLayout } from "./SettingsLayout";

/**
 * Settings › Profile (MAZ-171): the person's picture and name, and how they sign in. Phones and
 * tablets follow `iphone-profile` and `ipad-profile` (`iphone-profile-provider` when the sign-in
 * provider manages a field); desktops follow `web-profile`. A provider-managed field is read only
 * and says which provider manages it; the server refuses a change anyway. The privacy footer
 * (`AccountPrivacyFooter`) closes both layouts. Export, account deletion and email verification
 * belong to other issues and aren't shown yet.
 */
export function ProfileSettings() {
  const email = useAccountEmail();
  const demo = useIsDemo();
  return demo ? <DemoProfile /> : <AccountProfile email={email} />;
}

/** The demo has no account: the pane only says so. */
function DemoProfile() {
  return (
    <>
      <SectionTitle>Profile</SectionTitle>
      <Card title="Account">
        <div className="setting-row">
          <Avatar name="Demo" size={40} />
          <div className="setting-row__body">
            <span className="setting-row__title">Demo</span>
            <span className="setting-row__desc">You're exploring sample data. Nothing here is saved or sent to a server.</span>
          </div>
        </div>
      </Card>
    </>
  );
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.status === 0 ? PROFILE_MESSAGES.offline : error.message || fallback;
  return fallback;
}

/** "Google", or "your sign-in provider" when the server has no name configured for it. */
export const providerName = (profile: Pick<Profile, "provider">) => profile.provider ?? "your sign-in provider";

/** "Oct 3", or "Oct 3, 2025" outside the current year. */
function changedOn(instant: number): string {
  const date = new Date(instant);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function AccountProfile({ email }: { email: string }) {
  const profile = useQuery(profileQuery(email));
  if (profile.isPending) return <LoadingState label="Loading your profile…" />;
  if (profile.isError) {
    return (
      <ErrorState
        title="Penny couldn't load your profile"
        onRetry={() => {
          void profile.refetch();
        }}
        retrying={profile.isFetching}
      >
        {describeError(profile.error, "Nothing was changed. Try again in a moment.")}
      </ErrorState>
    );
  }
  return <ProfileEditor profile={profile.data} />;
}

interface Picked {
  file: File;
  mime: AvatarMime;
}

function ProfileEditor({ profile }: { profile: Profile }) {
  const layout = useSettingsLayout();
  const queryClient = useQueryClient();
  const toast = useToast();
  const ids = { name: useId(), nameNote: useId(), nameError: useId(), pictureError: useId(), signIn: useId() };
  const [name, setName] = useState(profile.displayName ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const shown = profile.displayName ?? profile.email;
  const dirty = profile.nameEditable && name.trim() !== (profile.displayName ?? "");

  const saveName = useMutation({
    mutationKey: ["profile", "name"],
    mutationFn: (displayName: string | null) => updateProfile({ displayName }),
    onSuccess: (next) => {
      rememberProfile(queryClient, next);
      setName(next.displayName ?? "");
      toast.show(next.displayName ? { title: "Name saved", detail: "Your households and trips show it now." } : { title: "Name removed", detail: "Your households and trips show your email." });
    },
    onError: (error) => {
      setNameError(describeError(error, "Your name wasn't saved. Try again."));
    },
  });

  const savePicture = useMutation({
    mutationKey: ["profile", "picture"],
    mutationFn: ({ blob, mime }: { blob: Blob; mime: AvatarMime }) => uploadAvatar(blob, mime),
    onSuccess: (next) => {
      rememberProfile(queryClient, next);
      setPictureError(null);
      toast.show({ title: "Picture saved", detail: "Your households and trips show it now." });
    },
    onError: (error) => {
      setPictureError(describeError(error, PROFILE_MESSAGES.pictureFailed));
    },
  });

  const deletePicture = useMutation({
    mutationKey: ["profile", "picture", "remove"],
    mutationFn: () => removeAvatar(),
    onSuccess: (next) => {
      rememberProfile(queryClient, next);
      setPictureError(null);
      toast.show({ title: "Picture removed", detail: "Your households and trips show your initials." });
    },
    onError: (error) => {
      setPictureError(describeError(error, "The picture wasn't removed. Try again."));
    },
  });

  function submitName(event?: SyntheticEvent) {
    event?.preventDefault();
    if (!profile.nameEditable || saveName.isPending || !dirty) return;
    if (!name.trim()) {
      // An empty field clears the name, so the email shows again.
      saveName.mutate(null);
      return;
    }
    const normalized = normalizeDisplayName(name);
    if (!normalized) {
      setNameError(PROFILE_MESSAGES.name);
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    saveName.mutate(normalized);
  }

  function choose(files: FileList | null) {
    const file = files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const mime = avatarMimeOf(file);
    if (!mime || file.size === 0 || file.size > MAX_AVATAR_BYTES) {
      setPictureError(PROFILE_MESSAGES.pictureType);
      return;
    }
    setPictureError(null);
    setPicked({ file, mime });
  }

  const openPicker = () => {
    fileRef.current?.click();
  };
  const remove = () => {
    deletePicture.mutate();
  };
  const busy = savePicture.isPending || deletePicture.isPending;

  const extras = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="profile-picture-input"
        onChange={(event) => {
          choose(event.currentTarget.files);
        }}
      />
      {changingPassword ? (
        <ChangePasswordDialog
          email={profile.email}
          onClose={() => {
            setChangingPassword(false);
          }}
        />
      ) : null}
      {picked ? (
        <PictureCropDialog
          file={picked.file}
          mime={picked.mime}
          onCancel={() => {
            setPicked(null);
          }}
          onChoose={(blob, mime) => {
            setPicked(null);
            savePicture.mutate({ blob, mime });
          }}
        />
      ) : null}
    </>
  );
  const pictureStatus = pictureError ? (
    <p className="field__error" id={ids.pictureError} role="alert">
      {pictureError}
    </p>
  ) : null;
  const nameField = (
    <NameField
      ids={ids}
      inputRef={nameRef}
      profile={profile}
      value={name}
      error={nameError}
      onChange={(value) => {
        setName(value);
        if (nameError) setNameError(null);
      }}
    />
  );

  if (layout === "desktop") {
    // Card `web-profile`: panels, with Save under the name.
    return (
      <div className="profile profile--panels">
        <SectionTitle>Profile</SectionTitle>
        <Card title="Picture and name">
          <div className="profile__me">
            <Avatar name={shown} src={profile.avatarUrl} size={80} />
            <div className="profile__me-body">
              <b className="profile__me-name">{shown}</b>
              <span className="profile__me-hint">
                {profile.avatarEditable ? "PNG, JPEG or HEIC up to 10 MB. Penny removes its location before saving." : `${capitalized(providerName(profile))} manages your picture. Penny updates it each time you sign in.`}
              </span>
              {profile.avatarEditable ? (
                <span className="profile__actions">
                  <Button icon="image" onClick={openPicker} busy={savePicture.isPending} aria-describedby={pictureError ? ids.pictureError : undefined}>
                    {profile.avatarUrl ? "Change picture" : "Add picture"}
                  </Button>
                  {profile.avatarUrl ? (
                    <Button className="profile__remove" onClick={remove} busy={deletePicture.isPending} disabled={busy}>
                      Remove
                    </Button>
                  ) : null}
                </span>
              ) : null}
              {pictureStatus}
            </div>
          </div>
          <form onSubmit={submitName} noValidate className="profile__name-form">
            {nameField}
            {profile.nameEditable ? (
              <span className="profile__save">
                <Button type="submit" variant="primary" busy={saveName.isPending}>
                  Save
                </Button>
              </span>
            ) : null}
          </form>
        </Card>
        <Card title="Sign-in">
          <SignInRow profile={profile} />
          {profile.signIn === "password" ? (
            <div className="profile__row profile__row--password">
              <span className="profile__row-icon" aria-hidden="true">
                <Icon name="key" size={18} />
              </span>
              <span className="profile__row-body">
                <span className="profile__row-title">Password</span>
                {profile.passwordChangedAt ? <span className="profile__row-detail">Changed {changedOn(profile.passwordChangedAt)}</span> : null}
              </span>
              <Button
                onClick={() => {
                  setChangingPassword(true);
                }}
              >
                Change password
              </Button>
            </div>
          ) : null}
          {profile.signIn === "oidc" ? <p className="profile__note">You sign in to Penny with {providerName(profile)}. Your account has no password.</p> : null}
        </Card>
        <AccountPrivacyFooter demo={false} />
        {extras}
      </div>
    );
  }

  // Cards `iphone-profile`, `iphone-profile-provider` and `ipad-profile`: a grouped page.
  const managed = !profile.nameEditable || !profile.avatarEditable;
  const managedLine = !profile.nameEditable && !profile.avatarEditable ? "Name and picture" : !profile.nameEditable ? "Name" : "Picture";
  return (
    <div className={cx("profile", `profile--${layout}`, managed && "profile--managed")}>
      {layout === "phone" ? <SaveCheck disabled={!dirty || saveName.isPending} onSave={submitName} /> : <SectionTitle>Profile</SectionTitle>}
      <div className="profile__hero">
        <span className="profile__picture">
          <Avatar name={shown} src={profile.avatarUrl} size={layout === "phone" ? 96 : 76} />
          {profile.avatarEditable ? (
            <button type="button" className="profile__badge" onClick={openPicker} disabled={busy} aria-label={profile.avatarUrl ? "Change picture" : "Add picture"}>
              <Icon name="image" size={15} />
            </button>
          ) : null}
        </span>
        <span className="profile__hero-body">
          {layout === "tablet" || managed ? <b className="profile__hero-name">{shown}</b> : null}
          {managed ? (
            <span className="profile__managed">
              <Icon name="key" size={15} />
              {managedLine} from {providerName(profile)}
            </span>
          ) : null}
          {profile.avatarEditable ? (
            <span className="profile__links">
              <button type="button" className="profile__link" onClick={openPicker} disabled={busy} aria-describedby={pictureError ? ids.pictureError : undefined}>
                {savePicture.isPending ? "Saving picture…" : profile.avatarUrl ? "Change picture" : "Add picture"}
              </button>
              {profile.avatarUrl ? (
                <button type="button" className="profile__link profile__link--danger" onClick={remove} disabled={busy}>
                  {deletePicture.isPending ? "Removing…" : "Remove"}
                </button>
              ) : null}
            </span>
          ) : null}
          {pictureStatus}
        </span>
      </div>
      <form onSubmit={submitName} noValidate className="profile__group">
        {nameField}
        {layout === "tablet" && dirty ? (
          <span className="profile__save">
            <Button type="submit" variant="primary" busy={saveName.isPending}>
              Save name
            </Button>
          </span>
        ) : null}
      </form>
      <section className="profile__group" aria-labelledby={ids.signIn}>
        <h2 id={ids.signIn} className="group-label">
          Sign-in
        </h2>
        <div className="profile__list">
          <SignInRow profile={profile} />
          {profile.signIn === "password" ? (
            <button
              type="button"
              className="profile__row profile__row--link"
              onClick={() => {
                setChangingPassword(true);
              }}
            >
              <span className="profile__row-icon" aria-hidden="true">
                <Icon name="key" size={18} />
              </span>
              <span className="profile__row-body">
                <span className="profile__row-title">Change password</span>
                {profile.passwordChangedAt ? <span className="profile__row-detail">Changed {changedOn(profile.passwordChangedAt)}</span> : null}
              </span>
              <Icon name="chevron-forward" size={16} />
            </button>
          ) : null}
        </div>
        {profile.signIn === "oidc" ? <p className="group-note">You sign in to Penny with {providerName(profile)}. Your account has no password.</p> : null}
      </section>
      <AccountPrivacyFooter demo={false} />
      {extras}
    </div>
  );
}

function NameField({
  ids,
  inputRef,
  profile,
  value,
  error,
  onChange,
}: {
  ids: { name: string; nameNote: string; nameError: string };
  inputRef: RefObject<HTMLInputElement | null>;
  profile: Profile;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const both = !profile.avatarEditable;
  const where = profile.provider ? `your ${profile.provider} account` : "your provider account";
  const note = profile.nameEditable
    ? "People in your households and trips see your name and picture instead of your email."
    : `${capitalized(providerName(profile))} manages your name${both ? " and picture" : ""}. Penny updates ${both ? "them" : "it"} each time you sign in; change ${both ? "them" : "it"} in ${where}.`;
  return (
    <div className="profile__field">
      <label htmlFor={ids.name} className="group-label">
        Name
      </label>
      <span className={cx("profile__input", !profile.nameEditable && "profile__input--locked")}>
        <input
          ref={inputRef}
          id={ids.name}
          name="displayName"
          value={profile.nameEditable ? value : (profile.displayName ?? "")}
          readOnly={!profile.nameEditable}
          maxLength={DISPLAY_NAME_MAX + 20}
          autoComplete="name"
          placeholder={profile.nameEditable ? "Your name" : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={cx(ids.nameNote, error && ids.nameError) || undefined}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        />
        {profile.nameEditable ? null : <Icon name="lock-closed" size={17} label="Read only" />}
      </span>
      {error ? (
        <p className="field__error" id={ids.nameError} role="alert">
          {error}
        </p>
      ) : null}
      <p className="group-note" id={ids.nameNote}>
        {note}
      </p>
    </div>
  );
}

/** How the account signs in: its email and password, or its provider (cards' Sign-in row). */
function SignInRow({ profile }: { profile: Profile }) {
  const oidc = profile.signIn === "oidc";
  return (
    <div className="profile__row">
      <span className="profile__row-icon" aria-hidden="true">
        {oidc ? (
          <Icon name="key" size={18} />
        ) : (
          <svg viewBox="0 0 512 512" width="18" height="18" focusable="false">
            <rect x="48" y="96" width="416" height="320" rx="40" ry="40" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32" />
            <polyline points="112 160 256 272 400 160" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32" />
          </svg>
        )}
      </span>
      <span className="profile__row-body">
        <span className="profile__row-title">{oidc ? (profile.provider ?? "Single sign-on") : profile.email}</span>
        <span className="profile__row-detail">{oidc ? profile.email : "Email and password"}</span>
      </span>
    </div>
  );
}

/** The phone sheet's copper check (card `iphone-profile`): saves the name. */
function SaveCheck({ disabled, onSave }: { disabled: boolean; onSave: () => void }) {
  const slot = useTopbarSlot();
  if (!slot) return null;
  return createPortal(
    <button
      type="button"
      className="glass glass-button settings__done"
      aria-label="Save name"
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onSave();
      }}
    >
      <Icon name="checkmark" size={20} weight={48} />
    </button>,
    slot,
  );
}
