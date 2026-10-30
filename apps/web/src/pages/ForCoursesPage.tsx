import { Link } from 'react-router-dom';
import { COURSE_OFFER, PRICE } from '../lib/plans';
import { LEGAL } from './LegalPages';

const PHONE = '248-767-5318';

/** golfscorehq.app/courses: the pitch for golf course pro shops (every league at the facility). */
export function ForCoursesPage() {
  return (
    <div className="page narrow stack">
      <section className="hero">
        <h1>Every league at your course, run for you</h1>
        <p className="lead">
          Golfers score on their phones. The leaderboard goes live on your grill-room TV. Skins, closest to the pin and match money
          settle themselves. No spreadsheets for your staff, no arguments for your chairmen.
        </p>
        <div className="row wrap">
          <a className="btn btn-primary" href="/demo">See a live demo</a>
          <a className="btn" href={`tel:${PHONE}`}>Call or text Tony: {PHONE}</a>
        </div>
      </section>

      <section className="card stack">
        <h2>For the pro shop</h2>
        <ul className="ticks">
          <li><strong>Clubhouse TV.</strong> A live leaderboard on any screen keeps golfers in the grill room after the round.</li>
          <li><strong>Every league in one place.</strong> Men's, ladies', couples, twilight. As many as you run.</li>
          <li><strong>A sponsor screen.</strong> Sell the TV slot to a local business.</li>
          <li><strong>Nothing for your staff to do.</strong> Golfers and chairmen run league night from their phones.</li>
        </ul>
      </section>

      <section className="card stack">
        <h2>For the league chairmen</h2>
        <ul className="ticks">
          <li><strong>Scores on phones,</strong> hole by hole, live for everyone. One golfer per group can score, or the chairman enters the cards.</li>
          <li><strong>Golfers don't need an account</strong> or a password to be in the league.</li>
          <li><strong>The money is done:</strong> skins, closest to the pin, matches and presses, with each golfer's balance and Venmo, PayPal or Zelle links. We never hold the money.</li>
          <li><strong>Handicaps</strong> from each golfer's GHIN index, or worked out from league rounds.</li>
          <li><strong>RSVPs, a sub finder, a written recap of the week</strong> and season awards.</li>
          <li>Best-ball match play, stroke play, Stableford and scramble.</li>
        </ul>
      </section>

      <section className="card stack pricing-featured">
        <h2>Course plan</h2>
        <p>
          <span className="num upgrade-price">{PRICE.course}</span> <span className="small muted">per year, every league at your course</span>
        </p>
        <p><strong>{COURSE_OFFER}</strong></p>
        <ul className="ticks">
          <li>No cost through January 31, 2027, and nothing to cancel if it's not for you</li>
          <li>Unlimited leagues and golfers</li>
          <li>We set up every league for you: send the roster and the format</li>
          <li>Clubhouse TV with a sponsor screen, your logo and colors</li>
          <li>Billed to the course by invoice, with the price locked for as long as you stay</li>
          <li>Direct line to the person who built it</li>
        </ul>
        <p className="small muted">A commissioner running a few leagues on their own can use the <Link to="/pricing">Pro or Club plans</Link> instead.</p>
      </section>

      <section className="card stack">
        <h2>Straight answers</h2>
        <p><strong>Does it post scores to GHIN?</strong> No. Golfers post their rounds in the GHIN app as they do now; we use their GHIN index for net matches and skins.</p>
        <p><strong>Do golfers need to download an app?</strong> No. It runs in the phone's browser, and they can add it to their home screen.</p>
        <p><strong>What does the TV need?</strong> Any screen with a web browser: a smart TV, a streaming stick or a laptop. You open a private link once.</p>
        <p><strong>What about tournaments?</strong> GolfScoreHQ is built for weekly leagues, not one-day tournaments or member-guests.</p>
      </section>

      <section className="card stack">
        <h2>Built by a league golfer</h2>
        <p>
          GolfScoreHQ grew out of the app I built for my own men's league in Michigan. In 2026 it ran our whole season: 36 golfers,
          15 league nights and 102 matches, scored live with the skins and side money settled every week. Now I'm bringing it to a
          few Florida courses. You deal with me directly, and I set up every league myself.
        </p>
        <p>Tony Edmonds · <a href={`tel:${PHONE}`}>{PHONE}</a> (call or text) · <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a></p>
      </section>
    </div>
  );
}
