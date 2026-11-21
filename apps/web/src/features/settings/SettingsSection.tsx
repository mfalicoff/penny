import { useId, type ReactNode } from "react";

/**
 * A group of settings. On phones and touch tablets the title sits above a solid inset group with a
 * footnote under it (cards `iphone-appearance`, `ipad-settings`); on desktop the title is inside
 * the panel (card `web-settings`). The look comes from the layout class on `.settings`.
 */
export function SettingsSection({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h2 id={id} className="settings-section__title">
        {title}
      </h2>
      <div className="settings-section__body">{children}</div>
      {footer ? <p className="settings-section__footer">{footer}</p> : null}
    </section>
  );
}
