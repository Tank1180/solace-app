import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await login(email, password);
      navigate(user.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
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
        <h1>Log in</h1>
        {error && <div className="error">{error}</div>}
        <label>Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="password-field">
          <label className="password-label">Password
            <input type={showPassword ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="button" className="secondary small password-toggle" onClick={() => setShowPassword((current) => !current)}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="auth-links">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <button type="submit" disabled={submitting}>{submitting ? 'Logging in…' : 'Log in'}</button>
        <p>Need an account? <Link to="/signup">Sign up</Link></p>
      </form>
    </div>
  );
}
