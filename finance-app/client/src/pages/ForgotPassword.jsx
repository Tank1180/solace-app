import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetUrl, setResetUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setResetUrl('');
    setSubmitting(true);

    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setMessage(data.message || 'If an account exists for that email, a reset link has been sent.');
      if (data.resetUrl) setResetUrl(data.resetUrl);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to send a reset link right now.');
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
        <h1>Reset password</h1>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        {resetUrl && (
          <div className="success">
            Demo reset link: <a href={resetUrl}>{resetUrl}</a>
          </div>
        )}
        <label>Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send reset link'}</button>
        <p><Link to="/login">Back to login</Link></p>
      </form>
    </div>
  );
}
