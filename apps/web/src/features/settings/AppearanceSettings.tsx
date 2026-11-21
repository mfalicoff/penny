import { useId } from "react";
import { setPreferences, usePreferences, type Theme, type WeekStart } from "../../app/preferences";
import { cx, SwitchRow } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { SectionTitle } from "./SectionTitle";
import { ServerSyncSection } from "./ServerSettings";
import { useSettingsLayout } from "./SettingsLayout";
import { SettingsSection } from "./SettingsSection";

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * Settings › Appearance. Light, Dark and System (MAZ-132); System follows the device. Display holds
 * Show cents on Home, Reduce transparency and Week starts on (MAZ-140). Saved per browser, applied
 * at once, and kept after sign-out.
 *
 * - Phones and touch tablets (cards `iphone-appearance`, `ipad-settings`): three phone previews
 *   side by side with a radio under each, and a footnote on what System follows.
 * - Desktop (card `web-settings`): wide theme tiles in a panel, Display, then Server & sync.
 */
export function AppearanceSettings() {
  const { theme, reduceTransparency, showCents, weekStartsOn } = usePreferences();
  const layout = useSettingsLayout();
  const desktop = layout === "desktop";
  const weekId = useId();
  return (
    <>
      <SectionTitle>Appearance</SectionTitle>
      <SettingsSection
        title="Theme"
        footer={
          desktop
            ? undefined
            : layout === "tablet"
              ? "System follows your device's Light and Dark setting. Dark mode uses true black."
              : "System follows your device's Light and Dark setting, including scheduled switching. Dark mode uses true black."
        }
      >
        <fieldset className={cx("themes", desktop ? "themes--tiles" : "themes--phones")}>
          <legend className="visually-hidden">Theme</legend>
          {THEMES.map((option) => (
            <label key={option.value} className={cx("theme", option.value === theme && "theme--on")}>
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={option.value === theme}
                onChange={() => {
                  setPreferences({ theme: option.value });
                }}
              />
              <ThemePreview theme={option.value} />
              <span className="theme__label">{option.label}</span>
              <span className="theme__radio" aria-hidden="true">
                {option.value === theme ? <Icon name="checkmark" size={14} weight={60} /> : null}
              </span>
            </label>
          ))}
        </fieldset>
      </SettingsSection>
      <SettingsSection title="Display">
        <SwitchRow
          label="Show cents on Home"
          description={desktop ? "The hero shows $1,116.65 instead of $1,117." : "Left to spend shows $1,116.65 instead of $1,117."}
          checked={showCents}
          onChange={(value) => {
            setPreferences({ showCents: value });
          }}
        />
        <SwitchRow
          label="Reduce transparency"
          description={
            desktop
              ? "Use solid surfaces instead of glass for the sidebar and toolbars."
              : "Use solid surfaces instead of glass for the navigation and toolbars. Your device's own setting also applies."
          }
          checked={reduceTransparency}
          onChange={(value) => {
            setPreferences({ reduceTransparency: value });
          }}
        />
        <div className="setting-row">
          <label htmlFor={weekId} className="setting-row__body setting-row__title">
            Week starts on
          </label>
          <span className="setting-select">
            <select
              id={weekId}
              value={weekStartsOn}
              onChange={(event) => {
                setPreferences({
                  weekStartsOn: event.currentTarget.value as WeekStart,
                });
              }}
            >
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </select>
            <Icon name="chevron-down" size={14} />
          </span>
        </div>
      </SettingsSection>
      {desktop ? <ServerSyncSection /> : null}
    </>
  );
}

/**
 * A sample of the theme: a phone (cards `iphone-appearance`, `ipad-settings`) or a window tile
 * (card `web-settings`), in the theme's own colors. System is split down the middle.
 */
function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <span className={`theme-preview theme-preview--${theme}`} aria-hidden="true">
      <i className="theme-preview__glow" />
      <i className="theme-preview__title" />
      <i className="theme-preview__line" />
      <i className="theme-preview__card" />
      <i className="theme-preview__card theme-preview__card--2" />
      <i className="theme-preview__bar" />
    </span>
  );
}
