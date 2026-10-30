import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { COURSE_OFFER, PRICE, PRO_PERKS } from '../lib/plans';

// Public pages Stripe and customers expect: pricing, terms, privacy, refunds.
// Plain-language drafts; have them reviewed by a lawyer before relying on them.

export const LEGAL = {
  operator: 'Anthony Edmonds, doing business as GolfScoreHQ',
  shortName: 'GolfScoreHQ',
  state: 'Michigan',
  email: 'support@golfscorehq.app',
  site: 'golfscorehq.app',
  updated: 'October 26, 2026',
  refundDays: 14,
};

const Mail = () => <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page narrow legal">
      <h1>{title}</h1>
      <p className="small muted">Last updated {LEGAL.updated}</p>
      {children}
    </div>
  );
}

export function PricingPage() {
  return (
    <div className="page legal pricing">
      <h1>Pricing</h1>
      <p className="lead">Every plan includes unlimited golfers. You pay for features, never for the size of your league.</p>
      <div className="grid three pricing-grid">
        <section className="card stack">
          <h2>Free</h2>
          <p><span className="num upgrade-price">$0</span></p>
          <ul className="ticks small">
            <li>Live scoring from every group's phone</li>
            <li>Live leaderboard and season standings</li>
            <li>Roster, invites and course lookup</li>
            <li>The current season</li>
          </ul>
        </section>
        <section className="card stack pricing-featured">
          <h2>Pro</h2>
          <p><span className="num upgrade-price">{PRICE.pro}</span> <span className="small muted">per league, per year</span></p>
          <ul className="ticks small">
            <li>Everything in Free</li>
            {PRO_PERKS.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </section>
        <section className="card stack">
          <h2>Course plan</h2>
          <p><span className="num upgrade-price">{PRICE.course}</span> <span className="small muted">per year, every league at your course</span></p>
          <ul className="ticks small">
            <li>For golf courses</li>
            <li>Everything in Pro, for every league at the course</li>
            <li>Clubhouse TV with a sponsor screen</li>
            <li>Every league set up for you</li>
            <li>Billed to the course by invoice</li>
          </ul>
          <p className="small"><strong>{COURSE_OFFER}</strong> No cost through January 31, 2027.</p>
          <div><Link className="btn" to="/courses">For golf courses</Link></div>
        </section>
      </div>
      <p className="small muted">
        Prices in US dollars. Paid plans renew every year until cancelled; cancel anytime and keep your plan until the paid year ends.
        Full refund within {LEGAL.refundDays} days of any charge (<Link to="/refunds">refund policy</Link>). Sales tax may be added where required.
        Start free: create your league, then upgrade from its Settings page.
      </p>
      <div><Link className="btn btn-primary" to="/">Get started free</Link></div>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>These terms are an agreement between you and {LEGAL.operator} ("GolfScoreHQ", "we", "us") for your use of {LEGAL.site} and the GolfScoreHQ app (the "Service"). By using the Service you agree to them. If you use it for a league, you confirm you may agree on the league's behalf.</p>

      <h2>The Service</h2>
      <p>GolfScoreHQ helps golf leagues keep scores, standings, side games and league records. We work to keep it accurate and available, but it is provided "as is" and "as available". Commissioners are responsible for checking results before they are made final.</p>

      <h2>Accounts</h2>
      <p>You sign in with your email address. Keep access to your email secure; anyone who can read it can sign in as you. Commissioners may add golfers and their contact details to a roster; by doing so they confirm they have permission to share that information with us for running the league. You must be at least 13 to use the Service.</p>

      <h2>League money</h2>
      <p>GolfScoreHQ records amounts that golfers win or owe within their league and can show links to the commissioner's Venmo, PayPal or Zelle. <strong>We never hold, send or receive league money</strong>, and we are not a party to any arrangement between golfers. Leagues are responsible for making sure any games or wagers they play follow the laws where they play.</p>

      <h2>Paid plans</h2>
      <p>Pro is a yearly subscription billed in advance through our payment processor, Stripe. They <strong>renew automatically each year</strong> at the then-current price until cancelled. You can cancel anytime from <strong>Settings → Plan → Manage billing</strong>; the plan stays active until the end of the paid year and then the league returns to Free. Nothing in your league is deleted when a plan ends. Refunds are covered by our <Link to="/refunds">Refund Policy</Link>. We'll give at least 30 days' notice of any price change before it applies to your renewal. The Course plan for golf courses is billed to the course by invoice on the terms we agree with the course.</p>

      <h2>Your content</h2>
      <p>Your league's information (rosters, scores, results, logos and photos) stays yours. You give us permission to store, process and display it only to run the Service for you, including sharing pictures or emails you choose to send. Don't upload anything you don't have the right to use, or anything unlawful or abusive.</p>

      <h2>Acceptable use</h2>
      <p>Don't misuse the Service: no attempts to access other leagues' data, disrupt the Service, scrape it, or use it to send spam. We may suspend accounts that do.</p>

      <h2>AI features</h2>
      <p>Some features, such as the weekly recap write-up, are drafted by an AI model from your league's results. Commissioners review and can edit AI text before it's sent; it may contain mistakes.</p>

      <h2>Ending your use</h2>
      <p>You can stop using the Service anytime and ask us to delete your account or league by emailing <Mail />. We may end or suspend access for breach of these terms, with a refund of any unused prepaid time if we end it without cause.</p>

      <h2>Limits on liability</h2>
      <p>To the extent the law allows, GolfScoreHQ is not liable for indirect, incidental or consequential damages, or for lost profits or data, and our total liability for any claim is limited to the amount you paid us in the 12 months before the claim. Nothing here limits rights you have under consumer protection laws that can't be waived.</p>

      <h2>Changes</h2>
      <p>We may update these terms. If a change is significant, we'll tell account holders by email or in the app before it takes effect. Continuing to use the Service after that means you accept the new terms.</p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of the State of {LEGAL.state}, USA. Any dispute will be handled in the state or federal courts located in {LEGAL.state}.</p>

      <h2>Contact</h2>
      <p>{LEGAL.operator} · <Mail /></p>
    </LegalPage>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>This policy explains what {LEGAL.operator} ("GolfScoreHQ", "we") collects when you use {LEGAL.site}, why, and the choices you have. We don't sell personal information or use it for advertising.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address, used to sign you in.</li>
        <li><strong>League information:</strong> golfer names and, if a commissioner adds them, email addresses and phone numbers; scores, results, schedules, courses, and league settings.</li>
        <li><strong>Branding you upload:</strong> logos and course photos (we shrink them and remove photo location data).</li>
        <li><strong>Payments:</strong> handled by Stripe. We never see or store card numbers; we keep a record of each league's plan and Stripe customer reference.</li>
        <li><strong>Basic technical data:</strong> standard server logs (such as IP address and browser type) kept by our hosting providers for security and troubleshooting.</li>
      </ul>

      <h2>How we use it</h2>
      <p>Only to run the Service: signing you in, showing your league its scores and standings, sending emails you or your commissioner ask for (sign-in codes and weekly recaps), processing plan payments, keeping the Service secure, and answering support requests.</p>

      <h2>Who can see league information</h2>
      <p>Members of a league can see its roster names, scores and results. Contact details are visible only to the league's commissioners and the golfer themselves. A Clubhouse TV link shows names and scores, never contact details, to anyone with the link; commissioners can turn a link off anytime.</p>

      <h2>Service providers</h2>
      <p>We use trusted companies to run GolfScoreHQ, and they process data only for us:</p>
      <ul>
        <li><strong>Supabase</strong>: database, sign-in and file storage</li>
        <li><strong>Cloudflare</strong>: website hosting</li>
        <li><strong>Stripe</strong>: payments</li>
        <li><strong>Resend</strong>: sending emails</li>
        <li><strong>Anthropic</strong>: drafting the optional AI recap write-up (receives golfers' names and the week's results, not contact details)</li>
        <li><strong>GolfCourseAPI</strong>: course scorecard lookups (receives only course search terms)</li>
      </ul>

      <h2>Cookies and storage</h2>
      <p>We use your browser's storage only to keep you signed in and to save scores on your phone until they upload. No advertising or tracking cookies.</p>

      <h2>Emails</h2>
      <p>Sign-in codes are sent when you ask for one. Golfers can turn off the weekly recap on their league's Overview page.</p>

      <h2>Keeping and deleting data</h2>
      <p>We keep league information while the league exists so its history stays available. You can ask us to see, correct or delete your information, or to delete your account or league, by emailing <Mail />. Commissioners can also edit or remove golfers from their roster. Payment records may be kept as required for tax and accounting.</p>

      <h2>Security</h2>
      <p>Data is encrypted in transit, and each league's information is walled off from other leagues in the database. No system is perfectly secure, but we work to protect your information and will notify affected users of a breach as required by law.</p>

      <h2>Children</h2>
      <p>GolfScoreHQ isn't directed to children under 13, and we don't knowingly collect their information. If you believe a child's information was added, email us and we'll remove it.</p>

      <h2>Changes</h2>
      <p>If we make significant changes, we'll update this page and let account holders know.</p>

      <h2>Contact</h2>
      <p>{LEGAL.operator}, {LEGAL.state}, USA · <Mail /></p>
    </LegalPage>
  );
}

export function RefundsPage() {
  return (
    <LegalPage title="Refund Policy">
      <p><strong>Full refund within {LEGAL.refundDays} days.</strong> If you're not happy with a Pro plan, email <Mail /> within {LEGAL.refundDays} days of being charged (for a new plan or a yearly renewal) and we'll refund that charge in full. No questions asked.</p>
      <h2>After {LEGAL.refundDays} days</h2>
      <p>Charges older than {LEGAL.refundDays} days aren't refunded. You can still cancel anytime from <strong>Settings → Plan → Manage billing</strong>: your plan stays on until the end of the year you paid for, and it won't renew.</p>
      <h2>How refunds are paid</h2>
      <p>Refunds go back to the card used, through Stripe, usually within 5–10 business days depending on your bank. When a charge is refunded, the plan it paid for ends and the league returns to Free; nothing in the league is deleted.</p>
      <h2>Questions</h2>
      <p>Email <Mail /> and include your league's name.</p>
    </LegalPage>
  );
}
