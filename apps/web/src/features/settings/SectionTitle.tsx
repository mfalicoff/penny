import type { ReactNode } from "react";
import { useSettingsLayout } from "./SettingsLayout";

/**
 * The open section's large title on a touch tablet (card `ipad-settings`: "Appearance" over the
 * pane). Phones show it in the bar instead, and the desktop card has none.
 */
export function SectionTitle({ children }: { children: ReactNode }) {
  return useSettingsLayout() === "tablet" ? <h2 className="settings__title">{children}</h2> : null;
}
