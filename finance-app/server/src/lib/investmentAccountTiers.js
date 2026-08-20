// Tier 4 (market-dependent) and Tier 5 (long-term retirement) liquidity classification for
// investment_accounts. These are not separate "cash accounts" — they reuse the existing
// Investments feature's accounts so users don't have to enter the same account twice.
export const INVESTMENT_ACCOUNT_TIERS = [
  {
    tier: 4,
    label: 'Tier 4: Market-Dependent',
    description: 'Value depends on market performance. Excluded from Available Cash Today and tracked as Invested Assets.',
    types: [
      { value: 'brokerage', label: 'Taxable brokerage (stocks, ETFs, mutual funds, bonds)' },
      { value: 'crypto', label: 'Crypto account' },
      { value: 'alternative_investment', label: 'Alternative investment platform' },
      { value: 'other', label: 'Other investment account' },
    ],
  },
  {
    tier: 5,
    label: 'Tier 5: Long-Term Retirement',
    description: 'Locked up for retirement. Excluded from Available Cash Today and tracked as Retirement Assets.',
    types: [
      { value: '401k', label: '401(k)' },
      { value: '403b', label: '403(b)' },
      { value: '457b', label: '457(b)' },
      { value: 'ira', label: 'Traditional IRA' },
      { value: 'roth_ira', label: 'Roth IRA' },
      { value: 'sep_ira', label: 'SEP IRA' },
      { value: 'simple_ira', label: 'SIMPLE IRA' },
      { value: 'pension', label: 'Pension' },
      { value: 'tsp', label: 'Thrift Savings Plan (TSP)' },
      { value: 'cash_balance_plan', label: 'Cash balance plan' },
    ],
  },
];

export const INVESTMENT_ACCOUNT_TYPE_VALUES = new Set(
  INVESTMENT_ACCOUNT_TIERS.flatMap((tier) => tier.types.map((type) => type.value))
);

// Per spec section 9: an unrecognized account type defaults to Tier 3 (Restricted) with a
// configuration warning, rather than silently assuming it's market-dependent or retirement.
const DEFAULT_TIER_FOR_UNMAPPED_TYPE = 3;

export function classifyInvestmentAccountType(accountType) {
  const found = INVESTMENT_ACCOUNT_TIERS.find((tier) => tier.types.some((type) => type.value === accountType));
  if (found) return { tier: found.tier, configWarning: false };
  // eslint-disable-next-line no-console
  console.warn(`[investment-accounts] Unrecognized account type "${accountType}" — defaulting to Tier ${DEFAULT_TIER_FOR_UNMAPPED_TYPE} (Restricted). Add this type to INVESTMENT_ACCOUNT_TIERS.`);
  return { tier: DEFAULT_TIER_FOR_UNMAPPED_TYPE, configWarning: true };
}

export function tierForInvestmentAccountType(accountType) {
  return classifyInvestmentAccountType(accountType).tier;
}

export function labelForInvestmentAccountType(accountType) {
  for (const tier of INVESTMENT_ACCOUNT_TIERS) {
    const found = tier.types.find((type) => type.value === accountType);
    if (found) return found.label;
  }
  return accountType;
}
