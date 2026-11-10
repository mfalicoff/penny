import { Link } from "@tanstack/react-router";
import { Card } from "../../design/controls";
import { Icon } from "../../design/Icon";

/**
 * Home until the overview arrives (MAZ-92): it says what the web app can do today and links
 * there, rather than showing made-up numbers.
 */
export function HomePage() {
  return (
    <div className="page page--home">
      <div className="glow" aria-hidden="true" />
      <Card title="Welcome to Penny on the web">
        <p className="muted">Your overview, money flow and shared spaces are on their way. For now you can search everything you've recorded.</p>
        <ul className="link-list">
          <li>
            <Link to="/transactions" className="link-row">
              <Icon name="search" size={18} />
              Search your activity
              <Icon name="chevron-forward" size={16} />
            </Link>
          </li>
          <li>
            <Link to="/settings/appearance" className="link-row">
              <Icon name="sunny" size={18} />
              Choose light or dark
              <Icon name="chevron-forward" size={16} />
            </Link>
          </li>
        </ul>
      </Card>
    </div>
  );
}
