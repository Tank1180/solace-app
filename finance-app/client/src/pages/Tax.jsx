import { useEffect, useState } from 'react';
import api from '../api/client';
import { formatMoney } from '../utils/format';

const DEDUCTION_CATEGORIES = [
  { value: 'charity', label: 'Charity' },
  { value: 'business_expense', label: 'Business expense' },
  { value: 'mileage', label: 'Mileage' },
  { value: 'home_office', label: 'Home office' },
];

const FILING_STATUS_LABELS = {
  single: 'Single',
  married_joint: 'Married filing jointly',
  married_separate: 'Married filing separately',
  head_of_household: 'Head of household',
};

const currentYear = new Date().getFullYear();
const YEARS = [currentYear, currentYear - 1, currentYear - 2];

export default function Tax() {
  const [year, setYear] = useState(currentYear);
  const [profile, setProfile] = useState(null);
  const [projection, setProjection] = useState(null);
  const [deductions, setDeductions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [dedForm, setDedForm] = useState({ dedDate: '', category: 'charity', description: '', amount: '', miles: '' });
  const [scenario, setScenario] = useState({ filingStatus: '', extraRetirementContribution: '', extraWithholding: '', extraDeductions: '' });
  const [scenarioResult, setScenarioResult] = useState(null);

  const loadAll = () => {
    api.get('/tax/profile').then((res) => setProfile(res.data));
    api.get(`/tax/projection?year=${year}`).then((res) => setProjection(res.data));
    api.get(`/tax/deductions?year=${year}`).then((res) => setDeductions(res.data.deductions));
  };
  useEffect(() => { loadAll(); setSummary(null); setScenarioResult(null); }, [year]);

  const saveFilingStatus = async (e) => {
    const filingStatus = e.target.value;
    setError(''); setMessage('');
    try {
      await api.put('/tax/profile', { filingStatus });
      setMessage('Filing status updated.');
      loadAll();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update filing status');
    }
  };

  const addDeduction = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/tax/deductions', {
        ...dedForm,
        amount: dedForm.amount ? Number(dedForm.amount) : 0,
        miles: dedForm.miles ? Number(dedForm.miles) : null,
      });
      setDedForm({ dedDate: '', category: 'charity', description: '', amount: '', miles: '' });
      loadAll();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add deduction');
    }
  };

  const removeDeduction = async (id) => {
    await api.delete(`/tax/deductions/${id}`);
    loadAll();
  };

  const runSimulation = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post('/tax/simulate', {
        year,
        filingStatus: scenario.filingStatus || undefined,
        extraRetirementContribution: scenario.extraRetirementContribution ? Number(scenario.extraRetirementContribution) : 0,
        extraWithholding: scenario.extraWithholding ? Number(scenario.extraWithholding) : 0,
        extraDeductions: scenario.extraDeductions ? Number(scenario.extraDeductions) : 0,
      });
      setScenarioResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to run simulation');
    }
  };

  const generateSummary = async () => {
    setError('');
    try {
      const res = await api.get(`/tax/summary?year=${year}`);
      setSummary(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate summary');
    }
  };

  const downloadSummary = () => {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `tax-summary-${year}.json`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div>
      <h1>Tax Center</h1>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <div className="row" style={{ alignItems: 'center', marginBottom: '1rem' }}>
        <label>Tax year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        {profile && (
          <label>Filing status
            <select value={profile.filingStatus} onChange={saveFilingStatus}>
              {profile.availableFilingStatuses.map((fs) => (
                <option key={fs} value={fs}>{FILING_STATUS_LABELS[fs]}</option>
              ))}
            </select>
          </label>
        )}
        {profile && <span>State of residence (from profile): <strong>{profile.state || 'Not set'}</strong></span>}
        {profile && <span>Dependents: <strong>{profile.numDependents}</strong></span>}
        {profile?.filingStatus === 'married_joint' && (
          <span>Spouse paychecks marked in Paychecks are included in this joint projection.</span>
        )}
      </div>
      {!profile?.state && (
        <div className="error">
          No state of residence set. Add your address on the Profile page so state tax can be estimated.
        </div>
      )}

      {projection && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Projected federal tax</div>
            <div className="stat-value">{formatMoney(projection.projection.federalTax)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Projected state tax</div>
            <div className="stat-value">{formatMoney(projection.projection.stateTax)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Payroll tax (SS + Medicare)</div>
            <div className="stat-value">{formatMoney(projection.projection.payrollTax)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total projected liability</div>
            <div className="stat-value">{formatMoney(projection.projection.totalLiability)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Withheld / paid so far</div>
            <div className="stat-value">{formatMoney(projection.projection.totalWithheld)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Balance due / (refund)</div>
            <div className="stat-value">{formatMoney(projection.projection.balanceDue)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Quarterly estimated payment</div>
            <div className="stat-value">{formatMoney(projection.quarterlyEstimatedPayment)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Effective tax rate</div>
            <div className="stat-value">{projection.projection.effectiveRate}%</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Deduction used</div>
            <div className="stat-value">{formatMoney(projection.projection.deductionUsed)}{projection.projection.itemizing ? ' (itemized)' : ' (standard)'}</div>
          </div>
        </div>
      )}

      {projection && projection.projection.stateTaxBreakdown.length > 0 && (
        <div className="card">
          <h2>State &amp; local tax breakdown</h2>
          <table>
            <thead><tr><th>Tax</th><th>Rate</th><th>Amount</th></tr></thead>
            <tbody>
              {projection.projection.stateTaxBreakdown.map((t, i) => (
                <tr key={i}>
                  <td>{t.name}</td>
                  <td>{(t.rate * 100).toFixed(2)}%</td>
                  <td>{formatMoney(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Tax-deductible expenses</h2>
        <p>Track charity, business expenses, mileage, and home office deductions for {year}.</p>
        <form onSubmit={addDeduction}>
          <div className="row">
            <label>Date<input type="date" required value={dedForm.dedDate} onChange={(e) => setDedForm({ ...dedForm, dedDate: e.target.value })} /></label>
            <label>Category
              <select value={dedForm.category} onChange={(e) => setDedForm({ ...dedForm, category: e.target.value })}>
                {DEDUCTION_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <label>Description<input value={dedForm.description} onChange={(e) => setDedForm({ ...dedForm, description: e.target.value })} /></label>
          {dedForm.category === 'mileage' ? (
            <label>Miles driven<input type="number" step="0.1" value={dedForm.miles} onChange={(e) => setDedForm({ ...dedForm, miles: e.target.value })} /></label>
          ) : (
            <label>Amount<input type="number" step="0.01" value={dedForm.amount} onChange={(e) => setDedForm({ ...dedForm, amount: e.target.value })} /></label>
          )}
          <button type="submit">Add deduction</button>
        </form>

        {deductions.length > 0 && (
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead>
            <tbody>
              {deductions.map((d) => (
                <tr key={d.id}>
                  <td>{d.ded_date}</td>
                  <td>{DEDUCTION_CATEGORIES.find((c) => c.value === d.category)?.label || d.category}</td>
                  <td>{d.description || (d.miles ? `${d.miles} miles` : '—')}</td>
                  <td>{formatMoney(d.amount)}</td>
                  <td><button onClick={() => removeDeduction(d.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Simulate a tax scenario</h2>
        <p>See how changes to withholding, retirement contributions, or filing status would affect your projected liability for {year}.</p>
        <form onSubmit={runSimulation}>
          <div className="row">
            <label>Filing status (optional)
              <select value={scenario.filingStatus} onChange={(e) => setScenario({ ...scenario, filingStatus: e.target.value })}>
                <option value="">Keep current</option>
                {Object.entries(FILING_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Extra retirement contribution<input type="number" step="0.01" value={scenario.extraRetirementContribution} onChange={(e) => setScenario({ ...scenario, extraRetirementContribution: e.target.value })} /></label>
          </div>
          <div className="row">
            <label>Extra federal withholding<input type="number" step="0.01" value={scenario.extraWithholding} onChange={(e) => setScenario({ ...scenario, extraWithholding: e.target.value })} /></label>
            <label>Extra deductions<input type="number" step="0.01" value={scenario.extraDeductions} onChange={(e) => setScenario({ ...scenario, extraDeductions: e.target.value })} /></label>
          </div>
          <button type="submit">Run simulation</button>
        </form>

        {scenarioResult && projection && (
          <table>
            <thead><tr><th></th><th>Current</th><th>Scenario</th><th>Difference</th></tr></thead>
            <tbody>
              <tr>
                <td>Total liability</td>
                <td>{formatMoney(projection.projection.totalLiability)}</td>
                <td>{formatMoney(scenarioResult.projection.totalLiability)}</td>
                <td>{formatMoney(scenarioResult.projection.totalLiability - projection.projection.totalLiability)}</td>
              </tr>
              <tr>
                <td>Balance due / (refund)</td>
                <td>{formatMoney(projection.projection.balanceDue)}</td>
                <td>{formatMoney(scenarioResult.projection.balanceDue)}</td>
                <td>{formatMoney(scenarioResult.projection.balanceDue - projection.projection.balanceDue)}</td>
              </tr>
              <tr>
                <td>Effective rate</td>
                <td>{projection.projection.effectiveRate}%</td>
                <td>{scenarioResult.projection.effectiveRate}%</td>
                <td>{(scenarioResult.projection.effectiveRate - projection.projection.effectiveRate).toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Tax-ready summary</h2>
        <p>Generate a summary of income, deductions, and investment gains for {year} to hand to a tax professional.</p>
        <button onClick={generateSummary}>Generate summary</button>
        {summary && (
          <>
            <button onClick={downloadSummary} style={{ marginLeft: '0.5rem' }}>Download JSON</button>
            <div style={{ marginTop: '1rem' }}>
              <h3>Income</h3>
              <ul>
                <li>Gross wages: {formatMoney(summary.income.grossWages)}</li>
                <li>Dividend income: {formatMoney(summary.income.dividendIncome)}</li>
                <li>Investment gains: {formatMoney(summary.income.investmentGains)}</li>
                <li>Other income (total): {formatMoney(summary.income.otherIncomeTotal)}</li>
                <li>Other income (taxable, non-SE): {formatMoney(summary.income.taxableOtherIncome)}</li>
                <li>Other income (self-employment, taxable): {formatMoney(summary.income.selfEmploymentOtherIncome)}</li>
                <li>Other income (non-taxable, not counted): {formatMoney(summary.income.nonTaxableOtherIncome)}</li>
                <li>Total income: {formatMoney(summary.income.totalIncome)}</li>
              </ul>
              {summary.income.otherIncomeByCategory && summary.income.otherIncomeByCategory.length > 0 && (
                <>
                  <h3>Other income detail</h3>
                  <table>
                    <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Taxable</th></tr></thead>
                    <tbody>
                      {summary.income.otherIncomeByCategory.map((i, idx) => (
                        <tr key={idx}>
                          <td>{i.date}</td>
                          <td>{i.category}</td>
                          <td>{i.description}</td>
                          <td>{formatMoney(i.amount)}</td>
                          <td>{i.taxable ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <h3>Deductions</h3>
              <ul>
                <li>Standard deduction: {formatMoney(summary.deductions.standardDeduction)}</li>
                <li>Itemized total: {formatMoney(summary.deductions.itemizedTotal)}</li>
                <li>Deduction used: {formatMoney(summary.deductions.deductionUsed)} ({summary.deductions.itemizing ? 'itemized' : 'standard'})</li>
                <li>Retirement contributions: {formatMoney(summary.deductions.retirementContributions)}</li>
              </ul>
              <h3>Investment gains</h3>
              {summary.investments.realizedGains.length > 0 ? (
                <table>
                  <thead><tr><th>Symbol</th><th>Purchase</th><th>Sale</th><th>Gain</th></tr></thead>
                  <tbody>
                    {summary.investments.realizedGains.map((g, i) => (
                      <tr key={i}>
                        <td>{g.symbol}</td>
                        <td>{g.purchaseDate}</td>
                        <td>{g.saleDate}</td>
                        <td>{formatMoney(g.gain)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p>No realized gains for {year}.</p>}
              <h3>Tax liability</h3>
              <ul>
                <li>Federal tax: {formatMoney(summary.taxLiability.federalTax)}</li>
                <li>State tax: {formatMoney(summary.taxLiability.stateTax)}</li>
                <li>Total liability: {formatMoney(summary.taxLiability.totalLiability)}</li>
                <li>Withheld/paid: {formatMoney(summary.withholding.federal + summary.withholding.state)}</li>
                <li>Balance due / (refund): {formatMoney(summary.taxLiability.balanceDue)}</li>
              </ul>
            </div>
          </>
        )}
      </div>

      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        Estimates use simplified federal brackets and flat state rates for planning purposes only — this is not tax advice.
        Consult a tax professional for filing.
      </p>
    </div>
  );
}
