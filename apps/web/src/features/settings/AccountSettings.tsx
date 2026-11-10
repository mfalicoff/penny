import { useQueryClient } from "@tanstack/react-query";
import { useAccountEmail } from "../../auth/account";
import { leaveDemo, useIsDemo } from "../../demo/demo";
import { Avatar, Button, Card } from "../../design/controls";
import { SignOutButton } from "../auth/SignOut";

/** Settings › Account: who is signed in, and sign out (or leave the demo). */
export function AccountSettings() {
  const email = useAccountEmail();
  const demo = useIsDemo();
  const queryClient = useQueryClient();
  if (demo) {
    return (
      <Card title="Account">
        <div className="setting-row">
          <Avatar name="Demo" size={40} />
          <div className="setting-row__body">
            <span className="setting-row__title">Demo</span>
            <span className="setting-row__desc">You're exploring sample data. Nothing here is saved or sent to a server.</span>
          </div>
          <Button
            variant="danger-quiet"
            onClick={() => {
              void leaveDemo(queryClient);
            }}
          >
            Leave demo
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Account">
      <div className="setting-row">
        <Avatar name={email} size={40} />
        <div className="setting-row__body">
          <span className="setting-row__title">{email}</span>
          <span className="setting-row__desc">Signed in on this browser. Your entries are stored on your Penny server.</span>
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-row__body">
          <span className="setting-row__title">Sign out</span>
          <span className="setting-row__desc">Clears what Penny kept in this browser. Changes waiting to sync block sign-out until they're saved.</span>
        </div>
        <SignOutButton />
      </div>
    </Card>
  );
}
