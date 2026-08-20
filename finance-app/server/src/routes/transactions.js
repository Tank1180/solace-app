import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import db from '../db/index.js';
import { authRequired } from '../auth.js';
import { postLedgerEntry, deleteLedgerEntriesForSource } from '../lib/accountLedger.js';

const router = Router();
router.use(authRequired);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Only cash/check spending is an immediate outflow from a bank account; credit card spending
// is a future bill obligation, not a same-day cash movement, so it's never posted to the ledger.
async function syncTransactionLedger(userId, transaction) {
  await deleteLedgerEntriesForSource(userId, 'transaction', transaction.id);
  if (!transaction.cash_account_id) return;
  if (transaction.payment_method !== 'cash' && transaction.payment_method !== 'check') return;

  const account = await db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND user_id = ?').get(transaction.cash_account_id, userId);
  if (!account) return;

  await postLedgerEntry(userId, {
    cashAccountId: transaction.cash_account_id,
    entryDate: transaction.txn_date,
    direction: 'outflow',
    amount: Math.abs(Number(transaction.amount || 0)),
    category: 'spending',
    description: transaction.description || 'Spending transaction',
    sourceType: 'transaction',
    sourceId: transaction.id,
  });
}

// Validates an optional cashAccountId: if provided, it must belong to the user and be active.
// Returns null when valid (or omitted), or an error message string.
async function validateCashAccountSelection(userId, cashAccountId) {
  if (!cashAccountId) return null;
  const account = await db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND user_id = ?').get(cashAccountId, userId);
  if (!account) return 'Selected cash account was not found';
  if (!account.is_active) return 'Selected cash account is inactive. Reactivate it first or choose a different account.';
  return null;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function findCategoryForDescription(userId, description) {
  if (!description) return null;
  const rules = await db.prepare('SELECT * FROM category_rules WHERE user_id = ?').all(userId);
  const lower = description.toLowerCase();
  const match = rules.find((r) => lower.includes(r.match_text.toLowerCase()));
  return match ? match.category_id : null;
}

function buildTransactionsQuery(userId, query) {
  const { startDate, endDate, categoryId, paymentMethod, source, search } = query || {};
  let sql = `SELECT t.*, c.name as category_name, ca.account_name as cash_account_name FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN cash_accounts ca ON ca.id = t.cash_account_id WHERE t.user_id = ?`;
  const params = [userId];
  if (startDate) { sql += ' AND t.txn_date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND t.txn_date <= ?'; params.push(endDate); }
  if (categoryId) { sql += ' AND t.category_id = ?'; params.push(categoryId); }
  if (paymentMethod) { sql += ' AND t.payment_method = ?'; params.push(paymentMethod); }
  if (source) { sql += ' AND t.source = ?'; params.push(source); }
  if (search) {
    sql += " AND (LOWER(COALESCE(t.description, '')) LIKE ? OR LOWER(CAST(t.txn_date AS TEXT)) LIKE ?)";
    const term = `%${String(search).toLowerCase()}%`;
    params.push(term, term);
  }
  sql += ' ORDER BY t.txn_date DESC, t.id DESC';
  return { sql, params };
}

function buildTransactionReportCsv(rows) {
  const lines = [[
    'Date',
    'Description',
    'Amount',
    'Payment method',
    'Category',
    'Source',
    'Import batch',
  ].join(',')];

  let total = 0;
  for (const row of rows) {
    total += Number(row.amount || 0);
    lines.push([
      csvEscape(row.txn_date),
      csvEscape(row.description),
      Number(row.amount || 0).toFixed(2),
      csvEscape(row.payment_method),
      csvEscape(row.category_name || ''),
      csvEscape(row.source),
      csvEscape(row.import_batch_id || ''),
    ].join(','));
  }

  lines.push([
    csvEscape('TOTAL'),
    csvEscape(''),
    Number(total || 0).toFixed(2),
    csvEscape(''),
    csvEscape(''),
    csvEscape(''),
    csvEscape(''),
  ].join(','));

  return lines.join('\n');
}

router.get('/', async (req, res) => {
  const { sql, params } = buildTransactionsQuery(req.user.id, req.query);
  const rows = await db.prepare(sql).all(...params);
  res.json({ transactions: rows });
});

router.get('/report', async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  const { sql, params } = buildTransactionsQuery(req.user.id, req.query);
  const rows = await db.prepare(sql).all(...params);
  const totalAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="transactions-report.json"');
    return res.json({
      totalCount: rows.length,
      totalAmount,
      transactions: rows,
    });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions-report.csv"');
  return res.send(buildTransactionReportCsv(rows));
});

router.post('/', async (req, res) => {
  const { txnDate, description, amount, paymentMethod, categoryId, cashAccountId } = req.body || {};
  if (!txnDate || amount == null) return res.status(400).json({ error: 'txnDate and amount are required' });
  const cashAccountError = await validateCashAccountSelection(req.user.id, cashAccountId);
  if (cashAccountError) return res.status(400).json({ error: cashAccountError });

  const resolvedCategoryId = categoryId || await findCategoryForDescription(req.user.id, description);
  const info = await db.prepare(`
    INSERT INTO transactions (user_id, txn_date, description, amount, payment_method, category_id, source, cash_account_id)
    VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)
  `).run(req.user.id, txnDate, description || null, amount, paymentMethod || 'cash', resolvedCategoryId || null, cashAccountId || null);

  const row = await db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  await syncTransactionLedger(req.user.id, row);
  res.status(201).json({ transaction: row });
});

router.put('/:id', async (req, res) => {
  const { txnDate, description, amount, paymentMethod, categoryId, cashAccountId } = req.body || {};
  const existing = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });
  if (cashAccountId !== undefined) {
    const cashAccountError = await validateCashAccountSelection(req.user.id, cashAccountId);
    if (cashAccountError) return res.status(400).json({ error: cashAccountError });
  }

  await db.prepare(`
    UPDATE transactions SET txn_date = ?, description = ?, amount = ?, payment_method = ?, category_id = ?, cash_account_id = ?
    WHERE id = ? AND user_id = ?
  `).run(
    txnDate ?? existing.txn_date, description ?? existing.description, amount ?? existing.amount,
    paymentMethod ?? existing.payment_method, categoryId ?? existing.category_id,
    cashAccountId !== undefined ? (cashAccountId || null) : existing.cash_account_id,
    req.params.id, req.user.id
  );

  const row = await db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  await syncTransactionLedger(req.user.id, row);
  res.json({ transaction: row });
});

// Bulk edit imported (or any) transactions - e.g. assign category to many at once
router.put('/', async (req, res) => {
  const { ids, categoryId, paymentMethod } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array is required' });

  const tx = db.transaction(async (idList) => {
    for (const id of idList) {
      const existing = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, req.user.id);
      if (!existing) continue;
      await db.prepare('UPDATE transactions SET category_id = ?, payment_method = ? WHERE id = ?').run(
        categoryId ?? existing.category_id, paymentMethod ?? existing.payment_method, id
      );
      const updated = await db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
      await syncTransactionLedger(req.user.id, updated);
    }
  });
  await tx(ids);
  res.json({ success: true, updated: ids.length });
});

router.delete('/:id', async (req, res) => {
  await deleteLedgerEntriesForSource(req.user.id, 'transaction', req.params.id);
  await db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// CSV import from credit card company export
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required (field name "file")' });

  let records;
  try {
    records = parse(req.file.buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse CSV file: ' + e.message });
  }

  if (records.length === 0) return res.status(400).json({ error: 'CSV file contains no rows' });

  // Support common header variants from credit card exports
  const pickField = (row, candidates) => {
    const keys = Object.keys(row);
    for (const c of candidates) {
      const found = keys.find((k) => k.toLowerCase().replace(/[^a-z]/g, '') === c);
      if (found) return row[found];
    }
    return undefined;
  };

  const batchInfo = await db.prepare('INSERT INTO import_batches (user_id, filename, row_count) VALUES (?, ?, ?)')
    .run(req.user.id, req.file.originalname, records.length);
  const batchId = batchInfo.lastInsertRowid;

  const insert = db.prepare(`
    INSERT INTO transactions (user_id, txn_date, description, amount, payment_method, category_id, source, import_batch_id)
    VALUES (?, ?, ?, ?, ?, ?, 'csv_import', ?)
  `);

  let imported = 0;
  const importTx = db.transaction(async (rows) => {
    for (const row of rows) {
      const date = pickField(row, ['date', 'transactiondate', 'postdate', 'trandate']);
      const description = pickField(row, ['description', 'merchant', 'payee', 'name']);
      let amountRaw = pickField(row, ['amount', 'debit', 'charge']);
      if (amountRaw === undefined || amountRaw === '') continue;
      const amount = Number(String(amountRaw).replace(/[$,]/g, ''));
      if (!date || Number.isNaN(amount)) continue;

      const categoryId = await findCategoryForDescription(req.user.id, description);
      await insert.run(req.user.id, date, description || null, amount, 'credit_card', categoryId || null, batchId);
      imported += 1;
    }
  });
  await importTx(records);

  res.status(201).json({ batchId, rowsInFile: records.length, imported });
});

router.get('/import/batches', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM import_batches WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ batches: rows });
});

export default router;
