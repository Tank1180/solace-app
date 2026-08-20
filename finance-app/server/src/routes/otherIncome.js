import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

// Category taxonomy mirrors the user stories: grouped, with each category flagged for
// default taxability and whether it typically counts as self-employment/business income
// (relevant for Schedule C / SE tax in the Tax Center projection).
export const INCOME_CATEGORIES = {
  personal: {
    label: 'Personal Income (Non-Wage)',
    categories: [
      { value: 'monetary_gifts', label: 'Monetary gifts', taxable: false },
      { value: 'cash_tips', label: 'Cash tips', taxable: true },
      { value: 'cash_rewards', label: 'Cash rewards (cashback, bank bonuses)', taxable: true },
      { value: 'rebates_refunds', label: 'Rebates and refunds', taxable: false },
      { value: 'reimbursements', label: 'Reimbursements (employer, insurance, medical, travel)', taxable: false },
      { value: 'gambling_winnings', label: 'Gambling winnings', taxable: true },
      { value: 'lottery_winnings', label: 'Lottery winnings', taxable: true },
      { value: 'contest_prizes', label: 'Contest or sweepstakes prizes', taxable: true },
      { value: 'game_show_winnings', label: 'Game show winnings', taxable: true },
      { value: 'legal_settlements', label: 'Legal settlements (taxable portion)', taxable: true },
      { value: 'sale_personal_property', label: 'Sale of personal property (cars, collectibles, electronics)', taxable: false },
      { value: 'sale_real_estate', label: 'Sale of real estate', taxable: true },
      { value: 'sale_digital_assets', label: 'Sale of digital assets (NFTs, domain names)', taxable: true },
      { value: 'rental_income', label: 'Rental income', taxable: true },
      { value: 'short_term_rental_income', label: 'Airbnb / short-term rental income', taxable: true },
      { value: 'real_estate_royalties', label: 'Real estate royalties', taxable: true },
      { value: 'lease_payments', label: 'Lease payments received', taxable: true },
      { value: 'royalties', label: 'Royalties (books, music, patents)', taxable: true },
      { value: 'licensing_fees', label: 'Licensing fees', taxable: true },
      { value: 'affiliate_income', label: 'Affiliate income', taxable: true },
      { value: 'advertising_revenue', label: 'Advertising revenue (YouTube, TikTok, blogs)', taxable: true },
    ],
  },
  business: {
    label: 'Business / Self-Employment Income',
    categories: [
      { value: 'income_1099_nec', label: '1099-NEC income', taxable: true, selfEmployment: true },
      { value: 'consulting_fees', label: 'Consulting fees', taxable: true, selfEmployment: true },
      { value: 'gig_economy', label: 'Gig economy income (Uber, Lyft, DoorDash, Instacart)', taxable: true, selfEmployment: true },
      { value: 'sole_proprietor_revenue', label: 'Sole proprietor revenue', taxable: true, selfEmployment: true },
      { value: 'partnership_distributions', label: 'Partnership distributions', taxable: true, selfEmployment: true },
      { value: 's_corp_distributions', label: 'S corporation shareholder distributions', taxable: true },
      { value: 'business_reimbursements', label: 'Business reimbursements', taxable: false },
      { value: 'business_grants', label: 'Business grants', taxable: true },
      { value: 'etsy_sales', label: 'Etsy sales', taxable: true, selfEmployment: true },
      { value: 'ebay_sales', label: 'eBay sales', taxable: true, selfEmployment: true },
      { value: 'marketplace_sales', label: 'Facebook Marketplace sales', taxable: false },
      { value: 'craft_fair_sales', label: 'Craft fairs, farmer\u2019s markets', taxable: true, selfEmployment: true },
      { value: 'coaching_tutoring', label: 'Coaching or tutoring income', taxable: true, selfEmployment: true },
    ],
  },
  government: {
    label: 'Government Payments',
    categories: [
      { value: 'unemployment_compensation', label: 'Unemployment compensation', taxable: true },
      { value: 'state_tax_refund', label: 'State tax refunds (if itemized)', taxable: true },
      { value: 'jury_duty_pay', label: 'Jury duty pay', taxable: true },
      { value: 'stipends', label: 'Stipends', taxable: true },
      { value: 'scholarship_nonqualified', label: 'Scholarships used for non-qualified expenses', taxable: true },
      { value: 'child_support', label: 'Child support received', taxable: false },
      { value: 'foster_care_payments', label: 'Foster care payments', taxable: false },
      { value: 'snap_benefits', label: 'SNAP benefits', taxable: false },
      { value: 'housing_assistance', label: 'Housing assistance', taxable: false },
      { value: 'va_disability', label: 'VA disability payments', taxable: false },
    ],
  },
  education: {
    label: 'Education-Related Income',
    categories: [
      { value: 'scholarship_taxable', label: 'Scholarships (taxable portion)', taxable: true },
      { value: 'fellowships', label: 'Fellowships', taxable: true },
      { value: 'research_stipends', label: 'Research stipends', taxable: true },
      { value: 'grad_assistant_income', label: 'Graduate assistant income', taxable: true },
      { value: 'student_loan_refunds', label: 'Student loan refunds (cash flow tracking)', taxable: false },
    ],
  },
  financial: {
    label: 'Financial Institution Income',
    categories: [
      { value: 'bank_interest', label: 'Bank account interest', taxable: true },
      { value: 'brokerage_interest', label: 'Brokerage account interest', taxable: true },
      { value: 'dividend_cashout', label: 'Dividend cash-out', taxable: true },
      { value: 'credit_card_rewards_cash', label: 'Credit card rewards (cash / points converted to cash)', taxable: false },
      { value: 'checking_bonuses', label: 'Checking account bonuses', taxable: true },
      { value: 'referral_bonuses', label: 'Referral bonuses', taxable: true },
    ],
  },
  misc: {
    label: 'Miscellaneous Income',
    categories: [
      { value: 'barter_income', label: 'Barter income (services exchanged for value)', taxable: true },
      { value: 'in_kind_payments', label: 'In-kind payments (e.g. someone pays your rent directly)', taxable: true },
      { value: 'crowdfunding_income', label: 'Crowdfunding income (GoFundMe, Kickstarter)', taxable: false },
      { value: 'gifts_of_property', label: 'Gifts of property (FMV tracking)', taxable: false },
      { value: 'debt_forgiveness', label: 'Debt forgiveness (cancellation of debt income)', taxable: true },
    ],
  },
  crypto: {
    label: 'Crypto & Digital Assets',
    categories: [
      { value: 'crypto_staking_rewards', label: 'Crypto staking rewards', taxable: true },
      { value: 'crypto_mining_income', label: 'Crypto mining income', taxable: true, selfEmployment: true },
      { value: 'crypto_airdrops', label: 'Crypto airdrops', taxable: true },
      { value: 'crypto_defi_interest', label: 'Crypto interest (DeFi lending)', taxable: true },
      { value: 'nft_sales_royalties', label: 'NFT sales or royalties', taxable: true },
    ],
  },
  foreign: {
    label: 'Foreign Income',
    categories: [
      { value: 'foreign_wages', label: 'Foreign wages', taxable: true },
      { value: 'foreign_dividends', label: 'Foreign dividends', taxable: true },
      { value: 'foreign_rental_income', label: 'Foreign rental income', taxable: true },
      { value: 'foreign_pension_income', label: 'Foreign pension income', taxable: true },
    ],
  },
};

const ALL_CATEGORY_VALUES = new Set(
  Object.values(INCOME_CATEGORIES).flatMap((g) => g.categories.map((c) => c.value))
);

function categoryMeta(category) {
  for (const group of Object.values(INCOME_CATEGORIES)) {
    const found = group.categories.find((c) => c.value === category);
    if (found) return found;
  }
  return null;
}

router.get('/categories', async (req, res) => {
  res.json({ groups: INCOME_CATEGORIES });
});

router.get('/', async (req, res) => {
  const { year } = req.query;
  let rows;
  if (year) {
    rows = await db.prepare("SELECT * FROM other_income WHERE user_id = ? AND strftime('%Y', income_date) = ? ORDER BY income_date DESC")
      .all(req.user.id, String(year));
  } else {
    rows = await db.prepare('SELECT * FROM other_income WHERE user_id = ? ORDER BY income_date DESC').all(req.user.id);
  }
  res.json({ income: rows });
});

router.post('/', async (req, res) => {
  const { incomeDate, incomeGroup, category, description, amount, isTaxable, isSelfEmployment } = req.body || {};
  if (!incomeDate || !INCOME_CATEGORIES[incomeGroup] || !ALL_CATEGORY_VALUES.has(category) || amount == null) {
    return res.status(400).json({ error: 'incomeDate, a valid incomeGroup, a valid category, and amount are required' });
  }
  const meta = categoryMeta(category);
  const finalTaxable = isTaxable != null ? (isTaxable ? 1 : 0) : (meta?.taxable ? 1 : 0);
  const finalSelfEmployment = isSelfEmployment != null ? (isSelfEmployment ? 1 : 0) : (meta?.selfEmployment ? 1 : 0);

  const info = await db.prepare(`
    INSERT INTO other_income (user_id, income_date, income_group, category, description, amount, is_taxable, is_self_employment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, incomeDate, incomeGroup, category, description || null, Number(amount), finalTaxable, finalSelfEmployment);

  const row = await db.prepare('SELECT * FROM other_income WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ income: row });
});

router.put('/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM other_income WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Income entry not found' });

  const { incomeDate, incomeGroup, category, description, amount, isTaxable, isSelfEmployment } = req.body || {};
  const finalGroup = INCOME_CATEGORIES[incomeGroup] ? incomeGroup : existing.income_group;
  const finalCategory = ALL_CATEGORY_VALUES.has(category) ? category : existing.category;

  await db.prepare(`
    UPDATE other_income SET income_date = ?, income_group = ?, category = ?, description = ?, amount = ?,
      is_taxable = ?, is_self_employment = ?
    WHERE id = ? AND user_id = ?
  `).run(
    incomeDate ?? existing.income_date, finalGroup, finalCategory,
    description ?? existing.description, amount != null ? Number(amount) : existing.amount,
    isTaxable != null ? (isTaxable ? 1 : 0) : existing.is_taxable,
    isSelfEmployment != null ? (isSelfEmployment ? 1 : 0) : existing.is_self_employment,
    req.params.id, req.user.id
  );

  const row = await db.prepare('SELECT * FROM other_income WHERE id = ?').get(req.params.id);
  res.json({ income: row });
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM other_income WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

export default router;
