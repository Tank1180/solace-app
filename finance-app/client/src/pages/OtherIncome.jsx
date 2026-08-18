import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { formatMoney } from '../utils/format';

const emptyForm = {
  incomeDate: '', incomeGroup: '', category: '', description: '', amount: '',
  isTaxable: null, isSelfEmployment: null,
};

export default function OtherIncome() {
  const [groups, setGroups] = useState({});
  const [income, setIncome] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const load = () => api.get('/other-income').then((res) => setIncome(res.data.income));

  useEffect(() => {
    api.get('/other-income/categories').then((res) => setGroups(res.data.groups));
    load();
  }, []);

  const categoriesForGroup = useMemo(() => {
    const g = groups[form.incomeGroup];
    return g ? g.categories : [];
  }, [groups, form.incomeGroup]);

  const selectedCategoryMeta = useMemo(
    () => categoriesForGroup.find((c) => c.value === form.category) || null,
    [categoriesForGroup, form.category]
  );

  const update = (field) => (e) => {
    const value = e.target.value;
    if (field === 'incomeGroup') {
      setForm({ ...form, incomeGroup: value, category: '', isTaxable: null, isSelfEmployment: null });
    } else {
      setForm({ ...form, [field]: value });
    }
  };

  const onCategoryChange = (e) => {
    const value = e.target.value;
    const meta = categoriesForGroup.find((c) => c.value === value);
    setForm({ ...form, category: value, isTaxable: meta ? meta.taxable : null, isSelfEmployment: meta?.selfEmployment ? true : false });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.incomeDate || !form.incomeGroup || !form.category || form.amount === '') {
      setError('Date, income group, category, and amount are required');
      return;
    }
    try {
      await api.post('/other-income', {
        incomeDate: form.incomeDate,
        incomeGroup: form.incomeGroup,
        category: form.category,
        description: form.description,
        amount: Number(form.amount || 0),
        isTaxable: form.isTaxable,
        isSelfEmployment: form.isSelfEmployment,
      });
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save income entry');
    }
  };

  const remove = async (id) => {
    await api.delete(`/other-income/${id}`);
    load();
  };

  const categoryLabel = (groupKey, categoryKey) => {
    const g = groups[groupKey];
    const c = g?.categories.find((cat) => cat.value === categoryKey);
    return c ? c.label : categoryKey;
  };

  const totalAmount = income.reduce((s, i) => s + i.amount, 0);
  const taxableAmount = income.filter((i) => i.is_taxable).reduce((s, i) => s + i.amount, 0);

  return (
    <div>
      <h1>Other Income</h1>
      <p className="muted">Track income you receive outside of your regular paycheck: gifts, winnings, rental income, side hustles, gig work, government payments, crypto, and more.</p>
      {error && <div className="error">{error}</div>}

      <div className="stats-grid" style={{ marginBottom: '1rem' }}>
        <div className="stat-card">
          <div className="stat-label">Total other income</div>
          <div className="stat-value">{formatMoney(totalAmount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Taxable other income</div>
          <div className="stat-value">{formatMoney(taxableAmount)}</div>
        </div>
      </div>

      <form className="card" onSubmit={onSubmit}>
        <h2>Add income entry</h2>
        <div className="row">
          <label>Date
            <input type="date" required value={form.incomeDate} onChange={update('incomeDate')} />
          </label>
          <label>Income group
            <select required value={form.incomeGroup} onChange={update('incomeGroup')}>
              <option value="">Select a group…</option>
              {Object.entries(groups).map(([key, g]) => (
                <option key={key} value={key}>{g.label}</option>
              ))}
            </select>
          </label>
          <label>Category
            <select required value={form.category} onChange={onCategoryChange} disabled={!form.incomeGroup}>
              <option value="">Select a category…</option>
              {categoriesForGroup.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label>Description
            <input value={form.description} onChange={update('description')} placeholder="Optional notes" />
          </label>
          <label>Amount
            <input type="number" step="0.01" required value={form.amount} onChange={update('amount')} />
          </label>
        </div>
        {form.category && (
          <div className="row">
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={!!form.isTaxable} onChange={(e) => setForm({ ...form, isTaxable: e.target.checked })} />
              Taxable income
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={!!form.isSelfEmployment} onChange={(e) => setForm({ ...form, isSelfEmployment: e.target.checked })} />
              Counts as self-employment income
            </label>
          </div>
        )}
        {selectedCategoryMeta && (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Default for "{selectedCategoryMeta.label}": {selectedCategoryMeta.taxable ? 'taxable' : 'not taxable'}
            {selectedCategoryMeta.selfEmployment ? ', counts toward self-employment tax' : ''}. You can override above.
          </p>
        )}
        <button type="submit">Add income entry</button>
      </form>

      <div className="card">
        <h2>History</h2>
        <table>
          <thead>
            <tr><th>Date</th><th>Group</th><th>Category</th><th>Description</th><th>Amount</th><th>Taxable</th><th>Self-employment</th><th></th></tr>
          </thead>
          <tbody>
            {income.map((i) => (
              <tr key={i.id}>
                <td>{i.income_date}</td>
                <td>{groups[i.income_group]?.label || i.income_group}</td>
                <td>{categoryLabel(i.income_group, i.category)}</td>
                <td>{i.description}</td>
                <td>{formatMoney(i.amount)}</td>
                <td>{i.is_taxable ? 'Yes' : 'No'}</td>
                <td>{i.is_self_employment ? 'Yes' : 'No'}</td>
                <td><button onClick={() => remove(i.id)}>Delete</button></td>
              </tr>
            ))}
            {income.length === 0 && (
              <tr><td colSpan="8" className="muted">No other income entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
