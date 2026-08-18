import { useEffect, useState } from 'react';
import api from '../api/client';
import { formatMoney } from '../utils/format';

const emptyForm = { name: '', customerType: 'personal', monthlyPrice: '', yearlyPrice: '', description: '' };

export default function AdminSubscriptions() {
  const [plans, setPlans] = useState([]);
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const load = () => {
    api.get('/admin/subscriptions/plans').then((res) => setPlans(res.data.plans));
    api.get('/admin/subscriptions/overview').then((res) => setOverview(res.data));
  };
  useEffect(() => { load(); }, []);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const createPlan = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/admin/subscriptions/plans', form);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create plan');
    }
  };

  const toggleActive = async (plan) => {
    await api.put(`/admin/subscriptions/plans/${plan.id}`, { isActive: !plan.is_active });
    load();
  };

  const updatePrice = async (plan, field, value) => {
    await api.put(`/admin/subscriptions/plans/${plan.id}`, { [field]: Number(value || 0) });
    load();
  };

  const removePlan = async (id) => {
    if (!window.confirm('Delete this plan? Customers subscribed to it will need to be reassigned.')) return;
    await api.delete(`/admin/subscriptions/plans/${id}`);
    load();
  };

  return (
    <div>
      <h1>Subscription Plans</h1>
      {error && <div className="error">{error}</div>}

      {overview && (
        <div className="card">
          <h2>Subscribers by plan</h2>
          <table>
            <thead><tr><th>Plan</th><th>Customer type</th><th>Monthly price</th><th>Subscribers</th></tr></thead>
            <tbody>
              {overview.byPlan.map((p) => (
                <tr key={p.plan_id}>
                  <td>{p.name}</td>
                  <td>{p.customer_type}</td>
                  <td>{formatMoney(p.monthly_price)}</td>
                  <td>{p.subscriber_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {overview.unassigned.length > 0 && (
            <p className="muted">
              Not yet on a plan: {overview.unassigned.map((u) => `${u.c} ${u.customer_type}`).join(', ')}
            </p>
          )}
        </div>
      )}

      <form className="card" onSubmit={createPlan}>
        <h2>Add plan</h2>
        <div className="row">
          <label>Name<input required value={form.name} onChange={update('name')} /></label>
          <label>Customer type
            <select value={form.customerType} onChange={update('customerType')}>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label>Monthly price<input type="number" step="0.01" required value={form.monthlyPrice} onChange={update('monthlyPrice')} /></label>
          <label>Yearly price<input type="number" step="0.01" required value={form.yearlyPrice} onChange={update('yearlyPrice')} /></label>
        </div>
        <label>Description<input value={form.description} onChange={update('description')} /></label>
        <button type="submit">Add plan</button>
      </form>

      <div className="card">
        <h2>All plans</h2>
        <table>
          <thead><tr><th>Name</th><th>Customer type</th><th>Monthly</th><th>Yearly</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.customer_type}</td>
                <td>
                  <input type="number" step="0.01" defaultValue={p.monthly_price}
                    onBlur={(e) => updatePrice(p, 'monthlyPrice', e.target.value)} style={{ width: '90px' }} />
                </td>
                <td>
                  <input type="number" step="0.01" defaultValue={p.yearly_price}
                    onBlur={(e) => updatePrice(p, 'yearlyPrice', e.target.value)} style={{ width: '90px' }} />
                </td>
                <td>{p.is_active ? 'Yes' : 'No'}</td>
                <td>
                  <button onClick={() => toggleActive(p)}>{p.is_active ? 'Deactivate' : 'Activate'}</button>{' '}
                  <button onClick={() => removePlan(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
