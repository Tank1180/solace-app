import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { formatMoney } from '../utils/format';

const emptyForm = {
  payDate: '', employer: '', grossPay: '', federalTax: '', stateTax: '',
  socialSecurity: '', medicare: '', benefitsDeduction: '', retirementContribution: '',
  ownerType: 'self',
};

export default function Paychecks() {
  const [paychecks, setPaychecks] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => api.get('/paychecks').then((res) => setPaychecks(res.data.paychecks));
  useEffect(() => { load(); }, []);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const startEdit = (paycheck) => {
    setEditingId(paycheck.id);
    setForm({
      payDate: paycheck.pay_date || '',
      employer: paycheck.employer || '',
      grossPay: paycheck.gross_pay ?? '',
      federalTax: paycheck.federal_tax ?? '',
      stateTax: paycheck.state_tax ?? '',
      socialSecurity: paycheck.social_security ?? '',
      medicare: paycheck.medicare ?? '',
      benefitsDeduction: paycheck.benefits_deduction ?? '',
      retirementContribution: paycheck.retirement_contribution ?? '',
      ownerType: paycheck.owner_type || 'self',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...form };
      for (const key of Object.keys(payload)) {
        if (key !== 'payDate' && key !== 'employer' && key !== 'ownerType') payload[key] = Number(payload[key] || 0);
      }

      const res = editingId
        ? await api.put(`/paychecks/${editingId}`, payload)
        : await api.post('/paychecks', payload);

      setForm(emptyForm);
      setEditingId(null);
      load();
      if (Number(payload.retirementContribution || 0) > 0) {
        navigate(`/investments?paycheckId=${res.data.paycheck.id}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save paycheck');
    }
  };

  const remove = async (id) => {
    await api.delete(`/paychecks/${id}`);
    load();
  };

  return (
    <div>
      <h1>Paychecks</h1>
      {error && <div className="error">{error}</div>}

      <form className="card" onSubmit={onSubmit}>
        <h2>{editingId ? 'Edit paycheck' : 'Add paycheck'}</h2>
        <div className="row">
          <label>Pay date
            <input type="date" required value={form.payDate} onChange={update('payDate')} />
          </label>
          <label>Employer
            <input value={form.employer} onChange={update('employer')} />
          </label>
          <label>For
            <select value={form.ownerType} onChange={update('ownerType')}>
              <option value="self">My paycheck</option>
              <option value="spouse">Spouse paycheck</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label>Gross pay
            <input type="number" step="0.01" required value={form.grossPay} onChange={update('grossPay')} />
          </label>
          <label>Federal tax
            <input type="number" step="0.01" value={form.federalTax} onChange={update('federalTax')} />
          </label>
          <label>State tax
            <input type="number" step="0.01" value={form.stateTax} onChange={update('stateTax')} />
          </label>
        </div>
        <div className="row">
          <label>Social security
            <input type="number" step="0.01" value={form.socialSecurity} onChange={update('socialSecurity')} />
          </label>
          <label>Medicare
            <input type="number" step="0.01" value={form.medicare} onChange={update('medicare')} />
          </label>
        </div>
        <div className="row">
          <label>Benefits deduction
            <input type="number" step="0.01" value={form.benefitsDeduction} onChange={update('benefitsDeduction')} />
          </label>
          <label>Retirement contribution
            <input type="number" step="0.01" value={form.retirementContribution} onChange={update('retirementContribution')} />
          </label>
        </div>
        {Number(form.retirementContribution || 0) > 0 && (
          <p className="muted">After saving, you will be taken to Investments to allocate this retirement contribution.</p>
        )}
        <div className="row">
          <button type="submit">{editingId ? 'Update paycheck' : 'Add paycheck'}</button>
          {editingId && <button type="button" onClick={cancelEdit}>Cancel edit</button>}
        </div>
      </form>

      <div className="card">
        <h2>History</h2>
        <table>
          <thead>
            <tr><th>Date</th><th>For</th><th>Employer</th><th>Gross</th><th>Net</th><th></th></tr>
          </thead>
          <tbody>
            {paychecks.map((p) => (
              <tr key={p.id}>
                <td>{p.pay_date}</td>
                <td>{p.owner_type === 'spouse' ? 'Spouse' : 'Me'}</td>
                <td>{p.employer}</td>
                <td>{formatMoney(p.gross_pay)}</td>
                <td>{formatMoney(p.net_pay)}</td>
                <td>
                  <button type="button" onClick={() => startEdit(p)}>Edit</button>{' '}
                  <button type="button" onClick={() => remove(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
