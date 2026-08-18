// US federal + state tax projection engine, driven by admin-configurable tax-year settings
// stored in the tax_years / tax_standard_deductions / tax_brackets / tax_state_taxes tables.
// This is NOT tax advice — it's a reasonable approximation for planning purposes.
import db from '../db/index.js';

export const FILING_STATUSES = ['single', 'married_joint', 'married_separate', 'head_of_household'];

export function getTaxYearConfig(year) {
  const yearRow = db.prepare('SELECT * FROM tax_years WHERE tax_year = ?').get(year);
  if (!yearRow) return null;

  const standardDeductionRows = db.prepare('SELECT * FROM tax_standard_deductions WHERE tax_year = ?').all(year);
  const standardDeductions = {};
  for (const row of standardDeductionRows) standardDeductions[row.filing_status] = row.amount;

  const bracketRows = db.prepare('SELECT * FROM tax_brackets WHERE tax_year = ? ORDER BY filing_status, seq').all(year);
  const brackets = {};
  for (const row of bracketRows) {
    if (!brackets[row.filing_status]) brackets[row.filing_status] = [];
    brackets[row.filing_status].push([row.upto_income == null ? Infinity : row.upto_income, row.rate]);
  }

  const stateTaxRows = db.prepare('SELECT * FROM tax_state_taxes WHERE tax_year = ? ORDER BY state_code, tax_type').all(year);

  return { year: yearRow, standardDeductions, brackets, stateTaxes: stateTaxRows };
}

export function getAvailableTaxYears() {
  return db.prepare('SELECT tax_year FROM tax_years ORDER BY tax_year DESC').all().map((r) => r.tax_year);
}

export function stateTaxesFor(config, stateCode) {
  if (!stateCode) return [];
  const code = stateCode.trim().toUpperCase();
  return config.stateTaxes.filter((t) => t.state_code === code);
}

// Convenience: combined flat rate across all state-level taxes (income + additional/local) for a state.
export function stateTaxRate(config, stateCode) {
  const taxes = stateTaxesFor(config, stateCode);
  if (taxes.length === 0) return config.year.default_state_rate;
  return taxes.reduce((sum, t) => sum + t.rate, 0);
}

function marginalTax(taxableIncome, brackets) {
  if (!brackets || taxableIncome <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const [upto, rate] of brackets) {
    if (taxableIncome > lower) {
      const bandAmount = Math.min(taxableIncome, upto) - lower;
      tax += bandAmount * rate;
      lower = upto;
    } else break;
  }
  return tax;
}

/**
 * Project federal + state tax liability for a year, using the given tax-year config.
 * @param {object} config - result of getTaxYearConfig(year)
 * @param {object} params
 */
export function projectTax(config, params) {
  const {
    filingStatus = 'single',
    stateCode = '',
    numDependents = 0,
    grossWages = 0,
    retirementContributions = 0,
    otherDeductions = 0,
    investmentGains = 0,
    businessIncome = 0,
    otherIncome = 0,
    federalWithholding = 0,
    stateWithholding = 0,
  } = params;

  const status = FILING_STATUSES.includes(filingStatus) ? filingStatus : 'single';
  const standardDeduction = config.standardDeductions[status] ?? 0;
  const useDeduction = Math.max(standardDeduction, otherDeductions); // simplified: itemize only if it beats standard

  const totalIncome = Math.max(0, grossWages - retirementContributions) + Math.max(0, businessIncome) + Math.max(0, otherIncome);
  const ordinaryTaxableIncome = Math.max(0, totalIncome - useDeduction);

  const federalBrackets = config.brackets[status];
  let federalTax = marginalTax(ordinaryTaxableIncome, federalBrackets);

  // Simplified long-term capital gains treatment: flat rate on investment gains.
  const capGainsTax = Math.max(0, investmentGains) * config.year.capital_gains_rate;
  federalTax += capGainsTax;

  // Simplified self-employment tax approximation (Social Security + Medicare) on business income.
  const selfEmploymentTax = Math.max(0, businessIncome) * config.year.self_employment_rate;
  federalTax += selfEmploymentTax;

  // Social Security (up to wage base) + Medicare (+ additional Medicare above threshold) on wages.
  const ssWages = Math.min(Math.max(0, grossWages), config.year.social_security_wage_base);
  const socialSecurityTax = ssWages * config.year.social_security_rate;
  const medicareTax = Math.max(0, grossWages) * config.year.medicare_rate;
  const additionalMedicareTax = Math.max(0, grossWages - config.year.additional_medicare_threshold) * config.year.additional_medicare_rate;
  const payrollTax = socialSecurityTax + medicareTax + additionalMedicareTax;

  const childTaxCredit = Math.min(numDependents, 10) * config.year.child_tax_credit;
  federalTax = Math.max(0, federalTax - childTaxCredit);

  const stateTaxes = stateTaxesFor(config, stateCode);
  const stateTaxableIncome = Math.max(0, totalIncome - standardDeduction);
  let stateTax = 0;
  const stateTaxBreakdown = [];
  if (stateTaxes.length > 0) {
    for (const t of stateTaxes) {
      const base = t.wage_base != null ? Math.min(Math.max(0, grossWages), t.wage_base) : stateTaxableIncome;
      const amount = base * t.rate + (t.tax_type === 'state_income' ? Math.max(0, investmentGains) * t.rate : 0);
      stateTax += amount;
      stateTaxBreakdown.push({ name: t.tax_name, type: t.tax_type, rate: t.rate, amount: Math.round(amount * 100) / 100 });
    }
  } else {
    const rate = config.year.default_state_rate;
    stateTax = stateTaxableIncome * rate + Math.max(0, investmentGains) * rate;
    stateTaxBreakdown.push({ name: 'Estimated State Income Tax', type: 'state_income', rate, amount: Math.round(stateTax * 100) / 100 });
  }

  const totalLiability = federalTax + stateTax + payrollTax;
  const totalWithheld = federalWithholding + stateWithholding;
  const balanceDue = totalLiability - totalWithheld;

  return {
    taxYear: config.year.tax_year,
    filingStatus: status,
    standardDeduction,
    deductionUsed: useDeduction,
    itemizing: useDeduction > standardDeduction,
    totalIncome,
    ordinaryTaxableIncome,
    childTaxCredit,
    capGainsTax,
    selfEmploymentTax,
    socialSecurityTax: Math.round(socialSecurityTax * 100) / 100,
    medicareTax: Math.round((medicareTax + additionalMedicareTax) * 100) / 100,
    payrollTax: Math.round(payrollTax * 100) / 100,
    federalTax: Math.round(federalTax * 100) / 100,
    stateTax: Math.round(stateTax * 100) / 100,
    stateTaxBreakdown,
    totalLiability: Math.round(totalLiability * 100) / 100,
    totalWithheld: Math.round(totalWithheld * 100) / 100,
    balanceDue: Math.round(balanceDue * 100) / 100,
    effectiveRate: totalIncome > 0 ? Math.round((totalLiability / totalIncome) * 10000) / 100 : 0,
  };
}

export function quarterlyEstimate(totalLiability, totalWithheld) {
  const remaining = Math.max(0, totalLiability - totalWithheld);
  const perQuarter = remaining / 4;
  return Math.round(perQuarter * 100) / 100;
}
