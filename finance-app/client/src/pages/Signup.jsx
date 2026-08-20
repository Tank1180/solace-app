import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function getSignupErrorMessage(err) {
  const apiMessage = err.response?.data?.error;
  if (apiMessage) {
    return apiMessage;
  }

  if (err.response?.status === 500) {
    return 'The server could not finish creating your account. Please try again shortly. If this keeps happening, the database setup may still need attention.';
  }

  if (err.code === 'ERR_NETWORK') {
    return 'The signup service could not be reached. Check your connection and try again.';
  }

  return err.message || 'Signup failed';
}

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    accountType: 'individual',
    businessName: '',
    customerType: 'personal',
  });

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.customerType === 'business' && !form.businessName.trim()) {
      setError('Business name is required for business accounts');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        customerType: form.customerType,
        accountType: form.accountType,
        businessName: form.customerType === 'business' ? form.businessName.trim() : '',
      };
      await signup(payload);
      navigate('/dashboard');
    } catch (err) {
      setError(getSignupErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <img src="/solace-logo.png" alt="Solace" className="auth-brand-logo" />
        </div>
        <div className="auth-links auth-links-left">
          <Link to="/">Back to home</Link>
        </div>
        <h1>Create your account</h1>
        <p className="muted">Start with the basics. You can add profile details, tax info, and financial accounts after signup.</p>
        {error && <div className="error">{error}</div>}

        <fieldset>
          <legend>Login credentials</legend>
          <label>Email
            <input type="email" required value={form.email} onChange={update('email')} />
          </label>
          <label>Password
            <input type="password" required minLength={8} value={form.password} onChange={update('password')} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Basic profile</legend>
          <div className="row">
            <label>First name
              <input value={form.firstName} onChange={update('firstName')} />
            </label>
            <label>Last name
              <input value={form.lastName} onChange={update('lastName')} />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Account type</legend>
          <label>Is this account for personal or business use?
            <select
              value={form.customerType}
              onChange={(e) => setForm({
                ...form,
                customerType: e.target.value,
                accountType: e.target.value === 'personal' ? 'individual' : 'sole_proprietor',
              })}
            >
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
              <label>Business name
                <input required value={form.businessName} onChange={update('businessName')} />
              </label>
            </>
          )}
        </fieldset>

        <button type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
        <p>Already have an account? <Link to="/login">Log in</Link></p>
      </form>
    </div>
  );
}
