import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { formatMoney } from '../utils/format';

const emptyAccountForm = { accountName: '', accountType: '', institution: '' };
const today = new Date().toISOString().slice(0, 10);
const emptyTransferForm = { fromCashAccountId: '', toCashAccountId: '', amount: '', transferDate: today, description: '' };

export default function CashAccounts() {
  const [searchParams] = useSearchParams();
  const [tiers, setTiers] = useState([]);
  const [investmentTiers, setInvestmentTiers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [investmentAccounts, setInvestmentAccounts] = useState([]);
  const [paychecks, setPaychecks] = useState([]);
  const [otherIncome, setOtherIncome] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [ledgerData, setLedgerData] = useState(null);

  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [paycheckAllocForm, setPaycheckAllocForm] = useState({ sourceId: '', destinations: [{ cashAccountId: '', amount: '' }] });
  const [incomeAllocForm, setIncomeAllocForm] = useState({ sourceId: '', destinations: [{ cashAccountId: '', amount: '' }] });
  const [transferForm, setTransferForm] = useState(emptyTransferForm);

  const load = async () => {
    setError('');
    try {
      const [typesRes, accountsRes, allocRes, summaryRes, investmentAccountsRes, transfersRes] = await Promise.all([
        api.get('/cash-accounts/account-types'),
        api.get('/cash-accounts/accounts'),
        api.get('/cash-accounts/allocations'),
        api.get('/cash-accounts/liquidity-summary'),
        api.get('/investments/accounts'),
        api.get('/cash-accounts/transfers'),
      ]);
      setTiers(typesRes.data.tiers || []);
      setInvestmentTiers(typesRes.data.investmentTiers || []);
      setAccounts(accountsRes.data.accounts || []);
      setPaychecks(allocRes.data.paychecks || []);
      setOtherIncome(allocRes.data.otherIncome || []);
      setAllocations(allocRes.data.allocations || []);
      setSummary(summaryRes.data);
      setInvestmentAccounts(investmentAccountsRes.data.accounts || []);
      setTransfers(transfersRes.data.transfers || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load cash accounts');
    }
  };

  useEffect(() => { load(); }, []);

  const loadLedger = async (accountId) => {
    if (!accountId) {
      setLedgerData(null);
      return;
    }
    try {
      const res = await api.get(`/cash-accounts/accounts/${accountId}/ledger`);
      setLedgerData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load account activity');
    }
  };

  useEffect(() => {
    if (!ledgerAccountId && accounts.length > 0) {
      setLedgerAccountId(String(accounts[0].id));
    }
  }, [accounts, ledgerAccountId]);

  useEffect(() => { loadLedger(ledgerAccountId); }, [ledgerAccountId]);

  useEffect(() => {
    const paycheckId = searchParams.get('paycheckId');
    const otherIncomeId = searchParams.get('otherIncomeId');
    if (paycheckId) setPaycheckAllocForm((current) => ({ ...current, sourceId: paycheckId }));
    if (otherIncomeId) setIncomeAllocForm((current) => ({ ...current, sourceId: otherIncomeId }));
  }, [searchParams]);

  const pendingPaychecks = useMemo(() => paychecks.filter((p) => Number(p.remaining_amount || 0) > 0), [paychecks]);
  const pendingOtherIncome = useMemo(() => otherIncome.filter((oi) => Number(oi.remaining_amount || 0) > 0), [otherIncome]);

  const selectedPaycheck = useMemo(
    () => paychecks.find((p) => String(p.id) === String(paycheckAllocForm.sourceId)) || null,
    [paychecks, paycheckAllocForm.sourceId]
  );
  const selectedOtherIncome = useMemo(
    () => otherIncome.find((oi) => String(oi.id) === String(incomeAllocForm.sourceId)) || null,
    [otherIncome, incomeAllocForm.sourceId]
  );

  useEffect(() => {
    if (!paycheckAllocForm.sourceId && pendingPaychecks.length > 0) {
      setPaycheckAllocForm((current) => ({ ...current, sourceId: String(pendingPaychecks[0].id) }));
    }
  }, [pendingPaychecks, paycheckAllocForm.sourceId]);

  useEffect(() => {
    if (!incomeAllocForm.sourceId && pendingOtherIncome.length > 0) {
      setIncomeAllocForm((current) => ({ ...current, sourceId: String(pendingOtherIncome[0].id) }));
    }
  }, [pendingOtherIncome, incomeAllocForm.sourceId]);

  const addAccount = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/cash-accounts/accounts', accountForm);
      setAccountForm(emptyAccountForm);
      setMessage('Cash account added.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add cash account');
    }
  };

  const removeAccount = async (id) => {
    await api.delete(`/cash-accounts/accounts/${id}`);
    load();
  };

  const toggleAccountActive = async (account) => {
    await api.put(`/cash-accounts/accounts/${account.id}`, { isActive: !account.is_active });
    load();
  };

  const toggleIncludeSemiLiquid = async (e) => {
    const checked = e.target.checked;
    setSummary((current) => (current ? { ...current, includeSemiLiquidInAvailableCash: checked } : current));
    try {
      await api.put('/cash-accounts/settings', { includeSemiLiquidInAvailableCash: checked });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update setting');
    }
  };

  const removeAllocation = async (id) => {
    await api.delete(`/cash-accounts/allocations/${id}`);
    load();
    window.dispatchEvent(new Event('cash-allocation-reminders-changed'));
  };

  const submitTransfer = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (transferForm.fromCashAccountId && transferForm.fromCashAccountId === transferForm.toCashAccountId) {
      setError('Choose two different accounts to transfer between.');
      return;
    }
    try {
      await api.post('/cash-accounts/transfers', {
        fromCashAccountId: Number(transferForm.fromCashAccountId),
        toCashAccountId: Number(transferForm.toCashAccountId),
        amount: Number(transferForm.amount || 0),
        transferDate: transferForm.transferDate,
        description: transferForm.description,
      });
      setMessage('Transfer recorded.');
      setTransferForm({ ...emptyTransferForm, transferDate: transferForm.transferDate });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record transfer');
    }
  };

  const removeTransfer = async (id) => {
    await api.delete(`/cash-accounts/transfers/${id}`);
    load();
  };

  const updateDestination = (setForm) => (index, field, value) => {
    setForm((current) => {
      const destinations = current.destinations.map((row, rowIndex) => (
        rowIndex === index ? { ...row, [field]: value } : row
      ));
      return { ...current, destinations };
    });
  };
  const addDestinationRow = (setForm) => () => {
    setForm((current) => ({ ...current, destinations: [...current.destinations, { cashAccountId: '', amount: '' }] }));
  };
  const removeDestinationRow = (setForm) => (index) => {
    setForm((current) => {
      const destinations = current.destinations.filter((_, rowIndex) => rowIndex !== index);
      return { ...current, destinations: destinations.length > 0 ? destinations : [{ cashAccountId: '', amount: '' }] };
    });
  };

  const submitAllocation = (endpoint, form, setForm) => async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post(endpoint, {
        sourceId: Number(form.sourceId),
        allocations: form.destinations.map((row) => ({
          cashAccountId: Number(row.cashAccountId),
          amount: Number(row.amount || 0),
        })),
      });
      setMessage('Funds allocated to your cash accounts.');
      setForm({ sourceId: '', destinations: [{ cashAccountId: '', amount: '' }] });
      load();
      window.dispatchEvent(new Event('cash-allocation-reminders-changed'));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to allocate funds');
    }
  };

  const accountLabel = (id) => {
    const account = accounts.find((a) => String(a.id) === String(id));
    return account ? `${account.account_name} (${account.account_type})` : '—';
  };

  return (
    <div>
      <h1>Cash Accounts</h1>
      <p className="muted">
        Track where your paycheck and other income land — checking, savings, HSA, FSA, and more. Splitting an
        income entry across destination accounts is optional and can be done any time.
      </p>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      {summary && (
        <div className="card">
          <h2>Liquidity overview</h2>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Available cash today</div>
              <div className="stat-value">{formatMoney(summary.availableCashToday)}</div>
              {summary.availableCashProjected !== summary.availableCashToday && (
                <div className="muted" style={{ fontSize: '0.8rem' }}>Projected: {formatMoney(summary.availableCashProjected)}</div>
              )}
            </div>
            <div className="stat-card"><div className="stat-label">Restricted cash (Tier 3)</div><div className="stat-value">{formatMoney(summary.restrictedCash)}</div></div>
            <div className="stat-card"><div className="stat-label">Invested assets (Tier 4)</div><div className="stat-value">{formatMoney(summary.investedAssets)}</div></div>
            <div className="stat-card"><div className="stat-label">Retirement assets (Tier 5)</div><div className="stat-value">{formatMoney(summary.retirementAssets)}</div></div>
            <div className="stat-card"><div className="stat-label">Total cash across all tiers</div><div className="stat-value">{formatMoney(summary.totalCash)}</div></div>
          </div>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem', marginTop: '0.75rem' }}>
            <input type="checkbox" checked={summary.includeSemiLiquidInAvailableCash} onChange={toggleIncludeSemiLiquid} />
            Include Tier 2 (semi-liquid) accounts in Available Cash Today
          </label>
          {summary.overdraftAccounts && summary.overdraftAccounts.length > 0 && (
            <p className="error" style={{ marginTop: '0.5rem' }}>
              Overdraft alert: {summary.overdraftAccounts.map((a) => a.account_name).join(', ')} {summary.overdraftAccounts.length === 1 ? 'has' : 'have'} a negative balance.
            </p>
          )}
          {summary.configWarnings && summary.configWarnings.length > 0 && (
            <p className="error" style={{ marginTop: '0.5rem' }}>
              Configuration warning: {summary.configWarnings.map((a) => `${a.account_name} (${a.account_type})`).join(', ')} — unrecognized account type, defaulted to Tier 3 (Restricted). Please review.
            </p>
          )}
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>{summary.methodologyNote}</p>
        </div>
      )}

      <div className="card">
        <h2>Your cash accounts (Tier 1–3)</h2>
        {tiers.map((tier) => {
          const tierAccounts = accounts.filter((a) => a.tier === tier.tier);
          if (tierAccounts.length === 0) return null;
          return (
            <div key={tier.tier} style={{ marginBottom: '0.75rem' }}>
              <strong>{tier.label}</strong>
              <ul className="rule-list">
                {tierAccounts.map((a) => (
                  <li key={a.id}>
                    {a.account_name} — {tier.types.find((t) => t.value === a.account_type)?.label || a.account_type}
                    {a.institution ? ` (${a.institution})` : ''}
                    {!a.is_active && <span className="muted"> (inactive)</span>}{' '}
                    <button type="button" onClick={() => toggleAccountActive(a)}>{a.is_active ? 'Deactivate' : 'Reactivate'}</button>{' '}
                    <button type="button" onClick={() => removeAccount(a.id)}>Remove</button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {accounts.length === 0 && <p className="muted">No cash accounts added yet.</p>}

        <form onSubmit={addAccount}>
          <div className="row">
            <label>Account name
              <input required value={accountForm.accountName} onChange={(e) => setAccountForm({ ...accountForm, accountName: e.target.value })} />
            </label>
            <label>Account type
              <select required value={accountForm.accountType} onChange={(e) => setAccountForm({ ...accountForm, accountType: e.target.value })}>
                <option value="">Select a type…</option>
                {tiers.map((tier) => (
                  <optgroup key={tier.tier} label={tier.label}>
                    {tier.types.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>Institution (optional)
              <input value={accountForm.institution} onChange={(e) => setAccountForm({ ...accountForm, institution: e.target.value })} />
            </label>
          </div>
          <button type="submit">Add cash account</button>
        </form>
      </div>

      <div className="card">
        <h2>Transfer between accounts</h2>
        <p className="muted">
          Move money between your own cash accounts. This changes each account's balance but has no effect on your total cash.
        </p>
        <form onSubmit={submitTransfer}>
          <div className="row">
            <label>From account
              <select required value={transferForm.fromCashAccountId} onChange={(e) => setTransferForm({ ...transferForm, fromCashAccountId: e.target.value })}>
                <option value="">Select account</option>
                {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
              </select>
            </label>
            <label>To account
              <select required value={transferForm.toCashAccountId} onChange={(e) => setTransferForm({ ...transferForm, toCashAccountId: e.target.value })}>
                <option value="">Select account</option>
                {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
              </select>
            </label>
            <label>Amount
              <input type="number" step="0.01" required value={transferForm.amount} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label>Date
              <input type="date" required value={transferForm.transferDate} onChange={(e) => setTransferForm({ ...transferForm, transferDate: e.target.value })} />
            </label>
            <label>Description (optional)
              <input value={transferForm.description} onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} />
            </label>
          </div>
          <button type="submit" disabled={accounts.filter((a) => a.is_active).length < 2}>Record transfer</button>
        </form>
        {accounts.filter((a) => a.is_active).length < 2 && (
          <p className="muted">Add at least two active cash accounts to transfer between them.</p>
        )}

        <table style={{ marginTop: '1rem' }}>
          <thead><tr><th>Date</th><th>From</th><th>To</th><th>Amount</th><th>Description</th><th></th></tr></thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.transfer_date}</td>
                <td>{t.from_account_name || '—'}</td>
                <td>{t.to_account_name || '—'}</td>
                <td>{formatMoney(t.amount)}</td>
                <td>{t.description || '—'}</td>
                <td><button type="button" onClick={() => removeTransfer(t.id)}>Delete</button></td>
              </tr>
            ))}
            {transfers.length === 0 && (
              <tr><td colSpan="6" className="muted">No transfers recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Account activity</h2>
        <p className="muted">Chronological running balance for a single account, built from every posted transaction affecting it.</p>
        <label>Account
          <select value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)}>
            <option value="">Select an account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </select>
        </label>
        {ledgerData && (
          <>
            <div className="stat-grid" style={{ marginTop: '0.75rem' }}>
              <div className="stat-card"><div className="stat-label">Posted balance</div><div className="stat-value">{formatMoney(ledgerData.postedBalance)}</div></div>
              <div className="stat-card"><div className="stat-label">Projected balance</div><div className="stat-value">{formatMoney(ledgerData.projectedBalance)}</div></div>
            </div>
            <table style={{ marginTop: '1rem' }}>
              <thead><tr><th>Date</th><th>Description</th><th>Direction</th><th>Amount</th><th>Running balance</th></tr></thead>
              <tbody>
                {ledgerData.history.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.entry_date}</td>
                    <td>{entry.description || entry.category || '—'}</td>
                    <td>{entry.direction.replace('_', ' ')}</td>
                    <td>{formatMoney(entry.amount)}</td>
                    <td>{formatMoney(entry.running_balance)}</td>
                  </tr>
                ))}
                {ledgerData.history.length === 0 && (
                  <tr><td colSpan="5" className="muted">No posted activity yet for this account.</td></tr>
                )}
              </tbody>
            </table>
            {ledgerData.pending.length > 0 && (
              <>
                <h3 style={{ marginTop: '1rem' }}>Pending (future-dated)</h3>
                <table>
                  <thead><tr><th>Date</th><th>Description</th><th>Direction</th><th>Amount</th></tr></thead>
                  <tbody>
                    {ledgerData.pending.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.entry_date}</td>
                        <td>{entry.description || entry.category || '—'}</td>
                        <td>{entry.direction.replace('_', ' ')}</td>
                        <td>{formatMoney(entry.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Investment &amp; retirement accounts (Tier 4 &amp; 5)</h2>
        <p className="muted">
          These are managed on the <Link to="/investments">Investments</Link> page since they already track holdings and
          market value there — no need to re-enter them here.
        </p>
        {investmentTiers.map((tier) => {
          const tierAccounts = investmentAccounts.filter((a) => a.tier === tier.tier);
          if (tierAccounts.length === 0) return null;
          const summaryTier = summary?.tiers?.[`tier${tier.tier}`];
          return (
            <div key={tier.tier} style={{ marginBottom: '0.75rem' }}>
              <strong>{tier.label}</strong> — total value {formatMoney(summaryTier?.total || 0)}
              <ul className="rule-list">
                {tierAccounts.map((a) => {
                  const breakdown = summaryTier?.accounts?.find((row) => row.id === a.id);
                  return (
                    <li key={a.id}>
                      {a.account_name} — {tier.types.find((t) => t.value === a.account_type)?.label || a.account_type}
                      {a.institution ? ` (${a.institution})` : ''} — {formatMoney(breakdown?.current_value || 0)}
                      {a.configWarning && <span className="muted"> (unrecognized type, defaulted to Restricted)</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {investmentAccounts.length === 0 && <p className="muted">No investment or retirement accounts added yet.</p>}
      </div>

      <div className="card">
        <h2>Paychecks awaiting a destination</h2>
        <table>
          <thead><tr><th>Pay date</th><th>Employer</th><th>Net pay</th><th>Allocated</th><th>Remaining</th></tr></thead>
          <tbody>
            {pendingPaychecks.map((p) => (
              <tr key={p.id}>
                <td>{p.pay_date}</td>
                <td>{p.employer}</td>
                <td>{formatMoney(p.net_pay)}</td>
                <td>{formatMoney(p.allocated_amount)}</td>
                <td>{formatMoney(p.remaining_amount)}</td>
              </tr>
            ))}
            {pendingPaychecks.length === 0 && (
              <tr><td colSpan="5" className="muted">No paychecks currently need a destination.</td></tr>
            )}
          </tbody>
        </table>

        {selectedPaycheck && accounts.length > 0 && (
          <form onSubmit={submitAllocation('/cash-accounts/paycheck-allocations', paycheckAllocForm, setPaycheckAllocForm)}>
            <label>Paycheck
              <select value={paycheckAllocForm.sourceId} onChange={(e) => setPaycheckAllocForm({ ...paycheckAllocForm, sourceId: e.target.value })}>
                <option value="">Select paycheck</option>
                {pendingPaychecks.map((p) => (
                  <option key={p.id} value={p.id}>{p.pay_date} — {formatMoney(p.remaining_amount)} remaining</option>
                ))}
              </select>
            </label>
            <p className="muted">Remaining to allocate: {formatMoney(selectedPaycheck.remaining_amount)}.</p>
            {paycheckAllocForm.destinations.map((row, index) => (
              <div className="row" key={index}>
                <label>Destination account
                  <select required value={row.cashAccountId} onChange={(e) => updateDestination(setPaycheckAllocForm)(index, 'cashAccountId', e.target.value)}>
                    <option value="">Select account</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name} ({a.account_type})</option>)}
                  </select>
                </label>
                <label>Amount
                  <input type="number" step="0.01" required value={row.amount} onChange={(e) => updateDestination(setPaycheckAllocForm)(index, 'amount', e.target.value)} />
                </label>
                <div style={{ alignSelf: 'end' }}>
                  <button type="button" onClick={() => removeDestinationRow(setPaycheckAllocForm)(index)}>Remove</button>
                </div>
              </div>
            ))}
            <div className="row">
              <button type="button" onClick={addDestinationRow(setPaycheckAllocForm)}>Add another destination</button>
              <button type="submit">Allocate funds</button>
            </div>
          </form>
        )}
        {accounts.length === 0 && <p className="muted">Add a cash account above to start splitting paycheck deposits.</p>}
      </div>

      <div className="card">
        <h2>Other income awaiting a destination</h2>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Allocated</th><th>Remaining</th></tr></thead>
          <tbody>
            {pendingOtherIncome.map((oi) => (
              <tr key={oi.id}>
                <td>{oi.income_date}</td>
                <td>{oi.description || oi.category}</td>
                <td>{formatMoney(oi.amount)}</td>
                <td>{formatMoney(oi.allocated_amount)}</td>
                <td>{formatMoney(oi.remaining_amount)}</td>
              </tr>
            ))}
            {pendingOtherIncome.length === 0 && (
              <tr><td colSpan="5" className="muted">No other income entries currently need a destination.</td></tr>
            )}
          </tbody>
        </table>

        {selectedOtherIncome && accounts.length > 0 && (
          <form onSubmit={submitAllocation('/cash-accounts/other-income-allocations', incomeAllocForm, setIncomeAllocForm)}>
            <label>Other income entry
              <select value={incomeAllocForm.sourceId} onChange={(e) => setIncomeAllocForm({ ...incomeAllocForm, sourceId: e.target.value })}>
                <option value="">Select entry</option>
                {pendingOtherIncome.map((oi) => (
                  <option key={oi.id} value={oi.id}>{oi.income_date} — {formatMoney(oi.remaining_amount)} remaining</option>
                ))}
              </select>
            </label>
            <p className="muted">Remaining to allocate: {formatMoney(selectedOtherIncome.remaining_amount)}.</p>
            {incomeAllocForm.destinations.map((row, index) => (
              <div className="row" key={index}>
                <label>Destination account
                  <select required value={row.cashAccountId} onChange={(e) => updateDestination(setIncomeAllocForm)(index, 'cashAccountId', e.target.value)}>
                    <option value="">Select account</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name} ({a.account_type})</option>)}
                  </select>
                </label>
                <label>Amount
                  <input type="number" step="0.01" required value={row.amount} onChange={(e) => updateDestination(setIncomeAllocForm)(index, 'amount', e.target.value)} />
                </label>
                <div style={{ alignSelf: 'end' }}>
                  <button type="button" onClick={() => removeDestinationRow(setIncomeAllocForm)(index)}>Remove</button>
                </div>
              </div>
            ))}
            <div className="row">
              <button type="button" onClick={addDestinationRow(setIncomeAllocForm)}>Add another destination</button>
              <button type="submit">Allocate funds</button>
            </div>
          </form>
        )}
        {accounts.length === 0 && <p className="muted">Add a cash account above to start splitting other income.</p>}
      </div>

      <div className="card">
        <h2>Allocation history</h2>
        <table>
          <thead><tr><th>Source</th><th>Account</th><th>Amount</th><th></th></tr></thead>
          <tbody>
            {allocations.map((a) => (
              <tr key={a.id}>
                <td>{a.source_type === 'paycheck' ? 'Paycheck' : 'Other income'} #{a.source_id}</td>
                <td>{a.account_name ? `${a.account_name} (${a.account_type})` : accountLabel(a.cash_account_id)}</td>
                <td>{formatMoney(a.amount)}</td>
                <td><button type="button" onClick={() => removeAllocation(a.id)}>Delete</button></td>
              </tr>
            ))}
            {allocations.length === 0 && (
              <tr><td colSpan="4" className="muted">No allocations recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
