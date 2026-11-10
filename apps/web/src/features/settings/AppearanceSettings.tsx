import { setPreferences, usePreferences, type Theme } from "../../app/preferences";
import { Card, ChoiceGroup, SwitchRow } from "../../design/controls";

const preview = (theme: Theme) => (
  <span className={`theme-preview theme-preview--${theme}`} aria-hidden="true">
    <i />
    <b />
  </span>
);

/**
 * Settings › Appearance (specimens `appearance`, `web-settings`). Light and dark only (MAZ-132);
 * System follows the device. Saved per browser, applied at once, and kept after sign-out.
 */
export function AppearanceSettings() {
  const { theme, reduceTransparency } = usePreferences();
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
          label="Reduce transparency"
          description="Use solid surfaces instead of glass for the navigation and toolbars. Your device's own setting also applies."
          checked={reduceTransparency}
          onChange={(value) => {
            setPreferences({ reduceTransparency: value });
          }}
        />
      </Card>
    </>
  );
}
