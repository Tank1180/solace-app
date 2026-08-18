import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const emptyHolding = { symbol: '', shares: '', price: '' };
const emptyAccount = { accountName: '', accountType: 'brokerage', institution: '', currentBalance: '', holdings: [ { ...emptyHolding } ] };

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    email: '', password: '', firstName: '', lastName: '', dateOfBirth: '', phone: '',
    addressLine1: '', addressLine2: '', city: '', state: '', zip: '',
    accountType: 'individual', businessName: '',
    customerType: 'personal',
    spouseFirstName: '', spouseLastName: '', spouseDateOfBirth: '',
  });
  const [initialAccounts, setInitialAccounts] = useState([{ ...emptyAccount }]);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const addInitialAccount = () => setInitialAccounts((current) => [...current, { ...emptyAccount, holdings: [{ ...emptyHolding }] }]);
  const removeInitialAccount = (index) => setInitialAccounts((current) => current.filter((_, itemIndex) => itemIndex !== index));

  const updateInitialAccount = (index, field) => (e) => {
    setInitialAccounts((current) => current.map((account, itemIndex) => itemIndex === index ? { ...account, [field]: e.target.value } : account));
  };

  const updateHolding = (accountIndex, holdingIndex, field) => (e) => {
    setInitialAccounts((current) => current.map((account, itemIdx) => {
      if (itemIdx !== accountIndex) return account;
      return {
        ...account,
        holdings: account.holdings.map((holding, holdIdx) => holdIdx === holdingIndex ? { ...holding, [field]: e.target.value } : holding),
      };
    }));
  };

  const addHolding = (accountIndex) => {
    setInitialAccounts((current) => current.map((account, itemIndex) => itemIndex === accountIndex ? { ...account, holdings: [...account.holdings, { ...emptyHolding }] } : account));
  };

  const removeHolding = (accountIndex, holdingIndex) => {
    setInitialAccounts((current) => current.map((account, itemIndex) => {
      if (itemIndex !== accountIndex) return account;
      const nextHoldings = account.holdings.filter((_, idx) => idx !== holdingIndex);
      return { ...account, holdings: nextHoldings.length ? nextHoldings : [{ ...emptyHolding }] };
    }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        initialAccounts: initialAccounts
          .filter((account) => account.accountName || account.institution || account.currentBalance || account.holdings.some((holding) => holding.symbol || holding.shares || holding.price))
          .map((account) => ({
            ...account,
            currentBalance: account.currentBalance === '' ? 0 : Number(account.currentBalance),
            holdings: account.holdings.map((holding) => ({
              symbol: holding.symbol,
              shares: holding.shares === '' ? 0 : Number(holding.shares),
              price: holding.price === '' ? 0 : Number(holding.price),
            })).filter((holding) => holding.symbol || holding.shares || holding.price),
          })),
      };
      await signup(payload);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed');
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
        <h1>Create your account</h1>
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
          <legend>Demographic information</legend>
          <div className="row">
            <label>First name
              <input value={form.firstName} onChange={update('firstName')} />
            </label>
            <label>Last name
              <input value={form.lastName} onChange={update('lastName')} />
            </label>
          </div>
          <div className="row">
            <label>Date of birth
              <input type="date" value={form.dateOfBirth} onChange={update('dateOfBirth')} />
            </label>
            <label>Phone
              <input value={form.phone} onChange={update('phone')} />
            </label>
          </div>
          <label>Address line 1
            <input value={form.addressLine1} onChange={update('addressLine1')} />
          </label>
          <label>Address line 2
            <input value={form.addressLine2} onChange={update('addressLine2')} />
          </label>
          <div className="row">
            <label>City
              <input value={form.city} onChange={update('city')} />
            </label>
            <label>State
              <input value={form.state} onChange={update('state')} />
            </label>
            <label>Zip
              <input value={form.zip} onChange={update('zip')} />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Spouse information (optional)</legend>
          <div className="row">
            <label>Spouse first name
              <input value={form.spouseFirstName} onChange={update('spouseFirstName')} />
            </label>
            <label>Spouse last name
              <input value={form.spouseLastName} onChange={update('spouseLastName')} />
            </label>
          </div>
          <label>Spouse date of birth
            <input type="date" value={form.spouseDateOfBirth} onChange={update('spouseDateOfBirth')} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Account type</legend>
          <label>Is this account for personal or business use?
            <select value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value, accountType: e.target.value === 'personal' ? 'individual' : 'sole_proprietor' })}>
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
                <input value={form.businessName} onChange={update('businessName')} />
              </label>
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>Initial accounts</legend>
          <p className="muted">Add your starting financial accounts and any current balances or positions you want associated with your profile.</p>
          {initialAccounts.map((account, accountIndex) => (
            <div key={`account-${accountIndex}`} className="account-setup-card">
              <div className="row">
                <label>Account name
                  <input value={account.accountName} onChange={updateInitialAccount(accountIndex, 'accountName')} />
                </label>
                <label>Account type
                  <select value={account.accountType} onChange={updateInitialAccount(accountIndex, 'accountType')}>
                    <option value="brokerage">Brokerage</option>
                    <option value="401k">401(k)</option>
                    <option value="ira">IRA</option>
                    <option value="roth_ira">Roth IRA</option>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
              <div className="row">
                <label>Institution
                  <input value={account.institution} onChange={updateInitialAccount(accountIndex, 'institution')} />
                </label>
                <label>Current balance
                  <input type="number" min="0" step="0.01" value={account.currentBalance} onChange={updateInitialAccount(accountIndex, 'currentBalance')} />
                </label>
              </div>

              <div className="positions-group">
                {account.holdings.map((holding, holdingIndex) => (
                  <div key={`holding-${accountIndex}-${holdingIndex}`} className="row positions-row">
                    <label>Symbol
                      <input value={holding.symbol} onChange={updateHolding(accountIndex, holdingIndex, 'symbol')} />
                    </label>
                    <label>Shares
                      <input type="number" min="0" step="0.0001" value={holding.shares} onChange={updateHolding(accountIndex, holdingIndex, 'shares')} />
                    </label>
                    <label>Price
                      <input type="number" min="0" step="0.01" value={holding.price} onChange={updateHolding(accountIndex, holdingIndex, 'price')} />
                    </label>
                    <button type="button" className="secondary small" onClick={() => removeHolding(accountIndex, holdingIndex)}>Remove</button>
                  </div>
                ))}
                <button type="button" className="secondary small" onClick={() => addHolding(accountIndex)}>Add position</button>
              </div>

              {initialAccounts.length > 1 && (
                <button type="button" className="danger small" onClick={() => removeInitialAccount(accountIndex)}>Remove account</button>
              )}
            </div>
          ))}
          <button type="button" className="secondary small" onClick={addInitialAccount}>Add account</button>
        </fieldset>

        <button type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Sign up'}</button>
        <p>Already have an account? <Link to="/login">Log in</Link></p>
      </form>
    </div>
  );
}
