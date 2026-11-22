import { useId } from "react";
import { Icon } from "../../design/Icon";

interface RemoveSectionProps {
  /** What the section does, its accessible name and the action of an unused record ("Remove account"). */
  label: string;
  /** Records the links can move to; `undefined` when nothing uses the record. */
  others: { id: string; name: string }[] | undefined;
  moveTo: string;
  onMoveTo: (id: string) => void;
  onRemove: () => void;
  busy: "save" | "remove" | null;
  /** The note under the group: what uses the record, or why removing it is safe or locked. */
  note: string;
}

/**
 * Removing an account or category (cards `iphone-account-form`, `iphone-category-form`): one solid
 * group with "Move them to" and its choice on the right, then the centered action, which stays
 * grey until a destination is chosen; the note sits under the group. A record nothing uses has the
 * red Remove row alone, and one with nowhere to move its links has that row locked.
 */
export function RemoveSection({ label, others, moveTo, onMoveTo, onRemove, busy, note }: RemoveSectionProps) {
  const ids = { moveTo: useId(), note: useId() };
  const removing = busy === "remove";
  const blocked = busy !== null && !removing;
  return (
    <section className="organize-remove" aria-label={label}>
      <div className="organize-remove__group">
        {others === undefined ? (
          <button type="button" className="organize-remove__action" aria-describedby={ids.note} aria-busy={removing || undefined} disabled={blocked} onClick={onRemove}>
            <Icon name="trash" size={17} />
            {removing ? "Removing…" : label}
          </button>
        ) : others.length ? (
          <>
            <div className="organize-remove__row">
              <label htmlFor={ids.moveTo}>Move them to</label>
              <span className="organize-remove__choice">
                <select
                  id={ids.moveTo}
                  value={moveTo}
                  onChange={(event) => {
                    onMoveTo(event.currentTarget.value);
                  }}
                >
                  <option value="">Choose</option>
                  {others.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevron-down" size={15} />
              </span>
            </div>
            <button
              type="button"
              className="organize-remove__action"
              aria-describedby={ids.note}
              aria-busy={removing || undefined}
              disabled={!moveTo || blocked}
              onClick={onRemove}
            >
              <Icon name="trash" size={17} />
              {removing ? "Removing…" : "Move and remove"}
            </button>
          </>
        ) : (
          <p className="organize-remove__locked">
            <Icon name="lock-closed" size={16} />
            {label}
          </p>
        )}
      </div>
      <p id={ids.note} className="organize-remove__note">
        {note}
      </p>
    </section>
  );
}
