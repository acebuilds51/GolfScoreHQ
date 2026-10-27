import { Link } from 'react-router-dom';
import { LEGAL } from '../pages/LegalPages';

/** Links Stripe and customers look for on every page. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="About GolfScoreHQ">
        <Link to="/pricing">Pricing</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/refunds">Refunds</Link>
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
      </nav>
      <p>© {new Date().getFullYear()} GolfScoreHQ</p>
    </footer>
  );
}
