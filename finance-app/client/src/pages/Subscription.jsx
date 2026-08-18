import { useEffect, useState } from 'react';
import api from '../api/client';
import { formatMoney } from '../utils/format';

export default function Subscription() {
  const [customerType, setCustomerType] = useState('personal');
  const [plans, setPlans] = useState([]);
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = () => {
    api.get('/subscriptions/plans').then((res) => {
      setCustomerType(res.data.customerType);
      setPlans(res.data.plans);
    });
    api.get('/subscriptions/current').then((res) => setCurrent(res.data.plan));
  };
  useEffect(() => { load(); }, []);

  const selectPlan = async (planId) => {
    setError(''); setMessage('');
    try {
      const res = await api.post('/subscriptions/select', { planId });
      setCurrent(res.data.plan);
      setMessage(`You are now subscribed to the ${res.data.plan.name} plan.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to select plan');
    }
  };

  return (
    <div>
      <h1>Subscription</h1>
      <p className="muted">
        Plans shown below are for {customerType === 'business' ? 'business' : 'personal'} accounts.
        Change your account type on the Profile page to see different plans.
      </p>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      {current && (
        <div className="card">
          <h2>Current plan</h2>
          <p><strong>{current.name}</strong> — {formatMoney(current.monthly_price)}/month or {formatMoney(current.yearly_price)}/year</p>
        </div>
      )}

      <div className="card">
        <h2>Available plans</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {plans.map((p) => (
            <div key={p.id} className="stat-card" style={{ minWidth: '220px' }}>
              <div className="stat-label">{p.name}</div>
              <div className="stat-value">{formatMoney(p.monthly_price)}/mo</div>
              <p className="muted">{formatMoney(p.yearly_price)}/year</p>
              <p>{p.description}</p>
              <button disabled={current?.id === p.id} onClick={() => selectPlan(p.id)}>
                {current?.id === p.id ? 'Current plan' : 'Choose plan'}
              </button>
            </div>
          ))}
          {plans.length === 0 && <p className="muted">No plans available yet.</p>}
        </div>
      </div>
    </div>
  );
}
