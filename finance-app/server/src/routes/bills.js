import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

const BILL_CATEGORIES = ['housing', 'utilities', 'insurance', 'loans', 'subscriptions', 'other'];
const BILL_TYPES = ['one_time', 'recurring'];
const RECURRENCE_UNITS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(value) {
  if (value && /^\d{4}-\d{2}$/.test(String(value))) return String(value);
  return new Date().toISOString().slice(0, 7);
}

function parseDateKey(value) {
  return new Date(`${value}T12:00:00Z`);
}

function formatDateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addInterval(dateKey, unit, count) {
  const next = parseDateKey(dateKey);
  const step = Math.max(1, Number(count || 1));
  switch (unit) {
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + (7 * step));
      break;
    case 'biweekly':
      next.setUTCDate(next.getUTCDate() + (14 * step));
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + step);
      break;
    case 'quarterly':
      next.setUTCMonth(next.getUTCMonth() + (3 * step));
      break;
    case 'yearly':
      next.setUTCFullYear(next.getUTCFullYear() + step);
      break;
    default:
      next.setUTCMonth(next.getUTCMonth() + step);
      break;
  }
  return formatDateKey(next);
}

function daysBetween(start, end) {
  const ms = parseDateKey(end).getTime() - parseDateKey(start).getTime();
  return Math.floor(ms / 86400000);
}

function loadBills(userId) {
  return db.prepare(`
    SELECT b.*,
      (
        SELECT bp.payment_date
        FROM bill_payments bp
        WHERE bp.bill_id = b.id AND bp.user_id = b.user_id
        ORDER BY bp.payment_date DESC, bp.id DESC
        LIMIT 1
      ) AS last_payment_date,
      (
        SELECT bp.amount
        FROM bill_payments bp
        WHERE bp.bill_id = b.id AND bp.user_id = b.user_id
        ORDER BY bp.payment_date DESC, bp.id DESC
        LIMIT 1
      ) AS last_payment_amount
    FROM bills b
    WHERE b.user_id = ?
    ORDER BY CASE WHEN b.status = 'paid' THEN 1 ELSE 0 END, b.due_date ASC, b.created_at DESC
  `).all(userId);
}

function buildOverview(userId, month) {
  const bills = loadBills(userId);
  const today = todayKey();
  const monthPrefix = monthKey(month);
  const upcomingWindows = [7, 14, 30, 60].map((days) => {
    const endDate = formatDateKey(new Date(parseDateKey(today).getTime() + (days * 86400000)));
    const items = bills.filter((bill) => bill.status !== 'paid' && bill.due_date >= today && bill.due_date <= endDate);
    const total = items.reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
    return { days, total, count: items.length, bills: items };
  });

  const billPayments = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS v
    FROM bill_payments
    WHERE user_id = ? AND strftime('%Y-%m', payment_date) = ?
  `).get(userId, monthPrefix).v;

  const discretionarySpending = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS v
    FROM transactions
    WHERE user_id = ? AND strftime('%Y-%m', txn_date) = ?
  `).get(userId, monthPrefix).v;

  const paycheckNet = db.prepare(`
    SELECT COALESCE(SUM(net_pay), 0) AS v
    FROM paychecks
    WHERE user_id = ? AND strftime('%Y-%m', pay_date) = ?
  `).get(userId, monthPrefix).v;

  const otherIncome = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS v
    FROM other_income
    WHERE user_id = ? AND strftime('%Y-%m', income_date) = ?
  `).get(userId, monthPrefix).v;

  const currentCashFlow = Number(paycheckNet || 0) + Number(otherIncome || 0) - Number(discretionarySpending || 0) - Number(billPayments || 0);
  const projectedBalance30 = currentCashFlow - upcomingWindows.find((w) => w.days === 30).total;
  const projectedBalance60 = currentCashFlow - upcomingWindows.find((w) => w.days === 60).total;
  const dueSoonBills = upcomingWindows.find((w) => w.days === 7).bills;

  const alerts = [];
  for (const bill of dueSoonBills) {
    alerts.push({
      type: 'due_soon',
      message: `${bill.bill_name} is due on ${bill.due_date}`,
      bill_id: bill.id,
      amount: bill.amount,
      due_date: bill.due_date,
    });
  }
  if (projectedBalance30 < 0) {
    alerts.push({
      type: 'insufficient_cash',
      message: `Projected cash balance is ${projectedBalance30.toFixed(2)} after bills due in the next 30 days`,
      amount: projectedBalance30,
    });
  }

  const monthlySummary = {
    month: monthPrefix,
    billsPaid: Number(billPayments || 0),
    discretionarySpending: Number(discretionarySpending || 0),
    paycheckNet: Number(paycheckNet || 0),
    otherIncome: Number(otherIncome || 0),
    currentCashFlow,
    projectedBalance30,
    projectedBalance60,
  };

  return {
    bills,
    upcomingWindows,
    alerts,
    monthlySummary,
  };
}

router.get('/', (req, res) => {
  const month = req.query.month;
  res.json(buildOverview(req.user.id, month));
});

router.post('/', (req, res) => {
  const {
    billName,
    category,
    billType,
    amount,
    dueDate,
    recurrenceUnit,
    recurrenceCount,
    notes,
  } = req.body || {};

  if (!billName || !category || !billType || amount == null || !dueDate) {
    return res.status(400).json({ error: 'billName, category, billType, amount, and dueDate are required' });
  }
  if (!BILL_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of ${BILL_CATEGORIES.join(', ')}` });
  }
  if (!BILL_TYPES.includes(billType)) {
    return res.status(400).json({ error: `billType must be one of ${BILL_TYPES.join(', ')}` });
  }
  if (billType === 'recurring' && !RECURRENCE_UNITS.includes(recurrenceUnit)) {
    return res.status(400).json({ error: `recurrenceUnit must be one of ${RECURRENCE_UNITS.join(', ')}` });
  }

  const info = db.prepare(`
    INSERT INTO bills
      (user_id, bill_name, category, bill_type, amount, due_date, recurrence_unit, recurrence_count, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    billName,
    category,
    billType,
    amount,
    dueDate,
    billType === 'recurring' ? recurrenceUnit : null,
    billType === 'recurring' ? Math.max(1, Number(recurrenceCount || 1)) : null,
    notes || null,
    billType === 'one_time' ? 'active' : 'active'
  );

  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ bill });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Bill not found' });

  const {
    billName,
    category,
    billType,
    amount,
    dueDate,
    recurrenceUnit,
    recurrenceCount,
    notes,
    status,
  } = req.body || {};

  const finalCategory = category || existing.category;
  const finalBillType = billType || existing.bill_type;
  const finalRecurrenceUnit = finalBillType === 'recurring' ? (recurrenceUnit || existing.recurrence_unit) : null;
  const finalRecurrenceCount = finalBillType === 'recurring' ? Math.max(1, Number(recurrenceCount || existing.recurrence_count || 1)) : null;

  if (!BILL_CATEGORIES.includes(finalCategory)) {
    return res.status(400).json({ error: `category must be one of ${BILL_CATEGORIES.join(', ')}` });
  }
  if (!BILL_TYPES.includes(finalBillType)) {
    return res.status(400).json({ error: `billType must be one of ${BILL_TYPES.join(', ')}` });
  }
  if (finalBillType === 'recurring' && !RECURRENCE_UNITS.includes(finalRecurrenceUnit)) {
    return res.status(400).json({ error: `recurrenceUnit must be one of ${RECURRENCE_UNITS.join(', ')}` });
  }

  db.prepare(`
    UPDATE bills
    SET bill_name = ?, category = ?, bill_type = ?, amount = ?, due_date = ?, recurrence_unit = ?, recurrence_count = ?, notes = ?, status = ?
    WHERE id = ? AND user_id = ?
  `).run(
    billName ?? existing.bill_name,
    finalCategory,
    finalBillType,
    amount != null ? amount : existing.amount,
    dueDate ?? existing.due_date,
    finalRecurrenceUnit,
    finalRecurrenceCount,
    notes ?? existing.notes,
    status || existing.status,
    req.params.id,
    req.user.id
  );

  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  res.json({ bill });
});

router.post('/:id/pay', (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  if (bill.bill_type === 'one_time' && bill.status === 'paid') {
    return res.status(400).json({ error: 'This bill has already been paid' });
  }

  const paymentDate = req.body?.paymentDate || todayKey();
  const amount = req.body?.amount != null ? Number(req.body.amount) : Number(bill.amount || 0);
  const notes = req.body?.notes || null;

  const paymentInfo = db.prepare(`
    INSERT INTO bill_payments (user_id, bill_id, payment_date, amount, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, bill.id, paymentDate, amount, notes);

  if (bill.bill_type === 'one_time') {
    db.prepare('UPDATE bills SET status = ? WHERE id = ? AND user_id = ?').run('paid', bill.id, req.user.id);
  } else {
    let nextDue = bill.due_date;
    do {
      nextDue = addInterval(nextDue, bill.recurrence_unit || 'monthly', bill.recurrence_count || 1);
    } while (nextDue <= paymentDate);
    db.prepare('UPDATE bills SET due_date = ?, status = ? WHERE id = ? AND user_id = ?').run(nextDue, 'active', bill.id, req.user.id);
  }

  const payment = db.prepare('SELECT * FROM bill_payments WHERE id = ?').get(paymentInfo.lastInsertRowid);
  const updatedBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id);
  res.status(201).json({ payment, bill: updatedBill });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM bills WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

export default router;
