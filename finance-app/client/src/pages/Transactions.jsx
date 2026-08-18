import { useEffect, useState } from 'react';
import api from '../api/client';
import { formatMoney } from '../utils/format';

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [rules, setRules] = useState([]);
  const [selected, setSelected] = useState([]);
  const [filterForm, setFilterForm] = useState({
    startDate: '',
    endDate: '',
    categoryId: '',
    paymentMethod: '',
    source: '',
    search: '',
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({ txnDate: '', description: '', amount: '', paymentMethod: 'cash', categoryId: '' });
  const [ruleForm, setRuleForm] = useState({ matchText: '', categoryId: '' });
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [file, setFile] = useState(null);

  const load = (filters = filterForm) => {
    api.get('/transactions', { params: filters }).then((res) => setTransactions(res.data.transactions));
    api.get('/categories').then((res) => setCategories(res.data.categories));
    api.get('/categories/rules').then((res) => setRules(res.data.rules));
  };
  useEffect(() => { load(); }, [filterForm]);

  const updateForm = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const updateFilterForm = (field) => (e) => setFilterForm({ ...filterForm, [field]: e.target.value });

  const applyFilters = () => {
    load({
      startDate: filterForm.startDate || undefined,
      endDate: filterForm.endDate || undefined,
      categoryId: filterForm.categoryId || undefined,
      paymentMethod: filterForm.paymentMethod || undefined,
      source: filterForm.source || undefined,
      search: filterForm.search || undefined,
    });
  };

  const clearFilters = () => {
    const empty = { startDate: '', endDate: '', categoryId: '', paymentMethod: '', source: '', search: '' };
    setFilterForm(empty);
    load({});
  };

  const downloadReport = async (format) => {
    setError('');
    setMessage('');
    try {
      const res = await api.get('/transactions/report', {
        params: { ...filterForm, format },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: format === 'json' ? 'application/json' : 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `transactions-report.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to download transactions report');
    }
  };

  const addTransaction = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/transactions', { ...form, amount: Number(form.amount), categoryId: form.categoryId || null });
      setForm({ txnDate: '', description: '', amount: '', paymentMethod: 'cash', categoryId: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add transaction');
    }
  };

  const removeTransaction = async (id) => {
    await api.delete(`/transactions/${id}`);
    load();
  };

  const toggleSelected = (id) => {
    setSelected((sel) => (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]));
  };

  const applyBulkCategory = async () => {
    if (selected.length === 0 || !bulkCategoryId) return;
    await api.put('/transactions', { ids: selected, categoryId: Number(bulkCategoryId) });
    setSelected([]);
    setBulkCategoryId('');
    load();
  };

  const addRule = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/categories/rules', { matchText: ruleForm.matchText, categoryId: Number(ruleForm.categoryId) });
      setRuleForm({ matchText: '', categoryId: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add rule');
    }
  };

  const removeRule = async (id) => {
    await api.delete(`/categories/rules/${id}`);
    load();
  };

  const importCsv = async (e) => {
    e.preventDefault();
    if (!file) return;
    setError('');
    setMessage('');
    const data = new FormData();
    data.append('file', file);
    try {
      const res = await api.post('/transactions/import', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMessage(`Imported ${res.data.imported} of ${res.data.rowsInFile} rows from CSV.`);
      setFile(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'CSV import failed');
    }
  };

  return (
    <div>
      <h1>Spending</h1>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <div className="card">
        <h2>Filter transactions</h2>
        <div className="row">
          <label>Start date
            <input type="date" value={filterForm.startDate} onChange={updateFilterForm('startDate')} />
          </label>
          <label>End date
            <input type="date" value={filterForm.endDate} onChange={updateFilterForm('endDate')} />
          </label>
          <label>Category
            <select value={filterForm.categoryId} onChange={updateFilterForm('categoryId')}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label>Payment method
            <select value={filterForm.paymentMethod} onChange={updateFilterForm('paymentMethod')}>
              <option value="">All methods</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="credit_card">Credit card</option>
            </select>
          </label>
          <label>Source
            <select value={filterForm.source} onChange={updateFilterForm('source')}>
              <option value="">All sources</option>
              <option value="manual">Manual</option>
              <option value="csv_import">CSV import</option>
            </select>
          </label>
          <label>Search
            <input value={filterForm.search} onChange={updateFilterForm('search')} placeholder="Description or date" />
          </label>
        </div>
        <div className="row">
          <button type="button" onClick={applyFilters}>Apply filters</button>
          <button type="button" onClick={clearFilters}>Clear filters</button>
          <button type="button" onClick={() => downloadReport('csv')}>Download CSV report</button>
          <button type="button" onClick={() => downloadReport('json')}>Download JSON report</button>
        </div>
      </div>

      <div className="row-cards">
        <form className="card" onSubmit={addTransaction}>
          <h2>Add transaction</h2>
          <label>Date
            <input type="date" required value={form.txnDate} onChange={updateForm('txnDate')} />
          </label>
          <label>Description
            <input value={form.description} onChange={updateForm('description')} />
          </label>
          <label>Amount
            <input type="number" step="0.01" required value={form.amount} onChange={updateForm('amount')} />
          </label>
          <label>Payment method
            <select value={form.paymentMethod} onChange={updateForm('paymentMethod')}>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="credit_card">Credit card</option>
            </select>
          </label>
          <label>Category
            <select value={form.categoryId} onChange={updateForm('categoryId')}>
              <option value="">Auto / Uncategorized</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button type="submit">Add transaction</button>
        </form>

        <form className="card" onSubmit={importCsv}>
          <h2>Import credit card CSV</h2>
          <p>Upload a monthly export from your credit card company (columns like Date, Description, Amount).</p>
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
          <button type="submit" disabled={!file}>Import CSV</button>
        </form>

        <form className="card" onSubmit={addRule}>
          <h2>Category rules</h2>
          <p>Automatically categorize future transactions containing this text.</p>
          <label>Match text
            <input value={ruleForm.matchText} onChange={(e) => setRuleForm({ ...ruleForm, matchText: e.target.value })} placeholder="e.g. Starbucks" />
          </label>
          <label>Category
            <select value={ruleForm.categoryId} onChange={(e) => setRuleForm({ ...ruleForm, categoryId: e.target.value })}>
              <option value="">Select category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!ruleForm.matchText || !ruleForm.categoryId}>Add rule</button>
          <ul className="rule-list">
            {rules.map((r) => (
              <li key={r.id}>
                "{r.match_text}" → {r.category_name} <button type="button" onClick={() => removeRule(r.id)}>Remove</button>
              </li>
            ))}
          </ul>
        </form>
      </div>

      <div className="card">
        <div className="bulk-bar">
          <h2>Transactions ({transactions.length})</h2>
          <div>
            <select value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)}>
              <option value="">Bulk set category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={applyBulkCategory} disabled={selected.length === 0 || !bulkCategoryId}>
              Apply to {selected.length} selected
            </button>
          </div>
        </div>
        <table>
          <thead>
            <tr><th></th><th>Date</th><th>Description</th><th>Amount</th><th>Method</th><th>Category</th><th>Source</th><th></th></tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td><input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggleSelected(t.id)} /></td>
                <td>{t.txn_date}</td>
                <td>{t.description}</td>
                <td>{formatMoney(t.amount)}</td>
                <td>{t.payment_method}</td>
                <td>{t.category_name || 'Uncategorized'}</td>
                <td>{t.source}</td>
                <td><button onClick={() => removeTransaction(t.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
