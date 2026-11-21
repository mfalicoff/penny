import { useAccountEmail } from "../../auth/account";
import { useIsDemo } from "../../demo/demo";
import { Avatar, Card } from "../../design/controls";
import { SectionTitle } from "./SectionTitle";

/**
 * Settings › Profile: who is signed in on this browser. Sign out is in the section list (the cards
 * draw it there at every width). No card draws this pane yet; it keeps the account panel's content.
 */
export function ProfileSettings() {
  const email = useAccountEmail();
  const demo = useIsDemo();
  return (
    <>
      <SectionTitle>Profile</SectionTitle>
      <Card title="Account">
        <div className="setting-row">
          <Avatar name={demo ? "Demo" : email} size={40} />
          <div className="setting-row__body">
            <span className="setting-row__title">{demo ? "Demo" : email}</span>
            <span className="setting-row__desc">
              {demo ? "You're exploring sample data. Nothing here is saved or sent to a server." : "Signed in on this browser. Your entries are stored on your Penny server."}
            </span>
          </div>
        </div>
      </Card>
    </>
  );
}
