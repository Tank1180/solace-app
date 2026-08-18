import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const userId = req.user.id;

  const totalGrossPay = db.prepare('SELECT COALESCE(SUM(gross_pay),0) as v FROM paychecks WHERE user_id = ?').get(userId).v;
  const totalNetPay = db.prepare('SELECT COALESCE(SUM(net_pay),0) as v FROM paychecks WHERE user_id = ?').get(userId).v;
  const totalSpending = db.prepare('SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE user_id = ?').get(userId).v;

  const byCategory = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(t.amount) as total, COUNT(*) as count
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ?
    GROUP BY c.name ORDER BY total DESC
  `).all(userId);

  const byMonth = db.prepare(`
    SELECT strftime('%Y-%m', txn_date) as month, SUM(amount) as total
    FROM transactions WHERE user_id = ?
    GROUP BY month ORDER BY month
  `).all(userId);

  const investments = db.prepare('SELECT * FROM investments WHERE user_id = ?').all(userId);
  const investedCostBasis = investments.reduce((sum, i) => sum + i.shares * i.purchase_price, 0);
  const realizedGains = investments
    .filter((i) => i.sale_date && i.sale_price != null)
    .reduce((sum, i) => sum + (i.shares * i.sale_price - i.shares * i.purchase_price), 0);

  const totalDividends = db.prepare('SELECT COALESCE(SUM(amount),0) as v FROM dividends WHERE user_id = ?').get(userId).v;
  const totalOtherIncome = db.prepare('SELECT COALESCE(SUM(amount),0) as v FROM other_income WHERE user_id = ?').get(userId).v;

  const savingsRate = totalNetPay > 0 ? ((totalNetPay - totalSpending) / totalNetPay) : null;
  const netWorthEstimate = totalNetPay - totalSpending + investedCostBasis + realizedGains + totalDividends + totalOtherIncome;

  // Simple unusual-spending alert: any single transaction > 2x the average transaction amount
  const avgAmount = db.prepare('SELECT COALESCE(AVG(ABS(amount)),0) as v FROM transactions WHERE user_id = ?').get(userId).v;
  const alerts = avgAmount > 0
    ? db.prepare(`
        SELECT t.*, c.name as category_name FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND ABS(t.amount) > ?
        ORDER BY t.txn_date DESC LIMIT 20
      `).all(userId, avgAmount * 2)
    : [];

  res.json({
    totals: { totalGrossPay, totalNetPay, totalSpending, investedCostBasis, realizedGains, totalDividends, totalOtherIncome, savingsRate, netWorthEstimate },
    spendingByCategory: byCategory,
    spendingByMonth: byMonth,
    alerts,
  });
});

export default router;
