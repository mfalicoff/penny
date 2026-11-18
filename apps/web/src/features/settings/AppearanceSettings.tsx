import { setPreferences, usePreferences, type Theme, type WeekStart } from "../../app/preferences";
import { Card, ChoiceGroup, SwitchRow } from "../../design/controls";

const preview = (theme: Theme) => (
  <span className={`theme-preview theme-preview--${theme}`} aria-hidden="true">
    <i />
    <b />
  </span>
);

/**
 * Settings › Appearance (specimens `appearance`, `web-settings`). Light and dark only (MAZ-132);
 * System follows the device. Display holds Show cents on Home and Week starts on (MAZ-140).
 * Saved per browser, applied at once, and kept after sign-out.
 */
export function AppearanceSettings() {
  const { theme, reduceTransparency, showCents, weekStartsOn } = usePreferences();
  return (
    <>
      <Card title="Theme">
        <ChoiceGroup<Theme>
          legend="Theme"
          hideLegend
          name="theme"
          appearance="cards"
          value={theme}
          onChange={(value) => {
            setPreferences({ theme: value });
          }}
          options={[
            { value: "light", label: "Light", preview: preview("light") },
            { value: "dark", label: "Dark", preview: preview("dark") },
            { value: "system", label: "System", description: "Matches your device", preview: preview("system") },
          ]}
        />
      </Card>
      <Card title="Display">
        <SwitchRow
          label="Show cents on Home"
          description="Left to spend shows $1,116.65 instead of $1,117."
          checked={showCents}
          onChange={(value) => {
            setPreferences({ showCents: value });
          }}
        />
        <SwitchRow
          label="Reduce transparency"
          description="Use solid surfaces instead of glass for the navigation and toolbars. Your device's own setting also applies."
          checked={reduceTransparency}
          onChange={(value) => {
            setPreferences({ reduceTransparency: value });
          }}
        />
        <ChoiceGroup<WeekStart>
          legend="Week starts on"
          name="week-starts-on"
          appearance="segmented"
          value={weekStartsOn}
          onChange={(value) => {
            setPreferences({ weekStartsOn: value });
          }}
          options={[
            { value: "monday", label: "Monday" },
            { value: "sunday", label: "Sunday" },
          ]}
        />
      </Card>
    </>
  );
}
