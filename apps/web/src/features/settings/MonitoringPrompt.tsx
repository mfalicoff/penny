import { useId } from "react";
import { useServerTelemetry } from "../../api/info";
import { TABLET, useMediaQuery } from "../../app/useMediaQuery";
import { Button } from "../../design/controls";
import { Icon } from "../../design/Icon";
import { useIsDemo } from "../../demo/demo";
import {
  setTelemetryChoices,
  useTelemetryChoices,
} from "../../telemetry/consent";
import { PrivacyPolicyLink } from "../legal/PrivacyPolicyLink";
import { REPORTS_NEVER } from "./PrivacySettings";

/**
 * "Help fix problems faster?" (MAZ-129, cards `web-monitoring-prompt` and `iphone-monitoring-prompt`):
 * asked once per browser, only when the server collects reports, never in the demo. "Share reports"
 * turns on errors and performance (Session Replay is only ever switched on in Settings › Privacy);
 * "Don't share" keeps everything off. Either answer is saved, and Privacy changes it later. It is
 * not modal: the page stays usable behind it.
 */
export function MonitoringPrompt({ waiting = false }: { waiting?: boolean }) {
  const server = useServerTelemetry();
  const choices = useTelemetryChoices();
  const demo = useIsDemo();
  const wide = useMediaQuery(TABLET);
  const titleId = useId();
  const bodyId = useId();
  if (!server.web || choices.decided || demo || waiting) return null;
  const host = window.location.host;

  const share = () => {
    setTelemetryChoices({ errors: true, performance: true });
  };
  const decline = () => {
    setTelemetryChoices({ errors: false, performance: false, replay: false });
  };

  if (wide) {
    return (
      <div
        className="consent"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="consent__top">
          <span className="consent__icon" aria-hidden="true">
            <Icon name="alert-circle" size={20} />
          </span>
          <div>
            <h2 id={titleId} className="consent__title">
              Help fix problems faster?
            </h2>
            <p id={bodyId} className="consent__body">
              {host} can collect errors and loading times from this browser.{" "}
              {REPORTS_NEVER} Change this anytime in Settings › Privacy.{" "}
              <PrivacyPolicyLink className="privacy-link--tint" />
            </p>
          </div>
        </div>
        <div className="consent__actions">
          <Button onClick={decline}>Don't share</Button>
          <Button variant="primary" onClick={share}>
            Share reports
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="consent__scrim" aria-hidden="true" />
    <div
      className="consent consent--sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <span className="consent__grabber" aria-hidden="true" />
      <span className="consent__icon consent__icon--large" aria-hidden="true">
        <Icon name="alert-circle" size={28} />
      </span>
      <h2 id={titleId} className="consent__title">
        Help fix problems faster?
      </h2>
      <p id={bodyId} className="consent__body">
        {host} can collect errors and how long pages take to load, so its
        operator can find and fix problems.
      </p>
      <ul className="consent__list">
        <li>
          <Icon name="checkmark" size={18} />
          <span>
            Errors and loading times
            <small>With the browser and app version</small>
          </span>
        </li>
        <li>
          <Icon name="close" size={18} />
          <span>
            Never your entries, amounts, titles, notes, names, emails or
            searches
          </span>
        </li>
      </ul>
      <Button variant="primary" className="consent__wide" onClick={share}>
        Share reports
      </Button>
      <Button className="consent__wide" onClick={decline}>
        Don't share
      </Button>
      <p className="consent__foot">
        Off until you choose. Change it anytime in Settings › Privacy.{" "}
        <PrivacyPolicyLink className="privacy-link--tint" />
      </p>
    </div>
    </>
  );
}
