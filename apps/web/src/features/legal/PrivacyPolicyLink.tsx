import { usePrivacyPolicyUrl } from "../../api/info";
import { cx } from "../../design/controls";
import { Icon } from "../../design/Icon";

/**
 * "Privacy Policy": the policy the server's operator publishes (`GET /api/info`). It opens in a new
 * tab; the policy text is never built into the app. Renders nothing when the server publishes none.
 */
export function PrivacyPolicyLink({ className }: { className?: string }) {
  const url = usePrivacyPolicyUrl();
  if (!url) return null;
  return (
    // The name starts with the visible words, so voice control still finds it by "Privacy Policy".
    <a className={cx("privacy-link", className)} href={url} target="_blank" rel="noopener noreferrer" aria-label="Privacy Policy (opens in a new tab)">
      Privacy Policy
    </a>
  );
}

/** Whether there is a policy to link, for the sentences that only make sense with the link. */
export function useHasPrivacyPolicy(): boolean {
  return usePrivacyPolicyUrl() !== null;
}

/**
 * The Profile pane's footer (web-profile, iphone-profile): "Your account lives on <server>. Privacy
 * Policy". Not in the demo, which has no server and no account.
 */
export function AccountPrivacyFooter({ demo }: { demo: boolean }) {
  const hasPolicy = useHasPrivacyPolicy();
  if (demo) return null;
  return (
    <p className="privacy-footer">
      <Icon name="document-text" size={14} />
      <span>
        Your account lives on {window.location.host}.
        {hasPolicy ? (
          <>
            {" "}
            <PrivacyPolicyLink className="privacy-link--tint" />
          </>
        ) : null}
      </span>
    </p>
  );
}
