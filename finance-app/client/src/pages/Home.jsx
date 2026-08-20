import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const featureGroups = [
  {
    title: 'Track every dollar',
    items: [
      'Capture spending, bills, and paycheck details in one place.',
      'Import card activity and review category trends over time.',
      'Stay ahead of upcoming obligations with cash flow visibility.',
    ],
  },
  {
    title: 'Plan with confidence',
    items: [
      'Monitor investments, market value, gains, dividends, and net worth.',
      'Estimate taxes with filing profile, spouse income, and deductions.',
      'Export reports that help with daily reviews and tax preparation.',
    ],
  },
  {
    title: 'Built for households and businesses',
    items: [
      'Set up personal or business profiles during onboarding.',
      'Separate personal and business activity for cleaner records.',
      'Support admin oversight for subscriptions and customer assistance.',
    ],
  },
];

export default function Home() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="landing-page"><p>Loading…</p></div>;
  }

  if (user) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;
  }

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="brand">
          <img src="/solace-logo.png" alt="Solace" className="brand-logo" />
        </div>
        <div className="landing-actions">
          <Link className="landing-link" to="/login">Log in</Link>
          <Link className="landing-button secondary" to="/signup">Get started</Link>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero card">
          <div className="landing-copy">
            <p className="landing-eyebrow">Welcome to Solace</p>
            <h1>Your calm, clear home for finances.</h1>
            <p className="landing-subtitle">
              Organize paychecks, spending, bills, investments, taxes, and reports in one secure workspace before you ever open the dashboard.
            </p>
            <div className="landing-cta-row">
              <Link className="landing-button" to="/signup">Create an account</Link>
              <Link className="landing-button secondary" to="/login">I already have an account</Link>
            </div>
          </div>
          <div className="landing-highlight">
            <h2>Designed for real-life money management</h2>
            <ul>
              <li>Household and business account setup from day one</li>
              <li>Daily spending, bill tracking, and projected cash balance</li>
              <li>Investment performance and tax-ready summaries</li>
              <li>Admin tools for subscriptions and customer support</li>
            </ul>
          </div>
        </section>

        <section className="landing-feature-grid">
          {featureGroups.map((group) => (
            <article key={group.title} className="card landing-feature-card">
              <h2>{group.title}</h2>
              <ul>
                {group.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </section>

        <section className="card landing-footer-card">
          <h2>Ready to get started?</h2>
          <p>
            Create your profile, add your initial accounts and balances, and let Solace become the first place you visit when checking your financial picture.
          </p>
          <div className="landing-cta-row">
            <Link className="landing-button" to="/signup">Sign up for Solace</Link>
            <Link className="landing-link" to="/login">Go to login</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
