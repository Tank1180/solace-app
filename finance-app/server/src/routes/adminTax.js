import { Router } from 'express';
import db from '../db/index.js';
import { authRequired, adminRequired } from '../auth.js';
import { getTaxYearConfig, getAvailableTaxYears, FILING_STATUSES } from '../lib/taxEngine.js';

const router = Router();
router.use(authRequired, adminRequired);

router.get('/years', (req, res) => {
  res.json({ years: getAvailableTaxYears() });
});

router.get('/years/:year', (req, res) => {
  const config = getTaxYearConfig(Number(req.params.year));
  if (!config) return res.status(404).json({ error: 'Tax year not configured' });
  res.json(config);
});

// Create a new tax year, optionally cloned from an existing one.
router.post('/years', (req, res) => {
  const { taxYear, cloneFrom } = req.body || {};
  const year = Number(taxYear);
  if (!year) return res.status(400).json({ error: 'taxYear is required' });
  const existing = db.prepare('SELECT tax_year FROM tax_years WHERE tax_year = ?').get(year);
  if (existing) return res.status(409).json({ error: `Tax year ${year} already exists` });

  const source = cloneFrom ? getTaxYearConfig(Number(cloneFrom)) : null;

  const tx = db.transaction(() => {
    if (source) {
      db.prepare(`
        INSERT INTO tax_years (tax_year, social_security_rate, social_security_wage_base, medicare_rate,
          additional_medicare_rate, additional_medicare_threshold, mileage_rate, capital_gains_rate,
          self_employment_rate, child_tax_credit, default_state_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        year, source.year.social_security_rate, source.year.social_security_wage_base, source.year.medicare_rate,
        source.year.additional_medicare_rate, source.year.additional_medicare_threshold, source.year.mileage_rate,
        source.year.capital_gains_rate, source.year.self_employment_rate, source.year.child_tax_credit,
        source.year.default_state_rate
      );
      const insertDeduction = db.prepare('INSERT INTO tax_standard_deductions (tax_year, filing_status, amount) VALUES (?, ?, ?)');
      for (const [status, amount] of Object.entries(source.standardDeductions)) insertDeduction.run(year, status, amount);

      const insertBracket = db.prepare('INSERT INTO tax_brackets (tax_year, filing_status, seq, upto_income, rate) VALUES (?, ?, ?, ?, ?)');
      for (const [status, rows] of Object.entries(source.brackets)) {
        rows.forEach(([upto, rate], seq) => insertBracket.run(year, status, seq, upto === Infinity ? null : upto, rate));
      }

      const insertState = db.prepare('INSERT INTO tax_state_taxes (tax_year, state_code, tax_name, tax_type, rate, wage_base) VALUES (?, ?, ?, ?, ?, ?)');
      for (const t of source.stateTaxes) insertState.run(year, t.state_code, t.tax_name, t.tax_type, t.rate, t.wage_base);
    } else {
      db.prepare(`
        INSERT INTO tax_years (tax_year, social_security_rate, social_security_wage_base, medicare_rate,
          additional_medicare_rate, additional_medicare_threshold, mileage_rate, capital_gains_rate,
          self_employment_rate, child_tax_credit, default_state_rate)
        VALUES (?, 0.062, 168600, 0.0145, 0.009, 200000, 0.67, 0.15, 0.153, 2000, 0.05)
      `).run(year);
      const insertDeduction = db.prepare('INSERT INTO tax_standard_deductions (tax_year, filing_status, amount) VALUES (?, ?, 0)');
      for (const status of FILING_STATUSES) insertDeduction.run(year, status);
    }
  });
  tx();

  res.status(201).json(getTaxYearConfig(year));
});

// Update the scalar tax-year settings (SS/Medicare rates, mileage rate, cap gains rate, etc).
router.put('/years/:year', (req, res) => {
  const year = Number(req.params.year);
  const existing = db.prepare('SELECT * FROM tax_years WHERE tax_year = ?').get(year);
  if (!existing) return res.status(404).json({ error: 'Tax year not configured' });

  const {
    socialSecurityRate, socialSecurityWageBase, medicareRate, additionalMedicareRate,
    additionalMedicareThreshold, mileageRate, capitalGainsRate, selfEmploymentRate,
    childTaxCredit, defaultStateRate,
  } = req.body || {};

  db.prepare(`
    UPDATE tax_years SET social_security_rate = ?, social_security_wage_base = ?, medicare_rate = ?,
      additional_medicare_rate = ?, additional_medicare_threshold = ?, mileage_rate = ?, capital_gains_rate = ?,
      self_employment_rate = ?, child_tax_credit = ?, default_state_rate = ?, updated_at = datetime('now')
    WHERE tax_year = ?
  `).run(
    socialSecurityRate ?? existing.social_security_rate, socialSecurityWageBase ?? existing.social_security_wage_base,
    medicareRate ?? existing.medicare_rate, additionalMedicareRate ?? existing.additional_medicare_rate,
    additionalMedicareThreshold ?? existing.additional_medicare_threshold, mileageRate ?? existing.mileage_rate,
    capitalGainsRate ?? existing.capital_gains_rate, selfEmploymentRate ?? existing.self_employment_rate,
    childTaxCredit ?? existing.child_tax_credit, defaultStateRate ?? existing.default_state_rate,
    year
  );

  res.json(getTaxYearConfig(year));
});

router.delete('/years/:year', (req, res) => {
  db.prepare('DELETE FROM tax_years WHERE tax_year = ?').run(Number(req.params.year));
  res.json({ success: true });
});

// ---- Standard deductions (per filing status) ----
router.put('/years/:year/standard-deductions', (req, res) => {
  const year = Number(req.params.year);
  const { filingStatus, amount } = req.body || {};
  if (!FILING_STATUSES.includes(filingStatus) || amount == null) {
    return res.status(400).json({ error: `filingStatus (one of ${FILING_STATUSES.join(', ')}) and amount are required` });
  }
  db.prepare(`
    INSERT INTO tax_standard_deductions (tax_year, filing_status, amount) VALUES (?, ?, ?)
    ON CONFLICT(tax_year, filing_status) DO UPDATE SET amount = excluded.amount
  `).run(year, filingStatus, Number(amount));
  res.json(getTaxYearConfig(year));
});

// ---- Federal tax brackets ----
// Replaces the full bracket ladder for one filing status in one year.
router.put('/years/:year/brackets/:filingStatus', (req, res) => {
  const year = Number(req.params.year);
  const filingStatus = req.params.filingStatus;
  if (!FILING_STATUSES.includes(filingStatus)) return res.status(400).json({ error: 'Invalid filingStatus' });

  const { brackets } = req.body || {};
  if (!Array.isArray(brackets) || brackets.length === 0) {
    return res.status(400).json({ error: 'brackets must be a non-empty array of { uptoIncome, rate }' });
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tax_brackets WHERE tax_year = ? AND filing_status = ?').run(year, filingStatus);
    const insert = db.prepare('INSERT INTO tax_brackets (tax_year, filing_status, seq, upto_income, rate) VALUES (?, ?, ?, ?, ?)');
    brackets.forEach((b, seq) => {
      const upto = b.uptoIncome === null || b.uptoIncome === '' || b.uptoIncome === undefined ? null : Number(b.uptoIncome);
      insert.run(year, filingStatus, seq, upto, Number(b.rate));
    });
  });
  tx();

  res.json(getTaxYearConfig(year));
});

// ---- State / local / additional taxes (e.g. CO FAMLI, local payroll taxes) ----
router.get('/years/:year/state-taxes', (req, res) => {
  const rows = db.prepare('SELECT * FROM tax_state_taxes WHERE tax_year = ? ORDER BY state_code, tax_type').all(Number(req.params.year));
  res.json({ stateTaxes: rows });
});

router.post('/years/:year/state-taxes', (req, res) => {
  const year = Number(req.params.year);
  const { stateCode, taxName, taxType, rate, wageBase } = req.body || {};
  if (!stateCode || !taxName || rate == null) {
    return res.status(400).json({ error: 'stateCode, taxName, and rate are required' });
  }
  const info = db.prepare(`
    INSERT INTO tax_state_taxes (tax_year, state_code, tax_name, tax_type, rate, wage_base)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(year, stateCode.trim().toUpperCase(), taxName, taxType || 'state_income', Number(rate), wageBase != null ? Number(wageBase) : null);
  const row = db.prepare('SELECT * FROM tax_state_taxes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ stateTax: row });
});

router.put('/state-taxes/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM tax_state_taxes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'State tax not found' });
  const { stateCode, taxName, taxType, rate, wageBase } = req.body || {};
  db.prepare(`
    UPDATE tax_state_taxes SET state_code = ?, tax_name = ?, tax_type = ?, rate = ?, wage_base = ?
    WHERE id = ?
  `).run(
    stateCode ? stateCode.trim().toUpperCase() : existing.state_code,
    taxName ?? existing.tax_name, taxType ?? existing.tax_type,
    rate != null ? Number(rate) : existing.rate,
    wageBase !== undefined ? (wageBase != null ? Number(wageBase) : null) : existing.wage_base,
    req.params.id
  );
  const row = db.prepare('SELECT * FROM tax_state_taxes WHERE id = ?').get(req.params.id);
  res.json({ stateTax: row });
});

router.delete('/state-taxes/:id', (req, res) => {
  db.prepare('DELETE FROM tax_state_taxes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
