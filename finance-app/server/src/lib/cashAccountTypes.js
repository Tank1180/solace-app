// Cash account taxonomy grouped by liquidity tier, used when a user records where their
// paycheck or other income funds land (checking, savings, HSA, FSA, etc.).
//
// This module covers Tier 1-3 (cash-style accounts). Tier 4 (market-dependent investments)
// and Tier 5 (long-term retirement) are not modeled here — they map to the existing
// investment_accounts entities managed on the Investments page. See investmentAccountTiers.js.
export const CASH_ACCOUNT_TIERS = [
  {
    tier: 1,
    label: 'Tier 1: Fully Liquid',
    description: 'Cash is available same day, no restrictions.',
    types: [
      { value: 'checking', label: 'Checking account' },
      { value: 'savings', label: 'Standard savings account' },
      { value: 'hysa', label: 'High-yield savings account (HYSA)' },
      { value: 'money_market', label: 'Non-retirement money market account' },
      { value: 'cash_management', label: 'Cash management account (Fidelity, Schwab, Betterment)' },
      { value: 'brokerage_cash_sweep', label: 'Brokerage cash sweep account' },
      { value: 'payment_app', label: 'Payment app balance (PayPal, Venmo, Cash App)' },
      { value: 'physical_cash', label: 'Physical cash' },
    ],
  },
  {
    tier: 2,
    label: 'Tier 2: Semi-Liquid',
    description: 'Accessible, but may require a transfer or settlement. Only counted toward Available Cash Today if you opt in.',
    types: [
      { value: 'online_savings', label: 'Online savings bank (Ally, Marcus, Discover)' },
      { value: 'no_penalty_cd', label: 'No-penalty CD' },
      { value: 'treasury_bill', label: 'Treasury bill (T-Bill)' },
      { value: 'money_market_fund', label: 'Money-market mutual fund (MMF)' },
      { value: 'brokerage_low_vol', label: 'Brokerage account (low-volatility assets)' },
      { value: 'short_term_bond_fund', label: 'Short-term bond fund' },
      { value: 'i_bond', label: 'I-Bond (after 12-month lockup)' },
    ],
  },
  {
    tier: 3,
    label: 'Tier 3: Restricted',
    description: 'Accessible, but with rules, penalties, or specific use-cases. Excluded from Available Cash Today and tracked as Restricted Cash.',
    types: [
      { value: 'hsa', label: 'Health Savings Account (HSA)' },
      { value: 'fsa', label: 'Flexible Spending Account (FSA)' },
      { value: 'plan_529', label: '529 College Savings Plan' },
      { value: 'coverdell_esa', label: 'Coverdell ESA' },
      { value: 'espp', label: 'Employer Stock Purchase Plan (ESPP) contribution account' },
      { value: 'standard_cd', label: 'Standard CD (early withdrawal penalty)' },
      { value: 'deferred_comp', label: 'Deferred compensation plan (non-qualified)' },
      { value: 'annuity', label: 'Annuity (surrender charges apply)' },
      { value: 'trust', label: 'Trust account with distribution rules' },
      { value: 'custodial', label: 'Custodial account (UGMA/UTMA)' },
    ],
  },
];

export const CASH_ACCOUNT_TYPE_VALUES = new Set(
  CASH_ACCOUNT_TIERS.flatMap((tier) => tier.types.map((type) => type.value))
);

// Per spec section 9: an account with no recognized liquidity tier defaults to Tier 3
// (Restricted) rather than the most permissive tier, and should be flagged for review.
const DEFAULT_TIER_FOR_UNMAPPED_TYPE = 3;

export function classifyAccountType(accountType) {
  const found = CASH_ACCOUNT_TIERS.find((tier) => tier.types.some((type) => type.value === accountType));
  if (found) return { tier: found.tier, configWarning: false };
  // eslint-disable-next-line no-console
  console.warn(`[cash-accounts] Unrecognized account type "${accountType}" — defaulting to Tier ${DEFAULT_TIER_FOR_UNMAPPED_TYPE} (Restricted). Add this type to CASH_ACCOUNT_TIERS.`);
  return { tier: DEFAULT_TIER_FOR_UNMAPPED_TYPE, configWarning: true };
}

export function tierForAccountType(accountType) {
  return classifyAccountType(accountType).tier;
}

export function labelForAccountType(accountType) {
  for (const tier of CASH_ACCOUNT_TIERS) {
    const found = tier.types.find((type) => type.value === accountType);
    if (found) return found.label;
  }
  return accountType;
}
