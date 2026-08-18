import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { formatMoney } from '../utils/format';

const BILL_CATEGORIES = [
  { value: 'housing', label: 'Housing' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'loans', label: 'Loans' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'other', label: 'Other' },
];

const RECURRENCE_UNITS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const currentMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

const emptyBillForm = {
  billName: '',
  category: 'housing',
  billType: 'one_time',
  amount: '',
  dueDate: today,
  recurrenceUnit: 'monthly',
  recurrenceCount: 1,
  notes: '',
};

const emptyPayForm = {
  billId: '',
  paymentDate: today,
  amount: '',
  notes: '',
};

export default function Bills() {
  const [month, setMonth] = useState(currentMonth);
  const [bills, setBills] = useState([]);
  const [upcomingWindows, setUpcomingWindows] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [billForm, setBillForm] = useState(emptyBillForm);
  const [payForm, setPayForm] = useState(emptyPayForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectedBill = useMemo(
    () => bills.find((bill) => String(bill.id) === String(payForm.billId)) || null,
    [bills, payForm.billId]
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('/bills', { params: { month } });
      setBills(data.bills || []);
      setUpcomingWindows(data.upcomingWindows || []);
      setAlerts(data.alerts || []);
      setMonthlySummary(data.monthlySummary || null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load bills');
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const updateBillForm = (field) => (e) => {
    const value = e.target.value;
    setBillForm((current) => {
      if (field === 'billType') {
        return {
          ...current,
          billType: value,
          recurrenceUnit: value === 'recurring' ? current.recurrenceUnit : 'monthly',
          recurrenceCount: value === 'recurring' ? current.recurrenceCount : 1,
        };
      }
      return { ...current, [field]: value };
    });
  };

  const startEdit = (bill) => {
    setEditingId(bill.id);
    setBillForm({
      billName: bill.bill_name || '',
      category: bill.category || 'other',
      billType: bill.bill_type || 'one_time',
      amount: bill.amount ?? '',
      dueDate: bill.due_date || today,
      recurrenceUnit: bill.recurrence_unit || 'monthly',
      recurrenceCount: bill.recurrence_count || 1,
      notes: bill.notes || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setBillForm(emptyBillForm);
  };

  const submitBill = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const payload = {
        ...billForm,
        amount: Number(billForm.amount || 0),
        recurrenceCount: Number(billForm.recurrenceCount || 1),
      };
      if (editingId) {
        await api.put(`/bills/${editingId}`, payload);
        setMessage('Bill updated.');
      } else {
        await api.post('/bills', payload);
        setMessage('Bill added.');
      }
      setBillForm(emptyBillForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save bill');
    }
  };

  const startPay = (bill) => {
    setPayForm({
      billId: String(bill.id),
      paymentDate: today,
      amount: bill.amount ?? '',
      notes: '',
    });
  };

  const cancelPay = () => {
    setPayForm(emptyPayForm);
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post(`/bills/${payForm.billId}/pay`, {
        paymentDate: payForm.paymentDate,
        amount: payForm.amount === '' ? undefined : Number(payForm.amount),
        notes: payForm.notes,
      });
      setPayForm(emptyPayForm);
      setMessage('Bill marked as paid.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record payment');
    }
  };

  const removeBill = async (id) => {
    await api.delete(`/bills/${id}`);
    load();
  };

  const categoryLabel = (value) => BILL_CATEGORIES.find((c) => c.value === value)?.label || value;

  return (
    <div>
      <h1>Bills</h1>
      <p className="muted">Track recurring and one-time bills separately from discretionary spending to monitor cash flow.</p>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <div className="row" style={{ alignItems: 'end' }}>
        <label>Summary month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

      {monthlySummary && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-label">Bills paid</div><div className="stat-value">{formatMoney(monthlySummary.billsPaid)}</div></div>
          <div className="stat-card"><div className="stat-label">Discretionary spending</div><div className="stat-value">{formatMoney(monthlySummary.discretionarySpending)}</div></div>
          <div className="stat-card"><div className="stat-label">Current cash flow</div><div className="stat-value">{formatMoney(monthlySummary.currentCashFlow)}</div></div>
          <div className="stat-card"><div className="stat-label">Projected balance (30d)</div><div className="stat-value">{formatMoney(monthlySummary.projectedBalance30)}</div></div>
          <div className="stat-card"><div className="stat-label">Projected balance (60d)</div><div className="stat-value">{formatMoney(monthlySummary.projectedBalance60)}</div></div>
        </div>
      )}

      <div className="card">
        <h2>Upcoming bills</h2>
        <div className="stat-grid">
          {upcomingWindows.map((window) => (
            <div className="stat-card" key={window.days}>
              <div className="stat-label">Next {window.days} days</div>
              <div className="stat-value">{window.count} / {formatMoney(window.total)}</div>
            </div>
          ))}
        </div>
        <table style={{ marginTop: '1rem' }}>
          <thead>
            <tr><th>Due date</th><th>Bill</th><th>Category</th><th>Type</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {upcomingWindows.find((window) => window.days === 30)?.bills?.map((bill) => (
              <tr key={bill.id}>
                <td>{bill.due_date}</td>
                <td>{bill.bill_name}</td>
                <td>{categoryLabel(bill.category)}</td>
                <td>{bill.bill_type === 'recurring' ? 'Recurring' : 'One-time'}</td>
                <td>{formatMoney(bill.amount)}</td>
              </tr>
            ))}
            {(upcomingWindows.find((window) => window.days === 30)?.bills || []).length === 0 && (
              <tr><td colSpan="5" className="muted">No bills due in the next 30 days.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Alerts</h2>
        {alerts.length === 0 ? (
          <p>No bill alerts right now.</p>
        ) : (
          <ul className="rule-list">
            {alerts.map((alert, index) => <li key={`${alert.type}-${index}`}>{alert.message}</li>)}
          </ul>
        )}
      </div>

      <div className="row-cards">
        <form className="card" onSubmit={submitBill}>
          <h2>{editingId ? 'Edit bill' : 'Add bill'}</h2>
          <label>Bill name
            <input required value={billForm.billName} onChange={updateBillForm('billName')} />
          </label>
          <div className="row">
            <label>Category
              <select value={billForm.category} onChange={updateBillForm('category')}>
                {BILL_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
            </label>
            <label>Type
              <select value={billForm.billType} onChange={updateBillForm('billType')}>
                <option value="one_time">One-time</option>
                <option value="recurring">Recurring</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>Amount
              <input type="number" step="0.01" required value={billForm.amount} onChange={updateBillForm('amount')} />
            </label>
            <label>Due date
              <input type="date" required value={billForm.dueDate} onChange={updateBillForm('dueDate')} />
            </label>
          </div>
          {billForm.billType === 'recurring' && (
            <div className="row">
              <label>Frequency
                <select value={billForm.recurrenceUnit} onChange={updateBillForm('recurrenceUnit')}>
                  {RECURRENCE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                </select>
              </label>
              <label>Repeat every
                <input type="number" min="1" step="1" value={billForm.recurrenceCount} onChange={updateBillForm('recurrenceCount')} />
              </label>
            </div>
          )}
          <label>Notes
            <input value={billForm.notes} onChange={updateBillForm('notes')} />
          </label>
          <div className="row">
            <button type="submit">{editingId ? 'Update bill' : 'Add bill'}</button>
            {editingId && <button type="button" onClick={cancelEdit}>Cancel edit</button>}
          </div>
        </form>

        {payForm.billId ? (
          <form className="card" onSubmit={submitPayment}>
            <h2>Mark bill as paid</h2>
            <p className="muted">Recording payment for {selectedBill?.bill_name || 'selected bill'}.</p>
            <div className="row">
              <label>Payment date
                <input type="date" required value={payForm.paymentDate} onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })} />
              </label>
              <label>Amount
                <input type="number" step="0.01" required value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              </label>
            </div>
            <label>Notes
              <input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
            </label>
            <div className="row">
              <button type="submit">Save payment</button>
              <button type="button" onClick={cancelPay}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="card">
            <h2>Bill payment</h2>
            <p className="muted">Choose a bill below to record a payment date.</p>
          </div>
        )}
      </div>

      <div className="card">
        <h2>All bills</h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Category</th><th>Type</th><th>Due date</th><th>Amount</th><th>Status</th><th>Last paid</th><th></th></tr>
          </thead>
          <tbody>
            {bills.map((bill) => (
              <tr key={bill.id}>
                <td>{bill.bill_name}</td>
                <td>{categoryLabel(bill.category)}</td>
                <td>{bill.bill_type === 'recurring' ? 'Recurring' : 'One-time'}</td>
                <td>{bill.due_date}</td>
                <td>{formatMoney(bill.amount)}</td>
                <td>{bill.status}</td>
                <td>{bill.last_payment_date || '—'}</td>
                <td>
                  <button type="button" onClick={() => startPay(bill)}>Pay</button>{' '}
                  <button type="button" onClick={() => startEdit(bill)}>Edit</button>{' '}
                  <button type="button" onClick={() => removeBill(bill.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {bills.length === 0 && (
              <tr><td colSpan="8" className="muted">No bills entered yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
