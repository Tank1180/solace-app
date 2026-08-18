import { useEffect, useState } from 'react';
import api from '../api/client';
import { formatMoney } from '../utils/format';

const QUARTERS = [1, 2, 3, 4];

export default function Business() {
  const year = new Date().getFullYear();
  const [pl, setPl] = useState(null);
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState({ taxYear: year, quarter: 1, paidDate: '', amount: '', notes: '' });
  const [error, setError] = useState('');

  const load = () => {
    api.get(`/business/profit-loss?year=${year}`).then((res) => setPl(res.data)).catch((err) => setError(err.response?.data?.error || 'Failed to load P&L'));
    api.get(`/business/quarterly-payments?year=${year}`).then((res) => setPayments(res.data.payments));
  };
  useEffect(() => { load(); }, []);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const addPayment = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/business/quarterly-payments', { ...form, amount: Number(form.amount || 0) });
      setForm({ taxYear: year, quarter: 1, paidDate: '', amount: '', notes: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save payment');
    }
  };

  const removePayment = async (id) => {
    await api.delete(`/business/quarterly-payments/${id}`);
    load();
  };

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <h1>Business Center</h1>
      <p className="muted">Business-only tools: profit &amp; loss statements and quarterly estimated tax payment tracking.</p>
      {error && <div className="error">{error}</div>}

      {pl && (
        <div className="card">
          <h2>Profit &amp; loss — {pl.year}</h2>
          <div className="stats-grid">
            <div className="stat-card"><div className="stat-label">Business revenue</div><div className="stat-value">{formatMoney(pl.revenue.total)}</div></div>
            <div className="stat-card"><div className="stat-label">Business expenses</div><div className="stat-value">{formatMoney(pl.expenses.total)}</div></div>
            <div className="stat-card"><div className="stat-label">Net profit</div><div className="stat-value">{formatMoney(pl.netProfit)}</div></div>
          </div>

          <h3>Revenue by category</h3>
          {Object.keys(pl.revenue.byCategory).length > 0 ? (
            <table>
              <thead><tr><th>Category</th><th>Amount</th></tr></thead>
              <tbody>
                {Object.entries(pl.revenue.byCategory).map(([cat, amt]) => (
                  <tr key={cat}><td>{cat}</td><td>{formatMoney(amt)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No self-employment/business income logged yet. Add entries via Other Income and flag them as self-employment.</p>}

          <h3>Expenses</h3>
          <ul>
            <li>Business Expense transactions: {formatMoney(pl.expenses.transactionExpenses)}</li>
            <li>Deductible business expenses (Tax Center): {formatMoney(pl.expenses.deductibleExpenses)}</li>
          </ul>
        </div>
      )}

      <div className="card">
        <h2>Quarterly estimated tax payments — {year}</h2>
        <form onSubmit={addPayment}>
          <div className="row">
            <label>Quarter
              <select value={form.quarter} onChange={update('quarter')}>
                {QUARTERS.map((q) => <option key={q} value={q}>Q{q}</option>)}
              </select>
            </label>
            <label>Paid date
              <input type="date" value={form.paidDate} onChange={update('paidDate')} />
            </label>
            <label>Amount
              <input type="number" step="0.01" required value={form.amount} onChange={update('amount')} />
            </label>
          </div>
          <label>Notes
            <input value={form.notes} onChange={update('notes')} />
          </label>
          <button type="submit">Record payment</button>
        </form>

        <table>
          <thead><tr><th>Quarter</th><th>Paid date</th><th>Amount</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>Q{p.quarter}</td>
                <td>{p.paid_date || '—'}</td>
                <td>{formatMoney(p.amount)}</td>
                <td>{p.notes}</td>
                <td><button onClick={() => removePayment(p.id)}>Delete</button></td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan="5" className="muted">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
        <p><strong>Total paid this year: {formatMoney(totalPaid)}</strong></p>
      </div>
    </div>
  );
}
