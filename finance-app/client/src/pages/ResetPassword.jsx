import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const token = searchParams.get('token') || '';

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!token) {
      setError('Missing reset token. Please use the link from your email.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      const { data } = await api.post('/auth/reset-password', { token, password });
      setSuccess(data.message || 'Your password has been reset successfully.');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset your password.');
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
        <h1>Create a new password</h1>
        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}
        <label>New password
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>Confirm password
          <input type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={submitting}>{submitting ? 'Updating…' : 'Reset password'}</button>
        <p><Link to="/login">Back to login</Link></p>
      </form>
    </div>
  );
}
