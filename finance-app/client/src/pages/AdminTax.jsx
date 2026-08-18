import { useEffect, useState } from 'react';
import api from '../api/client';
import { formatMoney } from '../utils/format';

const FILING_STATUS_LABELS = {
  single: 'Single',
  married_joint: 'Married filing jointly',
  married_separate: 'Married filing separately',
  head_of_household: 'Head of household',
};

const TAX_TYPES = [
  { value: 'state_income', label: 'State income tax' },
  { value: 'additional', label: 'Additional (e.g. FAMLI)' },
  { value: 'local', label: 'Local tax' },
];

export default function AdminTax() {
  const [years, setYears] = useState([]);
  const [year, setYear] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [settingsForm, setSettingsForm] = useState(null);
  const [deductionForm, setDeductionForm] = useState({});
  const [bracketForms, setBracketForms] = useState({});
  const [newYear, setNewYear] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');
  const [stateTaxForm, setStateTaxForm] = useState({ stateCode: '', taxName: '', taxType: 'additional', rate: '', wageBase: '' });

  const loadYears = () => api.get('/admin/tax/years').then((res) => {
    setYears(res.data.years);
    if (!year && res.data.years.length > 0) setYear(res.data.years[0]);
  });

  const loadConfig = (y) => {
    if (!y) return;
    api.get(`/admin/tax/years/${y}`).then((res) => {
      setConfig(res.data);
      setSettingsForm({
        socialSecurityRate: res.data.year.social_security_rate,
        socialSecurityWageBase: res.data.year.social_security_wage_base,
        medicareRate: res.data.year.medicare_rate,
        additionalMedicareRate: res.data.year.additional_medicare_rate,
        additionalMedicareThreshold: res.data.year.additional_medicare_threshold,
        mileageRate: res.data.year.mileage_rate,
        capitalGainsRate: res.data.year.capital_gains_rate,
        selfEmploymentRate: res.data.year.self_employment_rate,
        childTaxCredit: res.data.year.child_tax_credit,
        defaultStateRate: res.data.year.default_state_rate,
      });
      setDeductionForm({ ...res.data.standardDeductions });
      const bf = {};
      for (const status of Object.keys(res.data.brackets)) {
        bf[status] = res.data.brackets[status].map(([upto, rate]) => ({
          uptoIncome: upto === Infinity ? '' : upto,
          rate,
        }));
      }
      setBracketForms(bf);
    }).catch((err) => setError(err.response?.data?.error || 'Failed to load tax year'));
  };

  useEffect(() => { loadYears(); }, []);
  useEffect(() => { if (year) loadConfig(year); }, [year]);

  const flash = (msg) => { setMessage(msg); setError(''); setTimeout(() => setMessage(''), 3000); };

  const saveSettings = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/admin/tax/years/${year}`, settingsForm);
      flash('Tax year settings saved.');
      loadConfig(year);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings');
    }
  };

  const saveDeduction = async (status) => {
    try {
      await api.put(`/admin/tax/years/${year}/standard-deductions`, { filingStatus: status, amount: Number(deductionForm[status]) });
      flash(`Standard deduction updated for ${FILING_STATUS_LABELS[status]}.`);
      loadConfig(year);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save deduction');
    }
  };

  const updateBracketRow = (status, idx, field, value) => {
    setBracketForms((prev) => {
      const rows = [...prev[status]];
      rows[idx] = { ...rows[idx], [field]: value };
      return { ...prev, [status]: rows };
    });
  };

  const addBracketRow = (status) => {
    setBracketForms((prev) => ({ ...prev, [status]: [...prev[status], { uptoIncome: '', rate: '' }] }));
  };

  const removeBracketRow = (status, idx) => {
    setBracketForms((prev) => ({ ...prev, [status]: prev[status].filter((_, i) => i !== idx) }));
  };

  const saveBrackets = async (status) => {
    try {
      const brackets = bracketForms[status].map((b) => ({
        uptoIncome: b.uptoIncome === '' ? null : Number(b.uptoIncome),
        rate: Number(b.rate),
      }));
      await api.put(`/admin/tax/years/${year}/brackets/${status}`, { brackets });
      flash(`Brackets updated for ${FILING_STATUS_LABELS[status]}.`);
      loadConfig(year);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save brackets');
    }
  };

  const createYear = async (e) => {
    e.preventDefault();
    if (!newYear) return;
    try {
      await api.post('/admin/tax/years', { taxYear: Number(newYear), cloneFrom: cloneFrom || undefined });
      flash(`Tax year ${newYear} created.`);
      setNewYear(''); setCloneFrom('');
      await loadYears();
      setYear(Number(newYear));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create tax year');
    }
  };

  const deleteYear = async (y) => {
    if (!window.confirm(`Delete all tax configuration for ${y}? This cannot be undone.`)) return;
    await api.delete(`/admin/tax/years/${y}`);
    await loadYears();
    if (year === y) setYear(null);
  };

  const addStateTax = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/admin/tax/years/${year}/state-taxes`, {
        ...stateTaxForm,
        rate: Number(stateTaxForm.rate),
        wageBase: stateTaxForm.wageBase ? Number(stateTaxForm.wageBase) : null,
      });
      setStateTaxForm({ stateCode: '', taxName: '', taxType: 'additional', rate: '', wageBase: '' });
      flash('State/local tax added.');
      loadConfig(year);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add state tax');
    }
  };

  const removeStateTax = async (id) => {
    await api.delete(`/admin/tax/state-taxes/${id}`);
    loadConfig(year);
  };

  return (
    <div>
      <h1>Tax Configuration</h1>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <div className="card">
        <h2>Tax years</h2>
        <div className="row" style={{ alignItems: 'center' }}>
          <label>Active year
            <select value={year || ''} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          {year && <button type="button" className="danger" onClick={() => deleteYear(year)}>Delete this year</button>}
        </div>
        <form onSubmit={createYear}>
          <div className="row">
            <label>New tax year<input type="number" value={newYear} onChange={(e) => setNewYear(e.target.value)} placeholder="e.g. 2028" /></label>
            <label>Clone settings from (optional)
              <select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
                <option value="">Start blank</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>
          <button type="submit">Add tax year</button>
        </form>
      </div>

      {config && settingsForm && (
        <>
          <form className="card" onSubmit={saveSettings}>
            <h2>Rates for {year}</h2>
            <div className="row">
              <label>Social Security rate (%)
                <input type="number" step="0.0001" value={settingsForm.socialSecurityRate}
                  onChange={(e) => setSettingsForm({ ...settingsForm, socialSecurityRate: e.target.value })} />
              </label>
              <label>Social Security wage base ($)
                <input type="number" step="1" value={settingsForm.socialSecurityWageBase}
                  onChange={(e) => setSettingsForm({ ...settingsForm, socialSecurityWageBase: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label>Medicare rate (%)
                <input type="number" step="0.0001" value={settingsForm.medicareRate}
                  onChange={(e) => setSettingsForm({ ...settingsForm, medicareRate: e.target.value })} />
              </label>
              <label>Additional Medicare rate (%)
                <input type="number" step="0.0001" value={settingsForm.additionalMedicareRate}
                  onChange={(e) => setSettingsForm({ ...settingsForm, additionalMedicareRate: e.target.value })} />
              </label>
              <label>Additional Medicare threshold ($)
                <input type="number" step="1" value={settingsForm.additionalMedicareThreshold}
                  onChange={(e) => setSettingsForm({ ...settingsForm, additionalMedicareThreshold: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label>Capital gains rate (%)
                <input type="number" step="0.0001" value={settingsForm.capitalGainsRate}
                  onChange={(e) => setSettingsForm({ ...settingsForm, capitalGainsRate: e.target.value })} />
              </label>
              <label>Self-employment tax rate (%)
                <input type="number" step="0.0001" value={settingsForm.selfEmploymentRate}
                  onChange={(e) => setSettingsForm({ ...settingsForm, selfEmploymentRate: e.target.value })} />
              </label>
              <label>Standard mileage rate ($/mi)
                <input type="number" step="0.01" value={settingsForm.mileageRate}
                  onChange={(e) => setSettingsForm({ ...settingsForm, mileageRate: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label>Child tax credit ($/dependent)
                <input type="number" step="1" value={settingsForm.childTaxCredit}
                  onChange={(e) => setSettingsForm({ ...settingsForm, childTaxCredit: e.target.value })} />
              </label>
              <label>Default state rate (%, used when no state configured below)
                <input type="number" step="0.0001" value={settingsForm.defaultStateRate}
                  onChange={(e) => setSettingsForm({ ...settingsForm, defaultStateRate: e.target.value })} />
              </label>
            </div>
            <button type="submit">Save rates</button>
          </form>

          <div className="card">
            <h2>Standard deductions by filing status ({year})</h2>
            <table>
              <thead><tr><th>Filing status</th><th>Standard deduction</th><th></th></tr></thead>
              <tbody>
                {Object.keys(FILING_STATUS_LABELS).map((status) => (
                  <tr key={status}>
                    <td>{FILING_STATUS_LABELS[status]}</td>
                    <td>
                      <input type="number" step="1" value={deductionForm[status] ?? ''}
                        onChange={(e) => setDeductionForm({ ...deductionForm, [status]: e.target.value })} />
                    </td>
                    <td><button onClick={() => saveDeduction(status)}>Save</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Federal income tax brackets ({year})</h2>
            {Object.keys(FILING_STATUS_LABELS).map((status) => (
              <div key={status} style={{ marginBottom: '1.5rem' }}>
                <h3>{FILING_STATUS_LABELS[status]}</h3>
                <table>
                  <thead><tr><th>Up to income ($, blank = no limit)</th><th>Rate (%)</th><th></th></tr></thead>
                  <tbody>
                    {(bracketForms[status] || []).map((b, idx) => (
                      <tr key={idx}>
                        <td>
                          <input type="number" step="1" value={b.uptoIncome}
                            placeholder="No limit"
                            onChange={(e) => updateBracketRow(status, idx, 'uptoIncome', e.target.value)} />
                        </td>
                        <td>
                          <input type="number" step="0.0001" value={b.rate}
                            onChange={(e) => updateBracketRow(status, idx, 'rate', e.target.value)} />
                        </td>
                        <td><button onClick={() => removeBracketRow(status, idx)}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" onClick={() => addBracketRow(status)}>Add bracket</button>{' '}
                <button type="button" onClick={() => saveBrackets(status)}>Save brackets</button>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>State &amp; local taxes ({year})</h2>
            <p>Add per-state income taxes plus additional/local taxes like Colorado FAMLI or city payroll taxes.</p>
            <form onSubmit={addStateTax}>
              <div className="row">
                <label>State code<input required maxLength={2} value={stateTaxForm.stateCode} onChange={(e) => setStateTaxForm({ ...stateTaxForm, stateCode: e.target.value.toUpperCase() })} placeholder="e.g. CO" /></label>
                <label>Tax name<input required value={stateTaxForm.taxName} onChange={(e) => setStateTaxForm({ ...stateTaxForm, taxName: e.target.value })} placeholder="e.g. FAMLI" /></label>
                <label>Type
                  <select value={stateTaxForm.taxType} onChange={(e) => setStateTaxForm({ ...stateTaxForm, taxType: e.target.value })}>
                    {TAX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="row">
                <label>Rate (%)<input required type="number" step="0.0001" value={stateTaxForm.rate} onChange={(e) => setStateTaxForm({ ...stateTaxForm, rate: e.target.value })} /></label>
                <label>Wage base cap ($, optional)<input type="number" step="1" value={stateTaxForm.wageBase} onChange={(e) => setStateTaxForm({ ...stateTaxForm, wageBase: e.target.value })} /></label>
              </div>
              <button type="submit">Add tax</button>
            </form>

            {config.stateTaxes.length > 0 && (
              <table>
                <thead><tr><th>State</th><th>Name</th><th>Type</th><th>Rate</th><th>Wage base</th><th></th></tr></thead>
                <tbody>
                  {config.stateTaxes.map((t) => (
                    <tr key={t.id}>
                      <td>{t.state_code}</td>
                      <td>{t.tax_name}</td>
                      <td>{TAX_TYPES.find((tt) => tt.value === t.tax_type)?.label || t.tax_type}</td>
                      <td>{(t.rate * 100).toFixed(2)}%</td>
                      <td>{t.wage_base ? formatMoney(t.wage_base) : '—'}</td>
                      <td><button onClick={() => removeStateTax(t.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
