import { useId, type CSSProperties } from "react";
import { Badge } from "../../design/controls";
import { Icon, type IconName } from "../../design/Icon";

interface OrganizeRowProps {
  name: string;
  meta: string;
  icon: IconName;
  /** The record's own color (categories); accounts use the plain tile. */
  color?: string;
  /** Saved in this browser, not yet on the server. */
  waiting: boolean;
  onOpen: () => void;
}

/**
 * One account or category in a list: the whole row opens its form. The button is named "Edit …"
 * and described by the type and usage line, plus "Waiting to sync" while that's true.
 */
export function OrganizeRow({ name, meta, icon, color, waiting, onOpen }: OrganizeRowProps) {
  const metaId = useId();
  const badgeId = useId();
  const tile: CSSProperties | undefined = color ? { background: color } : undefined;
  return (
    <li>
      <button type="button" className="organize-row" aria-label={`Edit ${name}`} aria-describedby={waiting ? `${metaId} ${badgeId}` : metaId} onClick={onOpen}>
        <span className={color ? "organize-tile" : "organize-tile organize-tile--plain"} style={tile} aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <span className="organize-row__text">
          <span className="organize-row__name">{name}</span>
          <span id={metaId} className="organize-row__meta">
            {meta}
          </span>
        </span>
        {waiting ? (
          <span id={badgeId} className="organize-row__badge">
            <Badge tone="pending" icon="time">
              Waiting to sync
            </Badge>
          </span>
        ) : null}
        <Icon name="chevron-forward" size={16} />
      </button>
    </li>
  );
}
