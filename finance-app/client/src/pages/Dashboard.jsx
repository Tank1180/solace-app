import { useEffect, useState } from 'react';
import { BarChart, Bar, Cell, Tooltip, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import api from '../api/client';

const COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dashboard').then((res) => setData(res.data)).catch((err) => setError(err.response?.data?.error || 'Failed to load dashboard'));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p>Loading…</p>;

  const { totals, spendingByCategory, spendingByMonth, alerts } = data;
  const fmt = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const topCategories = spendingByCategory.slice(0, 10);

  return (
    <div>
      <h1>Dashboard</h1>

      <div className="stat-grid">
        <StatCard label="Total gross pay" value={fmt(totals.totalGrossPay)} />
        <StatCard label="Total net pay" value={fmt(totals.totalNetPay)} />
        <StatCard label="Total spending" value={fmt(totals.totalSpending)} />
        <StatCard label="Savings rate" value={totals.savingsRate == null ? '—' : `${(totals.savingsRate * 100).toFixed(1)}%`} />
        <StatCard label="Invested (cost basis)" value={fmt(totals.investedCostBasis)} />
        <StatCard label="Realized investment gains" value={fmt(totals.realizedGains)} />
        <StatCard label="Total dividends" value={fmt(totals.totalDividends)} />
        <StatCard label="Other income" value={fmt(totals.totalOtherIncome)} />
        <StatCard label="Estimated net worth" value={fmt(totals.netWorthEstimate)} />
      </div>

      <div className="chart-row">
        <div className="card chart-card">
          <h2>Top 10 spending categories</h2>
          {topCategories.length === 0 ? <p>No spending recorded yet.</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topCategories} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="category" width={110} />
                <Tooltip />
                <Bar dataKey="total">
                  {topCategories.map((entry, i) => <Cell key={entry.category} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card chart-card">
          <h2>Spending by month</h2>
          {spendingByMonth.length === 0 ? <p>No spending recorded yet.</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={spendingByMonth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total" fill="#4f46e5" />
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
