import { useCallback, useEffect, useState } from 'react';
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

const RECURRENCE_END_TYPES = [
  { value: 'billing_cycles', label: 'Number of billing cycles' },
  { value: 'until_date', label: 'Until this date' },
  { value: 'until_stopped', label: 'Until stopped' },
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
  recurrenceCount: 12,
  recurrenceEndType: 'until_stopped',
  recurrenceEndDate: '',
  notes: '',
};

export default function Bills() {
  const [month, setMonth] = useState(currentMonth);
  const [bills, setBills] = useState([]);
  const [upcomingWindows, setUpcomingWindows] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [billForm, setBillForm] = useState(emptyBillForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

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
          recurrenceCount: value === 'recurring' ? current.recurrenceCount : 12,
          recurrenceEndType: value === 'recurring' ? current.recurrenceEndType : 'until_stopped',
          recurrenceEndDate: value === 'recurring' ? current.recurrenceEndDate : '',
        };
      }
      if (field === 'recurrenceEndType') {
        return {
          ...current,
          recurrenceEndType: value,
          recurrenceEndDate: value === 'until_date' ? current.recurrenceEndDate : '',
          recurrenceCount: value === 'billing_cycles' ? current.recurrenceCount || 12 : current.recurrenceCount,
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
      recurrenceCount: bill.recurrence_count || 12,
      recurrenceEndType: bill.recurrence_end_type || (bill.bill_type === 'recurring' ? 'until_stopped' : 'until_stopped'),
      recurrenceEndDate: bill.recurrence_end_date || '',
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
        recurrenceCount: Number(billForm.recurrenceCount || 0),
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

  const removeBill = async (id) => {
    setError('');
    setMessage('');
    try {
      await api.delete(`/bills/${id}`);
      setMessage('Bill deleted.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete bill');
    }
  };

  const categoryLabel = (value) => BILL_CATEGORIES.find((c) => c.value === value)?.label || value;

  return (
    <div>
      <h1>Bills</h1>
      <p className="muted">Track scheduled obligations separately from discretionary spending so your cash flow reflects upcoming bills automatically.</p>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <div className="row" style={{ alignItems: 'end' }}>
        <label>Summary month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

      {monthlySummary && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-label">Bills due this month</div><div className="stat-value">{formatMoney(monthlySummary.scheduledBills)}</div></div>
          <div className="stat-card"><div className="stat-label">Discretionary spending</div><div className="stat-value">{formatMoney(monthlySummary.discretionarySpending)}</div></div>
          <div className="stat-card"><div className="stat-label">Current cash flow</div><div className="stat-value">{formatMoney(monthlySummary.currentCashFlow)}</div></div>
          <div className="stat-card"><div className="stat-label">Projected balance (30d)</div><div className="stat-value">{formatMoney(monthlySummary.projectedBalance30)}</div></div>
          <div className="stat-card"><div className="stat-label">Projected balance (60d)</div><div className="stat-value">{formatMoney(monthlySummary.projectedBalance60)}</div></div>
        </div>
      )}

      <div className="card">
        <h2>Upcoming obligations</h2>
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
            <tr><th>Due date</th><th>Bill</th><th>Category</th><th>Schedule</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {upcomingWindows.find((window) => window.days === 30)?.bills?.map((bill, index) => (
              <tr key={`${bill.id}-${bill.scheduled_date}-${index}`}>
                <td>{bill.scheduled_date}</td>
                <td>{bill.bill_name}</td>
                <td>{categoryLabel(bill.category)}</td>
                <td>{bill.recurrence_label}</td>
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
          <label>{billForm.billType === 'recurring' ? 'First due date' : 'Due date'}
            <input type="date" required value={billForm.dueDate} onChange={updateBillForm('dueDate')} />
          </label>
        </div>
        {billForm.billType === 'recurring' && (
          <>
            <div className="row">
              <label>Frequency
                <select value={billForm.recurrenceUnit} onChange={updateBillForm('recurrenceUnit')}>
                  {RECURRENCE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                </select>
              </label>
              <label>Repeat until
                <select value={billForm.recurrenceEndType} onChange={updateBillForm('recurrenceEndType')}>
                  {RECURRENCE_END_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            {billForm.recurrenceEndType === 'billing_cycles' && (
              <label>Number of billing cycles
                <input type="number" min="1" step="1" value={billForm.recurrenceCount} onChange={updateBillForm('recurrenceCount')} />
              </label>
            )}
            {billForm.recurrenceEndType === 'until_date' && (
              <label>Until this date
                <input type="date" required value={billForm.recurrenceEndDate} onChange={updateBillForm('recurrenceEndDate')} />
              </label>
            )}
          </>
        )}
        <label>Notes
          <input value={billForm.notes} onChange={updateBillForm('notes')} />
        </label>
        <div className="row">
          <button type="submit">{editingId ? 'Update bill' : 'Add bill'}</button>
          {editingId && <button type="button" onClick={cancelEdit}>Cancel edit</button>}
        </div>
      </form>

      <div className="card">
        <h2>All bills</h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Category</th><th>Type</th><th>Schedule</th><th>Next due</th><th>Amount</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {bills.map((bill) => (
              <tr key={bill.id}>
                <td>{bill.bill_name}</td>
                <td>{categoryLabel(bill.category)}</td>
                <td>{bill.bill_type === 'recurring' ? 'Recurring' : 'One-time'}</td>
                <td>{bill.recurrence_label}</td>
                <td>{bill.next_due_date || bill.due_date}</td>
                <td>{formatMoney(bill.amount)}</td>
                <td>{bill.notes || '—'}</td>
                <td>
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
