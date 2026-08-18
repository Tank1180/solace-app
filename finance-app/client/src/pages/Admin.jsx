import { useEffect, useState } from 'react';
import api from '../api/client';

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');

  const load = () => {
    api.get('/admin/stats').then((res) => setStats(res.data)).catch((err) => setError(err.response?.data?.error || 'Failed to load'));
    api.get('/admin/users').then((res) => setUsers(res.data.users));
  };
  useEffect(() => { load(); }, []);

  const setStatus = async (id, status) => {
    await api.put(`/admin/users/${id}/status`, { status });
    load();
  };

  return (
    <div>
      <h1>Admin Dashboard</h1>
      {error && <div className="error">{error}</div>}

      {stats && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-label">Total users</div><div className="stat-value">{stats.totalUsers}</div></div>
          <div className="stat-card"><div className="stat-label">Active users</div><div className="stat-value">{stats.activeUsers}</div></div>
          <div className="stat-card"><div className="stat-label">Suspended users</div><div className="stat-value">{stats.suspendedUsers}</div></div>
          <div className="stat-card"><div className="stat-label">Total transactions</div><div className="stat-value">{stats.totalTransactions}</div></div>
          <div className="stat-card"><div className="stat-label">Total transaction volume</div><div className="stat-value">${Number(stats.totalTransactionVolume).toFixed(2)}</div></div>
          {stats.byCustomerType?.map((c) => (
            <div className="stat-card" key={c.customer_type}>
              <div className="stat-label">{c.customer_type === 'business' ? 'Business customers' : 'Personal customers'}</div>
              <div className="stat-value">{c.c}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Users</h2>
        <table>
          <thead>
            <tr><th>Email</th><th>Name</th><th>Customer type</th><th>Account type</th><th>Status</th><th>Joined</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.first_name} {u.last_name}</td>
                <td>{u.customer_type}</td>
                <td>{u.account_type}</td>
                <td>{u.status}</td>
                <td>{u.created_at}</td>
                <td>
                  {u.status === 'active'
                    ? <button onClick={() => setStatus(u.id, 'suspended')}>Suspend</button>
                    : <button onClick={() => setStatus(u.id, 'active')}>Reactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
