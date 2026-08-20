import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

const BILL_CATEGORIES = ['housing', 'utilities', 'insurance', 'loans', 'subscriptions', 'other'];
const BILL_TYPES = ['one_time', 'recurring'];
const RECURRENCE_UNITS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const RECURRENCE_END_TYPES = ['billing_cycles', 'until_date', 'until_stopped'];

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

function normalizeRecurringSettings(bill) {
  const endType = bill.recurrence_end_type || (bill.recurrence_count ? 'billing_cycles' : 'until_stopped');
  return {
    intervalCount: Number(bill.recurrence_interval_count || (bill.recurrence_end_type ? 1 : bill.recurrence_count) || 1),
    billingCycles: endType === 'billing_cycles' ? Math.max(1, Number(bill.recurrence_count || 1)) : null,
    endType,
    endDate: bill.recurrence_end_date || null,
  };
}

function buildOccurrence(baseBill, scheduledDate) {
  return {
    ...baseBill,
    scheduled_date: scheduledDate,
  };
}

function billOccurrencesBetween(bill, startDate, endDate) {
  if (bill.bill_type !== 'recurring') {
    if (bill.due_date >= startDate && bill.due_date <= endDate) {
      return [buildOccurrence(bill, bill.due_date)];
    }
    return [];
  }

  const { intervalCount, billingCycles, endType, endDate: recurrenceEndDate } = normalizeRecurringSettings(bill);
  const occurrences = [];
  let occurrenceDate = bill.due_date;
  let cycle = 1;

  while (occurrenceDate <= endDate && cycle <= 600) {
    if (occurrenceDate >= startDate) {
      occurrences.push(buildOccurrence(bill, occurrenceDate));
    }

    if (endType === 'billing_cycles' && cycle >= billingCycles) {
      break;
    }

    const nextDate = addInterval(occurrenceDate, bill.recurrence_unit || 'monthly', intervalCount);
    if (nextDate === occurrenceDate) {
      break;
    }
    occurrenceDate = nextDate;
    cycle += 1;

    if (endType === 'until_date' && recurrenceEndDate && occurrenceDate > recurrenceEndDate) {
      break;
    }
  }

  return occurrences;
}

function nextOccurrenceDate(bill, onOrAfter) {
  return billOccurrencesBetween(bill, onOrAfter, addInterval(onOrAfter, 'yearly', 10))[0]?.scheduled_date || null;
}

function recurrenceLabel(bill) {
  if (bill.bill_type !== 'recurring') return 'One-time';
  const { billingCycles, endType, endDate } = normalizeRecurringSettings(bill);
  const frequency = bill.recurrence_unit || 'monthly';
  if (endType === 'billing_cycles') {
    return `Every ${frequency} for ${billingCycles} billing cycle${billingCycles === 1 ? '' : 's'}`;
  }
  if (endType === 'until_date') {
    return `Every ${frequency} until ${endDate}`;
  }
  return `Every ${frequency} until stopped`;
}

async function loadBills(userId) {
  const bills = await db.prepare(`
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
  const today = todayKey();
  return bills.map((bill) => ({
    ...bill,
    next_due_date: nextOccurrenceDate(bill, today),
    recurrence_label: recurrenceLabel(bill),
  }));
}

async function buildOverview(userId, month) {
  const bills = await loadBills(userId);
  const today = todayKey();
  const monthPrefix = monthKey(month);
  const monthStart = `${monthPrefix}-01`;
  const monthEnd = formatDateKey(new Date(Date.UTC(Number(monthPrefix.slice(0, 4)), Number(monthPrefix.slice(5, 7)), 0, 12)));
  const monthOccurrences = bills.flatMap((bill) => billOccurrencesBetween(bill, monthStart, monthEnd));
  const upcomingWindows = [7, 14, 30, 60].map((days) => {
    const endDate = formatDateKey(new Date(parseDateKey(today).getTime() + (days * 86400000)));
    const items = bills.flatMap((bill) => billOccurrencesBetween(bill, today, endDate));
    const total = items.reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
    return { days, total, count: items.length, bills: items };
  });

  const discretionarySpending = (await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS v
    FROM transactions
    WHERE user_id = ? AND strftime('%Y-%m', txn_date) = ?
  `).get(userId, monthPrefix)).v;

  const paycheckNet = (await db.prepare(`
    SELECT COALESCE(SUM(net_pay), 0) AS v
    FROM paychecks
    WHERE user_id = ? AND strftime('%Y-%m', pay_date) = ?
  `).get(userId, monthPrefix)).v;

  const otherIncome = (await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS v
    FROM other_income
    WHERE user_id = ? AND strftime('%Y-%m', income_date) = ?
  `).get(userId, monthPrefix)).v;

  const scheduledBills = monthOccurrences.reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
  const currentCashFlow = Number(paycheckNet || 0) + Number(otherIncome || 0) - Number(discretionarySpending || 0) - Number(scheduledBills || 0);
  const projectedBalance30 = Number(paycheckNet || 0) + Number(otherIncome || 0) - Number(discretionarySpending || 0) - Number(upcomingWindows.find((w) => w.days === 30).total || 0);
  const projectedBalance60 = Number(paycheckNet || 0) + Number(otherIncome || 0) - Number(discretionarySpending || 0) - Number(upcomingWindows.find((w) => w.days === 60).total || 0);
  const dueSoonBills = upcomingWindows.find((w) => w.days === 7).bills;

  const alerts = [];
  for (const bill of dueSoonBills) {
    alerts.push({
      type: 'due_soon',
      message: `${bill.bill_name} is due on ${bill.scheduled_date}`,
      bill_id: bill.id,
      amount: bill.amount,
      due_date: bill.scheduled_date,
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
    scheduledBills: Number(scheduledBills || 0),
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

router.get('/', async (req, res) => {
  const month = req.query.month;
  res.json(await buildOverview(req.user.id, month));
});

router.post('/', async (req, res) => {
  const {
    billName,
    category,
    billType,
    amount,
    dueDate,
    recurrenceUnit,
    recurrenceCount,
    recurrenceEndType,
    recurrenceEndDate,
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
  if (billType === 'recurring' && !RECURRENCE_END_TYPES.includes(recurrenceEndType)) {
    return res.status(400).json({ error: `recurrenceEndType must be one of ${RECURRENCE_END_TYPES.join(', ')}` });
  }
  if (billType === 'recurring' && recurrenceEndType === 'billing_cycles' && Number(recurrenceCount || 0) < 1) {
    return res.status(400).json({ error: 'Billing cycles must be at least 1' });
  }
  if (billType === 'recurring' && recurrenceEndType === 'until_date' && !recurrenceEndDate) {
    return res.status(400).json({ error: 'An end date is required when recurring bills end on a specific date' });
  }

  const info = await db.prepare(`
    INSERT INTO bills
      (user_id, bill_name, category, bill_type, amount, due_date, recurrence_unit, recurrence_interval_count, recurrence_count, recurrence_end_type, recurrence_end_date, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    billName,
    category,
    billType,
    amount,
    dueDate,
    billType === 'recurring' ? recurrenceUnit : null,
    1,
    billType === 'recurring' && recurrenceEndType === 'billing_cycles' ? Math.max(1, Number(recurrenceCount || 1)) : null,
    billType === 'recurring' ? recurrenceEndType : null,
    billType === 'recurring' && recurrenceEndType === 'until_date' ? recurrenceEndDate : null,
    notes || null,
    billType === 'one_time' ? 'active' : 'active'
  );

  const bill = await db.prepare('SELECT * FROM bills WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ bill });
});

router.put('/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Bill not found' });

  const {
    billName,
    category,
    billType,
    amount,
    dueDate,
    recurrenceUnit,
    recurrenceCount,
    recurrenceEndType,
    recurrenceEndDate,
    notes,
    status,
  } = req.body || {};

  const finalCategory = category || existing.category;
  const finalBillType = billType || existing.bill_type;
  const finalRecurrenceUnit = finalBillType === 'recurring' ? (recurrenceUnit || existing.recurrence_unit) : null;
  const finalRecurrenceEndType = finalBillType === 'recurring'
    ? (recurrenceEndType || existing.recurrence_end_type || (existing.recurrence_count ? 'billing_cycles' : 'until_stopped'))
    : null;
  const finalRecurrenceCount = finalBillType === 'recurring' && finalRecurrenceEndType === 'billing_cycles'
    ? Math.max(1, Number(recurrenceCount || existing.recurrence_count || 1))
    : null;
  const finalRecurrenceEndDate = finalBillType === 'recurring' && finalRecurrenceEndType === 'until_date'
    ? (recurrenceEndDate || existing.recurrence_end_date)
    : null;

  if (!BILL_CATEGORIES.includes(finalCategory)) {
    return res.status(400).json({ error: `category must be one of ${BILL_CATEGORIES.join(', ')}` });
  }
  if (!BILL_TYPES.includes(finalBillType)) {
    return res.status(400).json({ error: `billType must be one of ${BILL_TYPES.join(', ')}` });
  }
  if (finalBillType === 'recurring' && !RECURRENCE_UNITS.includes(finalRecurrenceUnit)) {
    return res.status(400).json({ error: `recurrenceUnit must be one of ${RECURRENCE_UNITS.join(', ')}` });
  }
  if (finalBillType === 'recurring' && !RECURRENCE_END_TYPES.includes(finalRecurrenceEndType)) {
    return res.status(400).json({ error: `recurrenceEndType must be one of ${RECURRENCE_END_TYPES.join(', ')}` });
  }
  if (finalBillType === 'recurring' && finalRecurrenceEndType === 'until_date' && !finalRecurrenceEndDate) {
    return res.status(400).json({ error: 'An end date is required when recurring bills end on a specific date' });
  }

  await db.prepare(`
    UPDATE bills
    SET bill_name = ?, category = ?, bill_type = ?, amount = ?, due_date = ?, recurrence_unit = ?, recurrence_interval_count = ?, recurrence_count = ?, recurrence_end_type = ?, recurrence_end_date = ?, notes = ?, status = ?
    WHERE id = ? AND user_id = ?
  `).run(
    billName ?? existing.bill_name,
    finalCategory,
    finalBillType,
    amount != null ? amount : existing.amount,
    dueDate ?? existing.due_date,
    finalRecurrenceUnit,
    1,
    finalRecurrenceCount,
    finalRecurrenceEndType,
    finalRecurrenceEndDate,
    notes ?? existing.notes,
    status || existing.status,
    req.params.id,
    req.user.id
  );

  const bill = await db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  res.json({ bill });
});

router.post('/:id/pay', async (req, res) => {
  const bill = await db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  if (bill.bill_type === 'one_time' && bill.status === 'paid') {
    return res.status(400).json({ error: 'This bill has already been paid' });
  }

  const paymentDate = req.body?.paymentDate || todayKey();
  const amount = req.body?.amount != null ? Number(req.body.amount) : Number(bill.amount || 0);
  const notes = req.body?.notes || null;

  const paymentInfo = await db.prepare(`
    INSERT INTO bill_payments (user_id, bill_id, payment_date, amount, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, bill.id, paymentDate, amount, notes);

  if (bill.bill_type === 'one_time') {
    await db.prepare('UPDATE bills SET status = ? WHERE id = ? AND user_id = ?').run('paid', bill.id, req.user.id);
  } else {
    let nextDue = bill.due_date;
    const intervalCount = Number(bill.recurrence_interval_count || (bill.recurrence_end_type ? 1 : bill.recurrence_count) || 1);
    do {
      nextDue = addInterval(nextDue, bill.recurrence_unit || 'monthly', intervalCount);
    } while (nextDue <= paymentDate);
    await db.prepare('UPDATE bills SET due_date = ?, status = ? WHERE id = ? AND user_id = ?').run(nextDue, 'active', bill.id, req.user.id);
  }

  const payment = await db.prepare('SELECT * FROM bill_payments WHERE id = ?').get(paymentInfo.lastInsertRowid);
  const updatedBill = await db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id);
  res.status(201).json({ payment, bill: updatedBill });
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM bills WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

export default router;
