import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';
import { projectTax, quarterlyEstimate, FILING_STATUSES, getTaxYearConfig, getAvailableTaxYears } from '../lib/taxEngine.js';

const router = Router();
router.use(authRequired);

const DEDUCTION_CATEGORIES = ['charity', 'business_expense', 'mileage', 'home_office'];

function configOrDefault(year) {
  let config = getTaxYearConfig(year);
  if (!config) {
    // Fall back to the most recent configured year rather than failing outright.
    const years = getAvailableTaxYears();
    if (years.length === 0) return null;
    config = getTaxYearConfig(years[0]);
  }
  return config;
}

function paychecksForTax(user, year) {
  const rows = db.prepare("SELECT * FROM paychecks WHERE user_id = ? AND strftime('%Y', pay_date) = ?").all(user.id, String(year));
  if (user.filing_status === 'married_joint') return rows;
  return rows.filter((p) => p.owner_type !== 'spouse');
}

// ---- Deductions CRUD ----
router.get('/deductions', (req, res) => {
  const { year } = req.query;
  let rows;
  if (year) {
    rows = db.prepare("SELECT * FROM tax_deductions WHERE user_id = ? AND strftime('%Y', ded_date) = ? ORDER BY ded_date DESC")
      .all(req.user.id, String(year));
  } else {
    rows = db.prepare('SELECT * FROM tax_deductions WHERE user_id = ? ORDER BY ded_date DESC').all(req.user.id);
  }
  res.json({ deductions: rows });
});

router.post('/deductions', (req, res) => {
  const { dedDate, category, description, amount, miles } = req.body || {};
  if (!dedDate || !DEDUCTION_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `dedDate and category (one of ${DEDUCTION_CATEGORIES.join(', ')}) are required` });
  }
  const year = new Date(dedDate).getFullYear();
  const config = configOrDefault(year);
  const mileageRate = config ? config.year.mileage_rate : 0.67;
  const finalAmount = category === 'mileage' && miles != null ? Number(miles) * mileageRate : Number(amount) || 0;
  const info = db.prepare(`
    INSERT INTO tax_deductions (user_id, ded_date, category, description, amount, miles)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, dedDate, category, description || null, finalAmount, category === 'mileage' ? (miles || 0) : null);
  const row = db.prepare('SELECT * FROM tax_deductions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ deduction: row });
});

router.put('/deductions/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM tax_deductions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Deduction not found' });
  const { dedDate, category, description, amount, miles } = req.body || {};
  const finalCategory = DEDUCTION_CATEGORIES.includes(category) ? category : existing.category;
  const finalMiles = miles != null ? Number(miles) : existing.miles;
  const year = new Date(dedDate ?? existing.ded_date).getFullYear();
  const config = configOrDefault(year);
  const mileageRate = config ? config.year.mileage_rate : 0.67;
  const finalAmount = finalCategory === 'mileage' && finalMiles != null
    ? finalMiles * mileageRate
    : (amount != null ? Number(amount) : existing.amount);

  db.prepare(`
    UPDATE tax_deductions SET ded_date = ?, category = ?, description = ?, amount = ?, miles = ?
    WHERE id = ? AND user_id = ?
  `).run(
    dedDate ?? existing.ded_date, finalCategory, description ?? existing.description,
    finalAmount, finalCategory === 'mileage' ? finalMiles : null,
    req.params.id, req.user.id
  );
  const row = db.prepare('SELECT * FROM tax_deductions WHERE id = ?').get(req.params.id);
  res.json({ deduction: row });
});

router.delete('/deductions/:id', (req, res) => {
  db.prepare('DELETE FROM tax_deductions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ---- Filing profile (filing status lives on users; also reuses address/state + dependents) ----
router.get('/profile', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const dependents = db.prepare('SELECT * FROM dependents WHERE user_id = ?').all(req.user.id);
  res.json({
    filingStatus: user.filing_status,
    state: user.state,
    numDependents: dependents.length,
    availableFilingStatuses: FILING_STATUSES,
    availableTaxYears: getAvailableTaxYears(),
  });
});

router.put('/profile', (req, res) => {
  const { filingStatus } = req.body || {};
  if (!FILING_STATUSES.includes(filingStatus)) {
    return res.status(400).json({ error: `filingStatus must be one of ${FILING_STATUSES.join(', ')}` });
  }
  db.prepare('UPDATE users SET filing_status = ? WHERE id = ?').run(filingStatus, req.user.id);
  res.json({ filingStatus });
});

// ---- Aggregate this user's year data needed for a projection ----
function gatherYearData(userId, year) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const yr = String(year);
  const paychecks = paychecksForTax(user, year);
  const grossWages = paychecks.reduce((s, p) => s + p.gross_pay, 0);
  const retirementContributions = paychecks.reduce((s, p) => s + p.retirement_contribution, 0);
  const federalWithholding = paychecks.reduce((s, p) => s + p.federal_tax, 0);
  const stateWithholding = paychecks.reduce((s, p) => s + p.state_tax, 0);

  const deductions = db.prepare("SELECT * FROM tax_deductions WHERE user_id = ? AND strftime('%Y', ded_date) = ?").all(userId, yr);
  const otherDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const deductionsByCategory = DEDUCTION_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = deductions.filter((d) => d.category === cat).reduce((s, d) => s + d.amount, 0);
    return acc;
  }, {});

  const investments = db.prepare(
    "SELECT * FROM investments WHERE user_id = ? AND sale_date IS NOT NULL AND strftime('%Y', sale_date) = ?"
  ).all(userId, yr);
  const investmentGains = investments.reduce((s, inv) => s + (inv.shares * (inv.sale_price - inv.purchase_price)), 0);

  const dividends = db.prepare("SELECT * FROM dividends WHERE user_id = ? AND strftime('%Y', pay_date) = ?").all(userId, yr);
  const dividendIncome = dividends.reduce((s, d) => s + d.amount, 0);

  const businessTransactions = db.prepare(`
    SELECT t.* FROM transactions t JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = ? AND c.name = 'Business Expense' AND strftime('%Y', t.txn_date) = ?
  `).all(userId, yr);
  const businessExpenses = businessTransactions.reduce((s, t) => s + t.amount, 0);

  const otherIncomeRows = db.prepare("SELECT * FROM other_income WHERE user_id = ? AND strftime('%Y', income_date) = ?").all(userId, yr);
  const otherIncomeTotal = otherIncomeRows.reduce((s, i) => s + i.amount, 0);
  const taxableOtherIncome = otherIncomeRows.filter((i) => i.is_taxable && !i.is_self_employment).reduce((s, i) => s + i.amount, 0);
  const selfEmploymentOtherIncome = otherIncomeRows.filter((i) => i.is_taxable && i.is_self_employment).reduce((s, i) => s + i.amount, 0);
  const nonTaxableOtherIncome = otherIncomeRows.filter((i) => !i.is_taxable).reduce((s, i) => s + i.amount, 0);

  const dependents = db.prepare('SELECT * FROM dependents WHERE user_id = ?').all(userId);

  return {
    paychecks, grossWages, retirementContributions, federalWithholding, stateWithholding,
    deductions, otherDeductions, deductionsByCategory,
    investments, investmentGains, dividends, dividendIncome,
    businessExpenses, numDependents: dependents.length,
    otherIncomeRows, otherIncomeTotal, taxableOtherIncome, selfEmploymentOtherIncome, nonTaxableOtherIncome,
  };
}

function buildProjection(userId, year) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const config = configOrDefault(year);
  if (!config) return null;
  const data = gatherYearData(userId, year);

  const projection = projectTax(config, {
    filingStatus: user.filing_status || 'single',
    stateCode: user.state,
    numDependents: data.numDependents,
    grossWages: data.grossWages,
    spouseWagesIncluded: user.filing_status === 'married_joint',
    retirementContributions: data.retirementContributions,
    otherDeductions: data.otherDeductions,
    investmentGains: data.investmentGains + data.dividendIncome,
    businessIncome: data.selfEmploymentOtherIncome,
    otherIncome: data.taxableOtherIncome,
    federalWithholding: data.federalWithholding,
    stateWithholding: data.stateWithholding,
  });

  return { user, data, projection };
}

// ---- Projection ----
router.get('/projection', (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const built = buildProjection(req.user.id, year);
  if (!built) return res.status(404).json({ error: `No tax configuration found for year ${year}` });
  const { user, data, projection } = built;

  const quarterly = quarterlyEstimate(projection.totalLiability, projection.totalWithheld);

  res.json({
    year: Number(year),
    inputs: {
      grossWages: data.grossWages,
      spouseWagesIncluded: user.filing_status === 'married_joint',
      retirementContributions: data.retirementContributions,
      otherDeductions: data.otherDeductions,
      deductionsByCategory: data.deductionsByCategory,
      investmentGains: data.investmentGains,
      dividendIncome: data.dividendIncome,
      businessExpenses: data.businessExpenses,
      otherIncomeTotal: data.otherIncomeTotal,
      taxableOtherIncome: data.taxableOtherIncome,
      selfEmploymentOtherIncome: data.selfEmploymentOtherIncome,
      nonTaxableOtherIncome: data.nonTaxableOtherIncome,
      federalWithholding: data.federalWithholding,
      stateWithholding: data.stateWithholding,
      numDependents: data.numDependents,
      state: user.state,
      filingStatus: user.filing_status,
    },
    projection,
    quarterlyEstimatedPayment: quarterly,
  });
});

// ---- Scenario simulation ----
router.post('/simulate', (req, res) => {
  const year = req.body.year || new Date().getFullYear();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const config = configOrDefault(year);
  if (!config) return res.status(404).json({ error: `No tax configuration found for year ${year}` });
  const data = gatherYearData(req.user.id, year);

  const {
    filingStatus,
    extraRetirementContribution = 0,
    extraWithholding = 0,
    extraDeductions = 0,
    stateOverride,
  } = req.body || {};

  const projection = projectTax(config, {
    filingStatus: filingStatus || user.filing_status || 'single',
    stateCode: stateOverride || user.state,
    numDependents: data.numDependents,
    grossWages: data.grossWages,
    retirementContributions: data.retirementContributions + Number(extraRetirementContribution || 0),
    otherDeductions: data.otherDeductions + Number(extraDeductions || 0),
    investmentGains: data.investmentGains + data.dividendIncome,
    businessIncome: data.selfEmploymentOtherIncome,
    otherIncome: data.taxableOtherIncome,
    federalWithholding: data.federalWithholding + Number(extraWithholding || 0),
    stateWithholding: data.stateWithholding,
  });

  res.json({ year: Number(year), projection, quarterlyEstimatedPayment: quarterlyEstimate(projection.totalLiability, projection.totalWithheld) });
});

// ---- Tax-ready summary ----
router.get('/summary', (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const built = buildProjection(req.user.id, year);
  if (!built) return res.status(404).json({ error: `No tax configuration found for year ${year}` });
  const { user, data, projection } = built;
  const dependents = db.prepare('SELECT * FROM dependents WHERE user_id = ?').all(req.user.id);

  res.json({
    year: Number(year),
    taxpayer: {
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      filingStatus: user.filing_status,
      state: user.state,
      accountType: user.account_type,
      dependents: dependents.map((d) => ({ name: `${d.first_name} ${d.last_name || ''}`.trim(), relationship: d.relationship })),
    },
    income: {
      grossWages: data.grossWages,
      dividendIncome: data.dividendIncome,
      investmentGains: data.investmentGains,
      otherIncomeTotal: data.otherIncomeTotal,
      taxableOtherIncome: data.taxableOtherIncome,
      selfEmploymentOtherIncome: data.selfEmploymentOtherIncome,
      nonTaxableOtherIncome: data.nonTaxableOtherIncome,
      otherIncomeByCategory: data.otherIncomeRows.map((i) => ({
        date: i.income_date, group: i.income_group, category: i.category,
        description: i.description, amount: i.amount, taxable: !!i.is_taxable, selfEmployment: !!i.is_self_employment,
      })),
      totalIncome: projection.totalIncome,
    },
    deductions: {
      standardDeduction: projection.standardDeduction,
      itemizedTotal: data.otherDeductions,
      byCategory: data.deductionsByCategory,
      deductionUsed: projection.deductionUsed,
      itemizing: projection.itemizing,
      retirementContributions: data.retirementContributions,
    },
    investments: {
      realizedGains: data.investments.map((inv) => ({
        symbol: inv.symbol, shares: inv.shares, purchaseDate: inv.purchase_date, saleDate: inv.sale_date,
        gain: Math.round((inv.shares * (inv.sale_price - inv.purchase_price)) * 100) / 100,
      })),
      totalRealizedGains: data.investmentGains,
      totalDividends: data.dividendIncome,
    },
    withholding: {
      federal: data.federalWithholding,
      state: data.stateWithholding,
    },
    taxLiability: projection,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
