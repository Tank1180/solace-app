import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { formatMoney } from '../utils/format';

const emptyAccountForm = { accountName: '', accountType: 'brokerage', institution: '' };
const emptyInvForm = { investmentAccountId: '', symbol: '', shares: '', purchaseDate: '', purchasePrice: '', saleDate: '', salePrice: '' };
const emptyDivForm = { investmentAccountId: '', symbol: '', payDate: '', amount: '', disposition: 'cash' };
const emptyDividendActionForm = {
  dividendId: '',
  actionType: 'investment',
  investmentAccountId: '',
  symbol: '',
  shares: '1',
  purchaseDate: '',
  purchasePrice: '',
  payDate: '',
  description: '',
};
const emptyRetirementForm = { paycheckId: '', investmentAccountId: '', destinations: [{ symbol: '', amount: '' }] };

export default function Investments() {
  const [searchParams] = useSearchParams();
  const [accounts, setAccounts] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [dividends, setDividends] = useState([]);
  const [retirement, setRetirement] = useState({ paychecks: [], allocations: [] });
  const [marketMode, setMarketMode] = useState('close');
  const [marketSummary, setMarketSummary] = useState(null);
  const [marketWarnings, setMarketWarnings] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [invForm, setInvForm] = useState(emptyInvForm);
  const [divForm, setDivForm] = useState(emptyDivForm);
  const [dividendActionForm, setDividendActionForm] = useState(emptyDividendActionForm);
  const [retirementForm, setRetirementForm] = useState(emptyRetirementForm);
  const [shareConfirmForms, setShareConfirmForms] = useState({});
  const [accountTiers, setAccountTiers] = useState([]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [accountsRes, investmentsRes, dividendsRes, retirementRes, accountTypesRes] = await Promise.all([
        api.get('/investments/accounts'),
        api.get(`/investments?mode=${marketMode}`),
        api.get('/investments/dividends'),
        api.get('/investments/retirement-allocations'),
        api.get('/investments/account-types'),
      ]);
      setAccounts(accountsRes.data.accounts);
      setInvestments(investmentsRes.data.investments);
      setMarketSummary(investmentsRes.data.marketSummary || null);
      setMarketWarnings(investmentsRes.data.marketWarnings || []);
      setDividends(dividendsRes.data.dividends);
      setRetirement(retirementRes.data);
      setAccountTiers(accountTypesRes.data.tiers || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load investments');
    }
  }, [marketMode]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const paycheckId = searchParams.get('paycheckId');
    if (paycheckId) {
      setRetirementForm((current) => ({ ...current, paycheckId }));
    }
  }, [searchParams]);

  const selectedPaycheck = useMemo(
    () => retirement.paychecks.find((p) => String(p.id) === String(retirementForm.paycheckId)) || null,
    [retirement.paychecks, retirementForm.paycheckId]
  );

  const pendingPaychecks = useMemo(
    () => retirement.paychecks.filter((p) => Number(p.remaining_amount || 0) > 0),
    [retirement.paychecks]
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => String(a.id) === String(retirementForm.investmentAccountId)) || null,
    [accounts, retirementForm.investmentAccountId]
  );

  const filteredInvestments = useMemo(() => {
    if (!retirementForm.investmentAccountId) return investments;
    return investments.filter((i) => String(i.investment_account_id) === String(retirementForm.investmentAccountId));
  }, [investments, retirementForm.investmentAccountId]);

  const destinationSymbols = useMemo(() => {
    const seen = new Set();
    return investments.reduce((list, item) => {
      const symbol = item.symbol ? String(item.symbol).toUpperCase() : '';
      if (symbol && !seen.has(symbol)) {
        seen.add(symbol);
        list.push(symbol);
      }
      return list;
    }, []);
  }, [investments]);

  const totalCostBasis = investments.reduce((s, i) => s + (i.cost_basis || 0), 0);
  const totalRealized = investments.reduce((s, i) => s + (i.realized_gain || 0), 0);
  const totalPendingRetirement = retirement.paychecks.reduce((s, p) => s + Number(p.remaining_amount || 0), 0);

  useEffect(() => {
    if (!retirementForm.paycheckId && pendingPaychecks.length > 0) {
      const firstPending = pendingPaychecks[0];
      setRetirementForm((current) => ({ ...current, paycheckId: String(firstPending.id) }));
    }
  }, [pendingPaychecks, retirementForm.paycheckId]);

  useEffect(() => {
    if (retirementForm.paycheckId && selectedPaycheck && Number(selectedPaycheck.remaining_amount || 0) <= 0) {
      setRetirementForm((current) => ({ ...current, paycheckId: pendingPaychecks[0] ? String(pendingPaychecks[0].id) : '' }));
    }
  }, [pendingPaychecks, retirementForm.paycheckId, selectedPaycheck]);

  useEffect(() => {
    if (!retirementForm.investmentAccountId && accounts.length > 0) {
      setRetirementForm((current) => ({ ...current, investmentAccountId: String(accounts[0].id) }));
    }
  }, [accounts]);

  const addAccount = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/investments/accounts', accountForm);
      setAccountForm(emptyAccountForm);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add account');
    }
  };

  const addInvestment = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/investments', {
        ...invForm,
        investmentAccountId: Number(invForm.investmentAccountId),
        shares: Number(invForm.shares),
        purchasePrice: Number(invForm.purchasePrice),
        salePrice: invForm.salePrice ? Number(invForm.salePrice) : null,
        saleDate: invForm.saleDate || null,
      });
      setInvForm(emptyInvForm);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add investment');
    }
  };

  const addDividend = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/investments/dividends', {
        ...divForm,
        investmentAccountId: Number(divForm.investmentAccountId),
        amount: Number(divForm.amount),
        disposition: divForm.disposition,
      });
      setDivForm(emptyDivForm);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add dividend');
    }
  };

  const removeAccount = async (id) => { await api.delete(`/investments/accounts/${id}`); load(); };
  const removeInvestment = async (id) => { await api.delete(`/investments/${id}`); load(); };
  const removeDividend = async (id) => { await api.delete(`/investments/dividends/${id}`); load(); };
  const removeAllocation = async (id) => {
    await api.delete(`/investments/retirement-allocations/${id}`);
    load();
    window.dispatchEvent(new Event('retirement-reminders-changed'));
  };
  const updateShareConfirmForm = (investmentId, field, value) => {
    setShareConfirmForms((current) => ({
      ...current,
      [investmentId]: { ...(current[investmentId] || { shares: '', purchasePrice: '', purchaseDate: '' }), [field]: value },
    }));
  };
  const confirmShares = async (investmentId) => {
    setError('');
    setMessage('');
    const row = shareConfirmForms[investmentId] || {};
    if (!(Number(row.shares) > 0) || !(Number(row.purchasePrice) > 0)) {
      setError('Enter the number of shares and the price paid per share to confirm this allocation.');
      return;
    }
    try {
      await api.put(`/investments/${investmentId}`, {
        shares: Number(row.shares),
        purchasePrice: Number(row.purchasePrice),
        purchaseDate: row.purchaseDate || undefined,
      });
      setShareConfirmForms((current) => {
        const next = { ...current };
        delete next[investmentId];
        return next;
      });
      setMessage('Shares confirmed. This holding now appears with your other investments.');
      load();
      window.dispatchEvent(new Event('retirement-reminders-changed'));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to confirm shares');
    }
  };
  const downloadPortfolioReport = async () => {
    setError('');
    try {
      const res = await api.get(`/investments/report?mode=${marketMode}&format=csv`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `portfolio-report-${new Date().toISOString().slice(0, 10)}-${marketMode}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to download portfolio report');
    }
  };
  const startDividendAction = (dividend, actionType) => {
    setDividendActionForm({
      dividendId: String(dividend.id),
      actionType,
      investmentAccountId: accounts[0] ? String(accounts[0].id) : '',
      symbol: dividend.symbol || '',
      shares: '1',
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchasePrice: String(dividend.remaining_amount || dividend.amount || ''),
      payDate: new Date().toISOString().slice(0, 10),
      description: '',
    });
  };
  const submitDividendAction = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/investments/dividend-allocations', {
        dividendId: Number(dividendActionForm.dividendId),
        actionType: dividendActionForm.actionType,
        investmentAccountId: dividendActionForm.investmentAccountId ? Number(dividendActionForm.investmentAccountId) : null,
        symbol: dividendActionForm.symbol,
        shares: dividendActionForm.shares ? Number(dividendActionForm.shares) : null,
        purchaseDate: dividendActionForm.purchaseDate || null,
        purchasePrice: dividendActionForm.purchasePrice ? Number(dividendActionForm.purchasePrice) : null,
        payDate: dividendActionForm.payDate || null,
        description: dividendActionForm.description,
      });
      setDividendActionForm(emptyDividendActionForm);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to process dividend cash balance');
    }
  };

  const addDestinationRow = () => {
    setRetirementForm({
      ...retirementForm,
      destinations: [...retirementForm.destinations, { symbol: '', amount: '' }],
    });
  };

  const updateDestination = (index, field, value) => {
    const destinations = retirementForm.destinations.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    ));
    setRetirementForm({ ...retirementForm, destinations });
  };

  const removeDestinationRow = (index) => {
    const destinations = retirementForm.destinations.filter((_, rowIndex) => rowIndex !== index);
    setRetirementForm({ ...retirementForm, destinations: destinations.length > 0 ? destinations : [{ symbol: '', amount: '' }] });
  };

  const clearRetirementForm = () => {
    setRetirementForm({ ...emptyRetirementForm, paycheckId: retirementForm.paycheckId });
  };

  const submitAllocations = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    const allocations = retirementForm.destinations.map((row) => ({
      symbol: row.symbol,
      amount: Number(row.amount || 0),
    }));
    if (allocations.some((row) => !row.symbol || row.amount <= 0)) {
      setError('Each destination symbol must have an amount greater than zero.');
      return;
    }
    const requested = allocations.reduce((sum, row) => sum + row.amount, 0);
    const remaining = Number(selectedPaycheck?.remaining_amount || 0);
    if (requested > remaining + 0.0001) {
      setError(`Total allocated (${formatMoney(requested)}) cannot exceed the remaining balance of ${formatMoney(remaining)} for this paycheck.`);
      return;
    }

    try {
      const payload = {
        paycheckId: Number(retirementForm.paycheckId),
        investmentAccountId: Number(retirementForm.investmentAccountId),
        allocations,
      };
      await api.post('/investments/retirement-allocations', payload);
      setMessage('Retirement contribution allocated.');
      clearRetirementForm();
      load();
      window.dispatchEvent(new Event('retirement-reminders-changed'));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to allocate retirement contribution');
    }
  };

  return (
    <div>
      <h1>Investments &amp; Retirement</h1>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end' }}>
        <label>Pricing mode
          <select value={marketMode} onChange={(e) => setMarketMode(e.target.value)}>
            <option value="close">Daily close</option>
            <option value="realtime">Real-time</option>
          </select>
        </label>
        <button type="button" onClick={downloadPortfolioReport}>Export aggregated report</button>
      </div>
      {marketSummary && (
        <p className="muted">
          Prices as of {new Date(marketSummary.market_as_of).toLocaleString()}.{' '}
          {marketSummary.unpriced_holdings > 0 ? `${marketSummary.unpriced_holdings} holding(s) need a quote.` : 'All open holdings are priced.'}
        </p>
      )}
      {marketWarnings.length > 0 && (
        <p className="muted">Some market quotes are temporarily unavailable.</p>
      )}

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Portfolio market value</div><div className="stat-value">{formatMoney(marketSummary?.total_market_value)}</div></div>
        <div className="stat-card"><div className="stat-label">Unrealized gain</div><div className="stat-value">{formatMoney(marketSummary?.total_unrealized_gain)}</div></div>
        <div className="stat-card"><div className="stat-label">Total cost basis</div><div className="stat-value">{formatMoney(totalCostBasis)}</div></div>
        <div className="stat-card"><div className="stat-label">Total realized gains</div><div className="stat-value">{formatMoney(totalRealized)}</div></div>
        <div className="stat-card"><div className="stat-label">Retirement contributions pending</div><div className="stat-value">{formatMoney(totalPendingRetirement)}</div></div>
      </div>

      <div className="card">
        <h2>Retirement contribution allocation</h2>
        <p className="muted">
          When a paycheck includes a retirement contribution, allocate those funds to the investment account and destination investments.
        </p>

        <h3>Current investment accounts</h3>
        {accounts.length > 0 ? (
          <ul className="rule-list">
            {accounts.map((a) => (
              <li key={a.id}>{a.account_name} ({a.account_type}){a.institution ? ` — ${a.institution}` : ''}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">Add an investment account below to start allocating retirement funds.</p>
        )}

        <table>
          <thead>
            <tr><th>Paycheck</th><th>Contribution</th><th>Allocated</th><th>Remaining</th></tr>
          </thead>
          <tbody>
            {pendingPaychecks.map((p) => (
              <tr key={p.id}>
                <td>{p.pay_date}{p.employer ? ` — ${p.employer}` : ''}</td>
                <td>{formatMoney(p.retirement_contribution)}</td>
                <td>{formatMoney(p.allocated_amount)}</td>
                <td>{formatMoney(p.remaining_amount)}</td>
              </tr>
            ))}
            {pendingPaychecks.length === 0 && (
              <tr><td colSpan="4" className="muted">No retirement contributions need allocation yet.</td></tr>
            )}
          </tbody>
        </table>

        {selectedPaycheck && (
          <form onSubmit={submitAllocations}>
            <div className="row">
              <label>Paycheck
                <select value={retirementForm.paycheckId} onChange={(e) => setRetirementForm({ ...retirementForm, paycheckId: e.target.value })}>
                  <option value="">Select paycheck</option>
                  {pendingPaychecks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.pay_date} — {formatMoney(p.remaining_amount)} remaining
                    </option>
                  ))}
                </select>
              </label>
              <label>Investment account
                <select
                  required
                  value={retirementForm.investmentAccountId}
                  onChange={(e) => setRetirementForm({ ...retirementForm, investmentAccountId: e.target.value, destinations: [{ symbol: '', amount: '' }] })}
                >
                  <option value="">Select one of your current accounts</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.account_name} ({a.account_type})</option>
                  ))}
                </select>
              </label>
            </div>

            <p className="muted">
              Remaining to allocate for this paycheck: {formatMoney(selectedPaycheck.remaining_amount)}.
            </p>

            {retirementForm.destinations.map((row, index) => (
              <div className="row" key={index}>
                <label>Destination symbol
                  <input
                    required
                    list={`destination-symbols-${index}`}
                    value={row.symbol}
                    onChange={(e) => updateDestination(index, 'symbol', e.target.value.toUpperCase())}
                    placeholder="Type a symbol or pick an existing one"
                  />
                  <datalist id={`destination-symbols-${index}`}>
                    {destinationSymbols.map((symbol) => (
                      <option key={symbol} value={symbol} />
                    ))}
                    {filteredInvestments
                      .map((i) => String(i.symbol || '').toUpperCase())
                      .filter((symbol, idx, arr) => symbol && arr.indexOf(symbol) === idx)
                      .map((symbol) => <option key={`acct-${symbol}`} value={symbol} />)}
                  </datalist>
                </label>
                <label>Amount
                  <input type="number" step="0.01" required value={row.amount} onChange={(e) => updateDestination(index, 'amount', e.target.value)} />
                </label>
                <div style={{ alignSelf: 'end' }}>
                  <button type="button" onClick={() => removeDestinationRow(index)}>Remove</button>
                </div>
              </div>
            ))}

            <div className="row">
              <button type="button" onClick={addDestinationRow}>Add another destination</button>
              <button type="submit" disabled={accounts.length === 0 || !retirementForm.investmentAccountId}>Allocate funds</button>
            </div>

            {selectedAccount && filteredInvestments.length === 0 && (
              <p className="muted">This account has no existing investments yet. You can still type a new destination symbol to create one during allocation.</p>
            )}
          </form>
        )}
      </div>

      {retirement.pendingShareAllocations && retirement.pendingShareAllocations.length > 0 && (
        <div className="card">
          <h2>Investments awaiting share count</h2>
          <p className="muted">
            These retirement contributions have been allocated to a destination but the number of shares purchased hasn't been entered yet.
            They're kept separate from your portfolio totals until confirmed. Enter the shares and price paid to move each one into your Investments list below.
          </p>
          <table>
            <thead>
              <tr><th>Symbol</th><th>Account</th><th>Amount allocated</th><th>From paychecks</th><th>Shares</th><th>Price paid per share</th><th>Purchase date</th><th></th></tr>
            </thead>
            <tbody>
              {retirement.pendingShareAllocations.map((p) => {
                const rowForm = shareConfirmForms[p.id] || { shares: '', purchasePrice: '', purchaseDate: '' };
                return (
                  <tr key={p.id}>
                    <td>{p.symbol}</td>
                    <td>{p.account_name || '—'}</td>
                    <td>{formatMoney(p.allocated_amount)}</td>
                    <td>{p.first_pay_date === p.last_pay_date ? p.first_pay_date : `${p.first_pay_date} – ${p.last_pay_date}`}</td>
                    <td>
                      <input
                        type="number" step="0.0001" style={{ width: '6rem' }}
                        value={rowForm.shares}
                        onChange={(e) => updateShareConfirmForm(p.id, 'shares', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number" step="0.01" style={{ width: '6rem' }}
                        value={rowForm.purchasePrice}
                        onChange={(e) => updateShareConfirmForm(p.id, 'purchasePrice', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="date" style={{ width: '9rem' }}
                        value={rowForm.purchaseDate}
                        onChange={(e) => updateShareConfirmForm(p.id, 'purchaseDate', e.target.value)}
                      />
                    </td>
                    <td><button type="button" onClick={() => confirmShares(p.id)}>Confirm shares</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="row-cards">
        <form className="card" onSubmit={addAccount}>
          <h2>Add investment account</h2>
          <label>Account name
            <input required value={accountForm.accountName} onChange={(e) => setAccountForm({ ...accountForm, accountName: e.target.value })} />
          </label>
          <label>Type
            <select value={accountForm.accountType} onChange={(e) => setAccountForm({ ...accountForm, accountType: e.target.value })}>
              {accountTiers.map((tier) => (
                <optgroup key={tier.tier} label={tier.label}>
                  {tier.types.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>Institution
            <input value={accountForm.institution} onChange={(e) => setAccountForm({ ...accountForm, institution: e.target.value })} />
          </label>
          <button type="submit">Add account</button>
          <ul className="rule-list">
            {accounts.map((a) => (
              <li key={a.id}>{a.account_name} ({a.account_type}) <button type="button" onClick={() => removeAccount(a.id)}>Remove</button></li>
            ))}
          </ul>
        </form>

        <form className="card" onSubmit={addInvestment}>
          <h2>Add investment</h2>
          <label>Account
            <select required value={invForm.investmentAccountId} onChange={(e) => setInvForm({ ...invForm, investmentAccountId: e.target.value })}>
              <option value="">Select account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
            </select>
          </label>
          <label>Symbol
            <input required value={invForm.symbol} onChange={(e) => setInvForm({ ...invForm, symbol: e.target.value })} />
          </label>
          <label>Shares
            <input type="number" step="0.0001" required value={invForm.shares} onChange={(e) => setInvForm({ ...invForm, shares: e.target.value })} />
          </label>
          <label>Purchase date
            <input type="date" required value={invForm.purchaseDate} onChange={(e) => setInvForm({ ...invForm, purchaseDate: e.target.value })} />
          </label>
          <label>Purchase price
            <input type="number" step="0.01" required value={invForm.purchasePrice} onChange={(e) => setInvForm({ ...invForm, purchasePrice: e.target.value })} />
          </label>
          <label>Sale date (optional)
            <input type="date" value={invForm.saleDate} onChange={(e) => setInvForm({ ...invForm, saleDate: e.target.value })} />
          </label>
          <label>Sale price (optional)
            <input type="number" step="0.01" value={invForm.salePrice} onChange={(e) => setInvForm({ ...invForm, salePrice: e.target.value })} />
          </label>
          <button type="submit" disabled={accounts.length === 0}>Add investment</button>
        </form>

        <form className="card" onSubmit={addDividend}>
          <h2>Add dividend</h2>
          <label>Account
            <select required value={divForm.investmentAccountId} onChange={(e) => setDivForm({ ...divForm, investmentAccountId: e.target.value })}>
              <option value="">Select account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
            </select>
          </label>
          <label>Symbol
            <input required value={divForm.symbol} onChange={(e) => setDivForm({ ...divForm, symbol: e.target.value })} />
          </label>
          <label>Pay date
            <input type="date" required value={divForm.payDate} onChange={(e) => setDivForm({ ...divForm, payDate: e.target.value })} />
          </label>
          <label>Amount
            <input type="number" step="0.01" required value={divForm.amount} onChange={(e) => setDivForm({ ...divForm, amount: e.target.value })} />
          </label>
          <label>Disposition
            <select value={divForm.disposition} onChange={(e) => setDivForm({ ...divForm, disposition: e.target.value })}>
              <option value="cash">Distributed as cash</option>
              <option value="reinvested">Reinvested into the asset</option>
            </select>
          </label>
          <button type="submit" disabled={accounts.length === 0}>Add dividend</button>
        </form>
      </div>

      <div className="card">
        <h2>Retirement allocations</h2>
        <table>
          <thead>
            <tr><th>Paycheck</th><th>Account</th><th>Investment</th><th>Amount</th><th></th></tr>
          </thead>
          <tbody>
            {retirement.allocations.map((a) => (
              <tr key={a.id}>
                <td>{a.pay_date}{a.employer ? ` — ${a.employer}` : ''}</td>
                <td>{a.account_name || '—'}</td>
                <td>{a.symbol || '—'}{Number(a.pending_shares) === 1 && <span className="muted"> (shares pending)</span>}</td>
                <td>{formatMoney(a.amount)}</td>
                <td><button type="button" onClick={() => removeAllocation(a.id)}>Delete</button></td>
              </tr>
            ))}
            {retirement.allocations.length === 0 && (
              <tr><td colSpan="5" className="muted">No retirement allocations recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Investments</h2>
        <table>
          <thead>
            <tr><th>Symbol</th><th>Shares</th><th>Purchase</th><th>Sale</th><th>Cost basis</th><th>Market price</th><th>Market value</th><th>Unrealized gain</th><th>Realized gain</th><th></th></tr>
          </thead>
          <tbody>
            {investments.map((i) => (
              <tr key={i.id}>
                <td>{i.symbol}</td>
                <td>{i.shares}</td>
                <td>{i.purchase_date} @ {formatMoney(i.purchase_price)}</td>
                <td>{i.is_sold ? `${i.sale_date} @ ${formatMoney(i.sale_price)}` : '—'}</td>
                <td>{formatMoney(i.cost_basis)}</td>
                <td>{i.is_sold ? '—' : formatMoney(i.market_price)}</td>
                <td>{i.is_sold ? '—' : formatMoney(i.market_value)}</td>
                <td>{i.is_sold ? '—' : formatMoney(i.unrealized_gain)}</td>
                <td>{i.is_sold ? formatMoney(i.realized_gain) : 'Unrealized'}</td>
                <td><button type="button" onClick={() => removeInvestment(i.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Dividends</h2>
        {dividendActionForm.dividendId && (
          <form className="card" onSubmit={submitDividendAction} style={{ marginBottom: '1rem' }}>
            <h3>{dividendActionForm.actionType === 'cash_out' ? 'Cash out dividend balance' : 'Allocate cash dividend to a new investment'}</h3>
            <p className="muted">
              Remaining cash balance: {formatMoney((dividends.find((d) => String(d.id) === String(dividendActionForm.dividendId)) || {}).remaining_amount || 0)}
            </p>
            {dividendActionForm.actionType === 'investment' ? (
              <>
                <div className="row">
                  <label>Investment account
                    <select required value={dividendActionForm.investmentAccountId} onChange={(e) => setDividendActionForm({ ...dividendActionForm, investmentAccountId: e.target.value })}>
                      <option value="">Select one of your current accounts</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name} ({a.account_type})</option>)}
                    </select>
                  </label>
                  <label>Symbol
                    <input
                      required
                      list="dividend-symbols"
                      value={dividendActionForm.symbol}
                      onChange={(e) => setDividendActionForm({ ...dividendActionForm, symbol: e.target.value.toUpperCase() })}
                      placeholder="Type a symbol or pick an existing one"
                    />
                  </label>
                  <datalist id="dividend-symbols">
                    {destinationSymbols.map((symbol) => <option key={symbol} value={symbol} />)}
                  </datalist>
                </div>
                <div className="row">
                  <label>Shares
                    <input type="number" step="0.0001" value={dividendActionForm.shares} onChange={(e) => setDividendActionForm({ ...dividendActionForm, shares: e.target.value })} />
                  </label>
                  <label>Purchase date
                    <input type="date" required value={dividendActionForm.purchaseDate} onChange={(e) => setDividendActionForm({ ...dividendActionForm, purchaseDate: e.target.value })} />
                  </label>
                  <label>Purchase price
                    <input type="number" step="0.01" value={dividendActionForm.purchasePrice} onChange={(e) => setDividendActionForm({ ...dividendActionForm, purchasePrice: e.target.value })} />
                  </label>
                </div>
              </>
            ) : (
              <div className="row">
                <label>Pay date
                  <input type="date" required value={dividendActionForm.payDate} onChange={(e) => setDividendActionForm({ ...dividendActionForm, payDate: e.target.value })} />
                </label>
                <label>Description
                  <input value={dividendActionForm.description} onChange={(e) => setDividendActionForm({ ...dividendActionForm, description: e.target.value })} />
                </label>
              </div>
            )}
            <div className="row">
              <button type="button" onClick={() => setDividendActionForm(emptyDividendActionForm)}>Cancel</button>
              <button type="submit">Save dividend action</button>
            </div>
          </form>
        )}
        <table>
          <thead><tr><th>Date</th><th>Symbol</th><th>Amount</th><th>Disposition</th><th>Remaining cash</th><th></th></tr></thead>
          <tbody>
            {dividends.map((d) => (
              <tr key={d.id}>
                <td>{d.pay_date}</td>
                <td>{d.symbol}</td>
                <td>{formatMoney(d.amount)}</td>
                <td>{d.disposition === 'reinvested' ? 'Reinvested' : 'Cash'}</td>
                <td>{formatMoney(d.remaining_amount)}</td>
                <td>
                  {d.disposition === 'cash' && d.remaining_amount > 0 ? (
                    <>
                      <button type="button" onClick={() => startDividendAction(d, 'investment')}>Allocate</button>{' '}
                      <button type="button" onClick={() => startDividendAction(d, 'cash_out')}>Cash out</button>{' '}
                    </>
                  ) : null}
                  <button type="button" onClick={() => removeDividend(d.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
