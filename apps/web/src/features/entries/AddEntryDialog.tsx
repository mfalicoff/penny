import { useRef } from "react";
import { Button, Kbd } from "../../design/controls";
import { Dialog } from "../../design/ModalDialog";

/**
 * Add entry (web card `web-add-entry`): a centered dialog over the current page, opened by the
 * top bar button, N, or a deep link to `/entries/new`. Esc cancels. The two-column entry form,
 * its draft retention and ⌘↵ to save arrive with the transaction forms (MAZ-88); until then the
 * dialog says so instead of offering a form that can't save.
 */
export function AddEntryDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title="Add entry"
      description="Adding entries from the browser isn't available yet. Use the Penny app on your phone for now; entries you add there show up here after they sync."
      onClose={onClose}
      initialFocus={closeRef}
      hint={
        <>
          <Kbd>Esc</Kbd> to close
        </>
      }
      actions={
        <Button ref={closeRef} variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    />
  );
}
