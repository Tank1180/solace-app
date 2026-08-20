import { useEffect, useState } from 'react';
import { BarChart, Bar, Cell, Tooltip, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import api from '../api/client';

const COLORS = ['#2F6F4E', '#3A7CA5', '#4C9A6A', '#6F7472', '#1E4A33', '#7FAF92', '#5F8FA8', '#9DA2A0', '#C5C9C7', '#E1E4E3'];
const GRID_COLOR = '#E1E4E3';
const AXIS_COLOR = '#6F7472';
const TOOLTIP_STYLE = {
  backgroundColor: '#FFFFFF',
  border: '1px solid #E1E4E3',
  borderRadius: '8px',
  color: '#1A1C1C',
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [billSnapshot, setBillSnapshot] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    Promise.all([
      api.get('/dashboard'),
      api.get('/bills', { params: { month: currentMonth } }),
    ])
      .then(([dashboardRes, billsRes]) => {
        setData(dashboardRes.data);
        setBillSnapshot(billsRes.data);
      })
      .catch((err) => setError(err.response?.data?.error || 'Failed to load dashboard'));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data || !billSnapshot) return <p>Loading…</p>;

  const { totals, spendingByCategory, spendingByMonth, alerts, referenceRangeLabel, realizedGainsYear } = data;
  const fmt = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const topCategories = spendingByCategory.slice(0, 10);
  const billsDueNext30 = billSnapshot.upcomingWindows?.find((window) => window.days === 30)?.total || 0;

  return (
    <div>
      <h1>Dashboard</h1>

      <div className="dashboard-section-header">
        <h2>Income and spending</h2>
        <span>{referenceRangeLabel}</span>
      </div>
      <div className="stat-grid">
        <StatCard label="Total gross pay" value={fmt(totals.totalGrossPay)} />
        <StatCard label="Total net pay" value={fmt(totals.totalNetPay)} />
        <StatCard label="Other income" value={fmt(totals.totalOtherIncome)} />
        <StatCard label="Total spending" value={fmt(totals.totalSpending)} />
      </div>

      <div className="dashboard-section-header compact">
        <h2>Cash flow obligations</h2>
        <span>Running cash balance and bills due in the next 30 days</span>
      </div>
      <div className="stat-grid dashboard-secondary-grid">
        <StatCard label="Current amount of cash" value={fmt(totals.currentCashBalance)} />
        <StatCard label="Bills coming due in next 30 days" value={fmt(billsDueNext30)} />
      </div>

      <div className="dashboard-divider">
        <span>Investments snapshot</span>
      </div>
      <div className="stat-grid dashboard-secondary-grid">
        <StatCard label="Total invested (cost basis)" value={fmt(totals.investedCostBasis)} />
        <StatCard label="Portfolio market value" value={fmt(totals.portfolioMarketValue)} />
        <StatCard label="Unrealized gain" value={fmt(totals.unrealizedGain)} />
        <StatCard label={`Realized investment gains (${realizedGainsYear})`} value={fmt(totals.realizedGains)} />
      </div>

      <div className="chart-row">
        <div className="card chart-card">
          <h2>Top 10 spending categories</h2>
          <p className="muted">{referenceRangeLabel}</p>
          {topCategories.length === 0 ? <p>No spending recorded yet.</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topCategories} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
                <XAxis type="number" stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} />
                <YAxis type="category" dataKey="category" width={110} stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmt(value)} />
                <Bar dataKey="total">
                  {topCategories.map((entry, i) => <Cell key={entry.category} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card chart-card">
          <h2>Spending by month</h2>
          <p className="muted">{referenceRangeLabel}</p>
          {spendingByMonth.length === 0 ? <p>No spending recorded yet.</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={spendingByMonth}>
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
                <XAxis dataKey="month" stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} />
                <YAxis stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmt(value)} />
                <Bar dataKey="total" fill="#2F6F4E" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Unusual spending alerts</h2>
        {alerts.length === 0 ? <p>No unusual transactions detected.</p> : (
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr></thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td>{a.txn_date}</td>
                  <td>{a.description}</td>
                  <td>{a.category_name || 'Uncategorized'}</td>
                  <td>{fmt(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
