import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';
import { getMarketQuotes } from '../services/marketData.js';

const router = Router();
router.use(authRequired);

function monthStartMonthsAgo(monthsAgo) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1, 12));
  return start.toISOString().slice(0, 10);
}

function formatRangeLabel(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  const format = (value) => value.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${format(start)} - ${format(end)}`;
}

router.get('/', async (req, res) => {
  const userId = req.user.id;
  const rangeStart = monthStartMonthsAgo(11);
  const rangeEnd = new Date().toISOString().slice(0, 10);
  const referenceRangeLabel = `Past 12 months (${formatRangeLabel(rangeStart, rangeEnd)})`;
  const mode = req.query.mode === 'realtime' ? 'realtime' : 'close';
  const currentYear = new Date().getUTCFullYear();
  const currentYearStart = `${currentYear}-01-01`;
  const currentYearEnd = `${currentYear}-12-31`;

  const totalGrossPay = (await db.prepare('SELECT COALESCE(SUM(gross_pay),0) as v FROM paychecks WHERE user_id = ? AND pay_date >= ?').get(userId, rangeStart)).v;
  const totalNetPay = (await db.prepare('SELECT COALESCE(SUM(net_pay),0) as v FROM paychecks WHERE user_id = ? AND pay_date >= ?').get(userId, rangeStart)).v;
  const totalSpending = (await db.prepare('SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE user_id = ? AND txn_date >= ?').get(userId, rangeStart)).v;

  const byCategory = await db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(t.amount) as total, COUNT(*) as count
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ? AND t.txn_date >= ?
    GROUP BY c.name ORDER BY total DESC
  `).all(userId, rangeStart);

  const byMonth = await db.prepare(`
    SELECT strftime('%Y-%m', txn_date) as month, SUM(amount) as total
    FROM transactions WHERE user_id = ? AND txn_date >= ?
    GROUP BY month ORDER BY month
  `).all(userId, rangeStart);

  const investments = await db.prepare(`
    SELECT * FROM investments WHERE user_id = ? AND (pending_shares = 0 OR pending_shares IS NULL)
  `).all(userId);
  const investedCostBasis = investments.reduce((sum, i) => sum + Number(i.shares || 0) * Number(i.purchase_price || 0), 0);
  const realizedGains = investments
    .filter((i) => i.sale_date && i.sale_price != null && i.sale_date >= currentYearStart && i.sale_date <= currentYearEnd)
    .reduce((sum, i) => sum + (Number(i.shares || 0) * Number(i.sale_price || 0) - Number(i.shares || 0) * Number(i.purchase_price || 0)), 0);

  const openInvestments = investments.filter((i) => !(i.sale_date && i.sale_price != null));
  const { quotes } = await getMarketQuotes(openInvestments.map((i) => i.symbol), mode);
  let portfolioMarketValue = 0;
  let unrealizedGain = 0;
  for (const inv of openInvestments) {
    const symbol = String(inv.symbol || '').trim().toUpperCase();
    const quote = quotes.get(symbol);
    if (quote && quote.marketPrice != null) {
      const shares = Number(inv.shares || 0);
      const marketValue = shares * quote.marketPrice;
      const costBasis = shares * Number(inv.purchase_price || 0);
      portfolioMarketValue += marketValue;
      unrealizedGain += marketValue - costBasis;
    }
  }

  const totalOtherIncome = (await db.prepare('SELECT COALESCE(SUM(amount),0) as v FROM other_income WHERE user_id = ? AND income_date >= ?').get(userId, rangeStart)).v;

  // Running cash balance: Available Cash Today = Yesterday's Balance + Today's Income - Today's Spending,
  // unrolled from the start of all recorded history through today. Only cash/check spending reduces
  // cash on hand immediately; credit card spending is a future bill obligation, not an immediate cash outflow.
  const allTimeNetPay = (await db.prepare('SELECT COALESCE(SUM(net_pay),0) as v FROM paychecks WHERE user_id = ? AND pay_date <= ?').get(userId, rangeEnd)).v;
  const allTimeOtherIncome = (await db.prepare('SELECT COALESCE(SUM(amount),0) as v FROM other_income WHERE user_id = ? AND income_date <= ?').get(userId, rangeEnd)).v;
  const allTimeCashCheckSpending = (await db.prepare(`
    SELECT COALESCE(SUM(amount),0) as v FROM transactions
    WHERE user_id = ? AND txn_date <= ? AND payment_method IN ('cash', 'check')
  `).get(userId, rangeEnd)).v;
  const currentCashBalance = Number(allTimeNetPay || 0) + Number(allTimeOtherIncome || 0) - Number(allTimeCashCheckSpending || 0);

  // Simple unusual-spending alert: any single transaction > 2x the average transaction amount
  const avgAmount = (await db.prepare('SELECT COALESCE(AVG(ABS(amount)),0) as v FROM transactions WHERE user_id = ? AND txn_date >= ?').get(userId, rangeStart)).v;
  const alerts = avgAmount > 0
    ? await db.prepare(`
        SELECT t.*, c.name as category_name FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND t.txn_date >= ? AND ABS(t.amount) > ?
        ORDER BY t.txn_date DESC LIMIT 20
      `).all(userId, rangeStart, avgAmount * 2)
    : [];

  res.json({
    totals: {
      totalGrossPay, totalNetPay, totalSpending, totalOtherIncome,
      investedCostBasis, portfolioMarketValue, unrealizedGain, realizedGains,
      currentCashBalance,
    },
    referenceRangeLabel,
    realizedGainsYear: currentYear,
    spendingByCategory: byCategory,
    spendingByMonth: byMonth,
    alerts,
  });
});

export default router;
