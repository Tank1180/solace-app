import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function findCategoryForDescription(userId, description) {
  if (!description) return null;
  const rules = db.prepare('SELECT * FROM category_rules WHERE user_id = ?').all(userId);
  const lower = description.toLowerCase();
  const match = rules.find((r) => lower.includes(r.match_text.toLowerCase()));
  return match ? match.category_id : null;
}

function buildTransactionsQuery(userId, query) {
  const { startDate, endDate, categoryId, paymentMethod, source, search } = query || {};
  let sql = `SELECT t.*, c.name as category_name FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id WHERE t.user_id = ?`;
  const params = [userId];
  if (startDate) { sql += ' AND t.txn_date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND t.txn_date <= ?'; params.push(endDate); }
  if (categoryId) { sql += ' AND t.category_id = ?'; params.push(categoryId); }
  if (paymentMethod) { sql += ' AND t.payment_method = ?'; params.push(paymentMethod); }
  if (source) { sql += ' AND t.source = ?'; params.push(source); }
  if (search) {
    sql += ' AND (LOWER(COALESCE(t.description, "")) LIKE ? OR LOWER(COALESCE(t.txn_date, "")) LIKE ?)';
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

router.get('/', (req, res) => {
  const { sql, params } = buildTransactionsQuery(req.user.id, req.query);
  const rows = db.prepare(sql).all(...params);
  res.json({ transactions: rows });
});

router.get('/report', (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  const { sql, params } = buildTransactionsQuery(req.user.id, req.query);
  const rows = db.prepare(sql).all(...params);
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

router.post('/', (req, res) => {
  const { txnDate, description, amount, paymentMethod, categoryId } = req.body || {};
  if (!txnDate || amount == null) return res.status(400).json({ error: 'txnDate and amount are required' });

  const resolvedCategoryId = categoryId || findCategoryForDescription(req.user.id, description);
  const info = db.prepare(`
    INSERT INTO transactions (user_id, txn_date, description, amount, payment_method, category_id, source)
    VALUES (?, ?, ?, ?, ?, ?, 'manual')
  `).run(req.user.id, txnDate, description || null, amount, paymentMethod || 'cash', resolvedCategoryId || null);

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ transaction: row });
});

router.put('/:id', (req, res) => {
  const { txnDate, description, amount, paymentMethod, categoryId } = req.body || {};
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });

  db.prepare(`
    UPDATE transactions SET txn_date = ?, description = ?, amount = ?, payment_method = ?, category_id = ?
    WHERE id = ? AND user_id = ?
  `).run(
    txnDate ?? existing.txn_date, description ?? existing.description, amount ?? existing.amount,
    paymentMethod ?? existing.payment_method, categoryId ?? existing.category_id,
    req.params.id, req.user.id
  );

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  res.json({ transaction: row });
});

// Bulk edit imported (or any) transactions - e.g. assign category to many at once
router.put('/', (req, res) => {
  const { ids, categoryId, paymentMethod } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array is required' });

  const tx = db.transaction((idList) => {
    for (const id of idList) {
      const existing = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, req.user.id);
      if (!existing) continue;
      db.prepare('UPDATE transactions SET category_id = ?, payment_method = ? WHERE id = ?').run(
        categoryId ?? existing.category_id, paymentMethod ?? existing.payment_method, id
      );
    }
  });
  tx(ids);
  res.json({ success: true, updated: ids.length });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// CSV import from credit card company export
router.post('/import', upload.single('file'), (req, res) => {
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

  const batchInfo = db.prepare('INSERT INTO import_batches (user_id, filename, row_count) VALUES (?, ?, ?)')
    .run(req.user.id, req.file.originalname, records.length);
  const batchId = batchInfo.lastInsertRowid;

  const insert = db.prepare(`
    INSERT INTO transactions (user_id, txn_date, description, amount, payment_method, category_id, source, import_batch_id)
    VALUES (?, ?, ?, ?, ?, ?, 'csv_import', ?)
  `);

  let imported = 0;
  const importTx = db.transaction((rows) => {
    for (const row of rows) {
      const date = pickField(row, ['date', 'transactiondate', 'postdate', 'trandate']);
      const description = pickField(row, ['description', 'merchant', 'payee', 'name']);
      let amountRaw = pickField(row, ['amount', 'debit', 'charge']);
      if (amountRaw === undefined || amountRaw === '') continue;
      const amount = Number(String(amountRaw).replace(/[$,]/g, ''));
      if (!date || Number.isNaN(amount)) continue;

      const categoryId = findCategoryForDescription(req.user.id, description);
      insert.run(req.user.id, date, description || null, amount, 'credit_card', categoryId || null, batchId);
      imported += 1;
    }
  });
  importTx(records);

  res.status(201).json({ batchId, rowsInFile: records.length, imported });
});

router.get('/import/batches', (req, res) => {
  const rows = db.prepare('SELECT * FROM import_batches WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ batches: rows });
});

export default router;
