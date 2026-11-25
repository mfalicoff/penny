import { useId } from "react";
import { usePrivacyPolicyUrl, useServerTelemetry } from "../../api/info";
import { SwitchRow } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { useIsDemo } from "../../demo/demo";
import {
  setTelemetryChoices,
  useTelemetryChoices,
} from "../../telemetry/consent";
import { SectionTitle } from "./SectionTitle";
import { SettingsSection } from "./SettingsSection";
import { useSettingsLayout } from "./SettingsLayout";

export const REPORTS_NEVER =
  "Reports never include your entries, amounts, titles, notes, names, emails or searches.";

/**
 * Settings › Privacy (MAZ-129, cards `web-privacy` and `iphone-privacy`): what this browser sends
 * to its server's operator, each kind off until switched on here or with the prompt's "Share
 * reports". Listed only when the server collects reports; Record sessions only when it offers
 * Session Replay. The choices are saved for this browser, and the demo never sends any.
 */
export function PrivacySettings() {
  const layout = useSettingsLayout();
  const server = useServerTelemetry();
  const choices = useTelemetryChoices();
  const demo = useIsDemo();
  const policy = usePrivacyPolicyUrl();
  const host = window.location.host;
  const headingId = useId();

  const switches = (
    <>
      <SwitchRow
        label="Share error reports"
        description="Errors in this browser, with the browser and app version"
        checked={choices.errors}
        onChange={(errors) => {
          setTelemetryChoices({ errors });
        }}
      />
      <SwitchRow
        label="Share performance data"
        description="How long pages and requests take"
        checked={choices.performance}
        onChange={(performance) => {
          setTelemetryChoices({ performance });
        }}
      />
      {server.sessionReplay ? (
        <SwitchRow
          label="Record sessions"
          description="A replay of clicks and page changes with every text and field masked. Kept for 30 days."
          checked={choices.replay}
          onChange={(replay) => {
            setTelemetryChoices({ replay });
          }}
        />
      ) : null}
    </>
  );
  const policyRow = policy ? (
    <a
      className="setting-row privacy-policy-row"
      href={policy}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Privacy Policy (opens in a new tab)"
    >
      <span className="privacy-policy-row__icon" aria-hidden="true">
        <Icon name="document-text" size={18} />
      </span>
      <span className="setting-row__body">
        <span className="setting-row__title">Privacy Policy</span>
        {layout === "desktop" ? (
          <span className="setting-row__desc">
            Published by your server's operator
          </span>
        ) : null}
      </span>
      <span className="setting-row__value">
        {layout === "desktop" ? "Opens in a new tab" : null}
        <span className="privacy-policy-row__arrow" aria-hidden="true">
          <Icon name="arrow-up" size={14} />
        </span>
      </span>
    </a>
  ) : null;

  if (layout !== "desktop") {
    return (
      <div className="privacy">
        <SectionTitle>Privacy</SectionTitle>
        <SettingsSection
          title={`Reports to ${host}`}
          footer={`${REPORTS_NEVER} The sample data never sends reports.`}
        >
          {switches}
        </SettingsSection>
        {policyRow ? (
          <SettingsSection
            title="Policies"
            footer="Opens in a new tab. Your server's operator publishes it."
          >
            {policyRow}
          </SettingsSection>
        ) : null}
        {demo ? <DemoNote /> : null}
      </div>
    );
  }
  return (
    <div className="privacy">
      <section
        className="settings-section privacy__reports"
        aria-labelledby={headingId}
      >
        <h2 id={headingId} className="privacy__heading">
          Reports to {host}
        </h2>
        <p className="privacy__lead">
          Help the server's operator find and fix problems. {REPORTS_NEVER}
        </p>
        <div className="settings-section__body">{switches}</div>
      </section>
      {policyRow ? (
        <SettingsSection title="Policies">{policyRow}</SettingsSection>
      ) : null}
      <p className="privacy-footer">
        <Icon name="lock-closed" size={14} />
        <span>
          These choices are saved for this browser. The sample data never sends
          reports.
        </span>
      </p>
      {demo ? <DemoNote /> : null}
    </div>
  );
}

function DemoNote() {
  return (
    <p className="setting-note" role="status">
      You're exploring sample data in this tab, so nothing is sent whatever you
      choose here.
    </p>
  );
}
