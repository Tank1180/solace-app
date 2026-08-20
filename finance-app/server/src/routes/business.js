import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

async function businessRequired(req, res, next) {
  const user = await db.prepare('SELECT customer_type FROM users WHERE id = ?').get(req.user.id);
  if (!user || user.customer_type !== 'business') {
    return res.status(403).json({ error: 'This feature is only available to business accounts' });
  }
  next();
}
router.use(businessRequired);

// ---- Quarterly estimated tax payments ----
router.get('/quarterly-payments', async (req, res) => {
  const { year } = req.query;
  const yr = year || new Date().getFullYear();
  const payments = await db.prepare(
    'SELECT * FROM quarterly_tax_payments WHERE user_id = ? AND tax_year = ? ORDER BY quarter'
  ).all(req.user.id, Number(yr));
  res.json({ year: Number(yr), payments });
});

router.post('/quarterly-payments', async (req, res) => {
  const { taxYear, quarter, paidDate, amount, notes } = req.body || {};
  if (!taxYear || ![1, 2, 3, 4].includes(Number(quarter)) || amount == null) {
    return res.status(400).json({ error: 'taxYear, quarter (1-4), and amount are required' });
  }
  const info = await db.prepare(`
    INSERT INTO quarterly_tax_payments (user_id, tax_year, quarter, paid_date, amount, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, Number(taxYear), Number(quarter), paidDate || null, Number(amount), notes || null);
  const row = await db.prepare('SELECT * FROM quarterly_tax_payments WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ payment: row });
});

router.delete('/quarterly-payments/:id', async (req, res) => {
  await db.prepare('DELETE FROM quarterly_tax_payments WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ---- Profit & Loss statement ----
// Business income = "Business Expense"-tagged categories are treated as expenses; business-flagged
// other_income entries (sole proprietor revenue, 1099-NEC, gig income, etc.) are treated as revenue.
router.get('/profit-loss', async (req, res) => {
  const { year } = req.query;
  const yr = String(year || new Date().getFullYear());

  const revenueRows = await db.prepare(`
    SELECT * FROM other_income
    WHERE user_id = ? AND is_self_employment = 1 AND strftime('%Y', income_date) = ?
  `).all(req.user.id, yr);
  const revenueByCategory = {};
  let totalRevenue = 0;
  for (const r of revenueRows) {
    revenueByCategory[r.category] = (revenueByCategory[r.category] || 0) + r.amount;
    totalRevenue += r.amount;
  }

  const expenseRows = await db.prepare(`
    SELECT t.*, c.name as category_name FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ? AND c.name = 'Business Expense' AND strftime('%Y', t.txn_date) = ?
  `).all(req.user.id, yr);
  const totalExpenses = expenseRows.reduce((s, t) => s + t.amount, 0);

  const deductionRows = await db.prepare(`
    SELECT * FROM tax_deductions WHERE user_id = ? AND category = 'business_expense' AND strftime('%Y', ded_date) = ?
  `).all(req.user.id, yr);
  const totalDeductibleExpenses = deductionRows.reduce((s, d) => s + d.amount, 0);

  const netProfit = totalRevenue - totalExpenses - totalDeductibleExpenses;

  res.json({
    year: Number(yr),
    revenue: { total: totalRevenue, byCategory: revenueByCategory, entries: revenueRows },
    expenses: {
      transactionExpenses: totalExpenses,
      transactionEntries: expenseRows,
      deductibleExpenses: totalDeductibleExpenses,
      deductibleEntries: deductionRows,
      total: totalExpenses + totalDeductibleExpenses,
    },
    netProfit,
  });
});

export default router;
