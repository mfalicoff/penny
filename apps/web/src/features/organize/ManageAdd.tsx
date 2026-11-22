import { createPortal } from "react-dom";
import type { Ref } from "react";
import { useTopbarSlot } from "../../app/shell/pageTitle";
import { Icon } from "../../design/Icon";

/**
 * The add action of a Manage page (Recurring, Accounts, Categories) in the top bar's tool slot.
 * Phones show the round glass + of the iPhone cards (`iphone-recurring`, `iphone-accounts`,
 * `iphone-categories`) at the end of the bar; from 768px it's the web cards' labelled button
 * right after the title (`web-recurring`, `web-accounts`, `web-categories`). The label is always
 * the accessible name.
 */
export function ManageAdd({ ref, label, onClick }: { ref?: Ref<HTMLButtonElement>; label: string; onClick: () => void }) {
  const slot = useTopbarSlot();
  const tools = (
    <div className="manage-tools">
      <button ref={ref} type="button" className="manage-add glass" onClick={onClick}>
        <Icon name="add" size={16} weight={44} />
        <span className="manage-add__label">{label}</span>
      </button>
    </div>
  );
  return slot ? createPortal(tools, slot) : tools;
}
