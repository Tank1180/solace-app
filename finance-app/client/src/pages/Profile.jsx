import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: user?.first_name || '', lastName: user?.last_name || '', dateOfBirth: user?.date_of_birth || '',
    phone: user?.phone || '', addressLine1: user?.address_line1 || '', addressLine2: user?.address_line2 || '',
    city: user?.city || '', state: user?.state || '', zip: user?.zip || '',
    accountType: user?.account_type || 'individual', businessName: user?.business_name || '',
    customerType: user?.customer_type || 'personal',
    spouseFirstName: user?.spouse_first_name || '', spouseLastName: user?.spouse_last_name || '',
    spouseDateOfBirth: user?.spouse_date_of_birth || '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [dependents, setDependents] = useState([]);
  const [dependentForm, setDependentForm] = useState({ firstName: '', lastName: '', dateOfBirth: '', relationship: 'child' });

  const loadDependents = () => api.get('/dependents').then((res) => setDependents(res.data.dependents));
  useEffect(() => { loadDependents(); }, []);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(''); setMessage('');
    try {
      await api.put('/auth/me', form);
      await refreshUser();
      setMessage('Profile updated.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update profile');
    }
  };

  const addDependent = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/dependents', dependentForm);
      setDependentForm({ firstName: '', lastName: '', dateOfBirth: '', relationship: 'child' });
      loadDependents();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add dependent');
    }
  };

  const removeDependent = async (id) => {
    await api.delete(`/dependents/${id}`);
    loadDependents();
  };

  const downloadExport = async (format) => {
    const res = await api.get(`/auth/me/export?format=${format}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `finance-export.${format}`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const deleteAccount = async () => {
    if (!window.confirm('This will permanently delete your account and all associated data. Continue?')) return;
    await api.delete('/auth/me');
    logout();
    navigate('/signup');
  };

  return (
    <div>
      <h1>Profile</h1>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <form className="card" onSubmit={onSubmit}>
        <h2>Demographic &amp; account information</h2>
        <div className="row">
          <label>First name<input value={form.firstName} onChange={update('firstName')} /></label>
          <label>Last name<input value={form.lastName} onChange={update('lastName')} /></label>
        </div>
        <div className="row">
          <label>Date of birth<input type="date" value={form.dateOfBirth} onChange={update('dateOfBirth')} /></label>
          <label>Phone<input value={form.phone} onChange={update('phone')} /></label>
        </div>
        <label>Address line 1<input value={form.addressLine1} onChange={update('addressLine1')} /></label>
        <label>Address line 2<input value={form.addressLine2} onChange={update('addressLine2')} /></label>
        <div className="row">
          <label>City<input value={form.city} onChange={update('city')} /></label>
          <label>State<input value={form.state} onChange={update('state')} /></label>
          <label>Zip<input value={form.zip} onChange={update('zip')} /></label>
        </div>
        <label>Is this account for personal or business use?
          <select value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value, accountType: e.target.value === 'personal' ? 'individual' : (form.accountType === 'individual' ? 'sole_proprietor' : form.accountType) })}>
            <option value="personal">Personal</option>
            <option value="business">Business</option>
          </select>
        </label>
        {form.customerType === 'business' && (
          <>
            <label>Business structure
              <select value={form.accountType} onChange={update('accountType')}>
                <option value="sole_proprietor">Sole Proprietor</option>
                <option value="partnership">Partnership</option>
                <option value="s_corp">S Corporation</option>
              </select>
            </label>
            <label>Business name<input value={form.businessName} onChange={update('businessName')} /></label>
          </>
        )}

        <h2>Spouse information <span className="muted" style={{ fontWeight: 'normal', fontSize: '0.85em' }}>(optional)</span></h2>
        <p className="muted">Only needed if you file taxes jointly with a spouse. Leave blank if it doesn't apply to you.</p>
        <div className="row">
          <label>Spouse first name<input value={form.spouseFirstName} onChange={update('spouseFirstName')} /></label>
          <label>Spouse last name<input value={form.spouseLastName} onChange={update('spouseLastName')} /></label>
        </div>
        <label>Spouse date of birth<input type="date" value={form.spouseDateOfBirth} onChange={update('spouseDateOfBirth')} /></label>

        <button type="submit">Save changes</button>
      </form>

      <div className="card">
        <h2>Dependents</h2>
        <p>Add dependents for tax filing purposes.</p>
        <form onSubmit={addDependent}>
          <div className="row">
            <label>First name<input required value={dependentForm.firstName} onChange={(e) => setDependentForm({ ...dependentForm, firstName: e.target.value })} /></label>
            <label>Last name<input value={dependentForm.lastName} onChange={(e) => setDependentForm({ ...dependentForm, lastName: e.target.value })} /></label>
          </div>
          <div className="row">
            <label>Date of birth<input type="date" value={dependentForm.dateOfBirth} onChange={(e) => setDependentForm({ ...dependentForm, dateOfBirth: e.target.value })} /></label>
            <label>Relationship
              <select value={dependentForm.relationship} onChange={(e) => setDependentForm({ ...dependentForm, relationship: e.target.value })}>
                <option value="child">Child</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <button type="submit">Add dependent</button>
        </form>
        {dependents.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Date of birth</th><th>Relationship</th><th></th></tr></thead>
            <tbody>
              {dependents.map((d) => (
                <tr key={d.id}>
                  <td>{d.first_name} {d.last_name}</td>
                  <td>{d.date_of_birth || '—'}</td>
                  <td>{d.relationship}</td>
                  <td><button onClick={() => removeDependent(d.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Your data</h2>
        <p>Download all of your financial data.</p>
        <button onClick={() => downloadExport('json')}>Download JSON</button>{' '}
        <button onClick={() => downloadExport('csv')}>Download CSV</button>
      </div>

      <div className="card danger-card">
        <h2>Danger zone</h2>
        <p>Deleting your account permanently removes all paychecks, transactions, and investment data.</p>
        <button className="danger" onClick={deleteAccount}>Delete my account</button>
      </div>
    </div>
  );
}
