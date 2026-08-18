import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';
import { getMarketQuotes } from '../services/marketData.js';

const router = Router();
router.use(authRequired);

function normalizeMode(mode) {
  return mode === 'realtime' ? 'realtime' : 'close';
}

function withGains(inv) {
  const costBasis = Number(inv.shares || 0) * Number(inv.purchase_price || 0);
  const isSold = inv.sale_date != null && inv.sale_price != null;
  const currentValue = isSold ? Number(inv.shares || 0) * Number(inv.sale_price || 0) : null;
  const realizedGain = isSold ? currentValue - costBasis : 0;
  return {
    ...inv,
    cost_basis: costBasis,
    is_sold: isSold,
    realized_gain: isSold ? realizedGain : 0,
  };
}

function withMarketValues(investmentRows, quotes, mode) {
  let latestMarketTime = null;
  const rows = investmentRows.map((inv) => {
    const symbol = String(inv.symbol || '').trim().toUpperCase();
    const quote = quotes.get(symbol) || null;
    const marketPrice = !inv.is_sold && quote ? quote.marketPrice : null;
    const marketValue = marketPrice == null ? null : Number(inv.shares || 0) * marketPrice;
    const unrealizedGain = marketValue == null ? null : marketValue - Number(inv.cost_basis || 0);
    if (quote?.marketTime && (!latestMarketTime || quote.marketTime > latestMarketTime)) {
      latestMarketTime = quote.marketTime;
    }

    return {
      ...inv,
      market_mode: mode,
      market_price: marketPrice,
      market_value: marketValue,
      unrealized_gain: unrealizedGain,
      market_change: quote?.marketChange ?? null,
      market_change_percent: quote?.marketChangePercent ?? null,
      market_as_of: quote?.marketTime || null,
      market_currency: quote?.currency || null,
      market_source: quote?.sourceName || null,
    };
  });

  const pricedRows = rows.filter((row) => !row.is_sold && row.market_value != null);
  const openRows = rows.filter((row) => !row.is_sold);
  const soldRows = rows.filter((row) => row.is_sold);
  const totalMarketValue = pricedRows.reduce((sum, row) => sum + Number(row.market_value || 0), 0);
  const totalCostBasis = openRows.reduce((sum, row) => sum + Number(row.cost_basis || 0), 0);
  const totalUnrealizedGain = pricedRows.reduce((sum, row) => sum + Number(row.unrealized_gain || 0), 0);

  return {
    rows,
    summary: {
      market_mode: mode,
      market_as_of: latestMarketTime || new Date().toISOString(),
      total_market_value: totalMarketValue,
      total_cost_basis: totalCostBasis,
      total_unrealized_gain: totalUnrealizedGain,
      priced_holdings: pricedRows.length,
      unpriced_holdings: openRows.length - pricedRows.length,
      sold_holdings: soldRows.length,
    },
  };
}

function aggregateHoldings(rows) {
  const groups = new Map();

  for (const row of rows) {
    if (row.is_sold || row.market_value == null) continue;
    const key = [
      row.investment_account_id,
      row.account_name || '',
      row.account_type || '',
      String(row.symbol || '').toUpperCase(),
    ].join('|');

    const current = groups.get(key) || {
      account_name: row.account_name || '',
      account_type: row.account_type || '',
      symbol: String(row.symbol || '').toUpperCase(),
      shares: 0,
      cost_basis: 0,
      market_price: row.market_price,
      market_value: 0,
      unrealized_gain: 0,
      market_as_of: row.market_as_of,
      market_currency: row.market_currency,
      market_source: row.market_source,
    };

    current.shares += Number(row.shares || 0);
    current.cost_basis += Number(row.cost_basis || 0);
    current.market_value += Number(row.market_value || 0);
    current.unrealized_gain += Number(row.unrealized_gain || 0);
    if (row.market_as_of && (!current.market_as_of || row.market_as_of > current.market_as_of)) {
      current.market_as_of = row.market_as_of;
    }
    groups.set(key, current);
  }

  return [...groups.values()].sort((a, b) => a.account_name.localeCompare(b.account_name) || a.symbol.localeCompare(b.symbol));
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildPortfolioCsv(reportRows, summary) {
  const lines = [
    [
      'Account',
      'Account type',
      'Symbol',
      'Shares',
      'Cost basis',
      'Market price',
      'Market value',
      'Unrealized gain',
      'As of',
    ].join(','),
  ];

  for (const row of reportRows) {
    lines.push([
      csvEscape(row.account_name),
      csvEscape(row.account_type),
      csvEscape(row.symbol),
      row.shares.toFixed(4),
      Number(row.cost_basis || 0).toFixed(2),
      row.market_price == null ? '' : Number(row.market_price).toFixed(2),
      Number(row.market_value || 0).toFixed(2),
      Number(row.unrealized_gain || 0).toFixed(2),
      csvEscape(row.market_as_of || ''),
    ].join(','));
  }

  lines.push([
    csvEscape('TOTAL'),
    csvEscape(''),
    csvEscape(''),
    '',
    Number(summary.total_cost_basis || 0).toFixed(2),
    '',
    Number(summary.total_market_value || 0).toFixed(2),
    Number(summary.total_unrealized_gain || 0).toFixed(2),
    csvEscape(summary.market_as_of || ''),
  ].join(','));

  return lines.join('\n');
}

async function buildPortfolioSnapshot(userId, mode) {
  const normalizedMode = normalizeMode(mode);
  const investmentRows = db.prepare(`
    SELECT i.*, ia.account_name, ia.account_type, ia.institution
    FROM investments i
    LEFT JOIN investment_accounts ia ON ia.id = i.investment_account_id
    WHERE i.user_id = ?
    ORDER BY i.purchase_date DESC, i.id DESC
  `).all(userId).map(withGains);

  const symbols = investmentRows.filter((row) => !row.is_sold).map((row) => row.symbol);
  const { quotes, failures } = await getMarketQuotes(symbols, normalizedMode);
  const { rows, summary } = withMarketValues(investmentRows, quotes, normalizedMode);
  const reportRows = aggregateHoldings(rows);

  return {
    investments: rows,
    marketSummary: summary,
    reportRows,
    failures,
  };
}

router.get('/accounts', (req, res) => {
  const rows = db.prepare('SELECT * FROM investment_accounts WHERE user_id = ? ORDER BY account_name').all(req.user.id);
  res.json({ accounts: rows });
});

router.post('/accounts', (req, res) => {
  const { accountName, accountType, institution } = req.body || {};
  if (!accountName) return res.status(400).json({ error: 'accountName is required' });
  const info = db.prepare('INSERT INTO investment_accounts (user_id, account_name, account_type, institution) VALUES (?, ?, ?, ?)')
    .run(req.user.id, accountName, accountType || 'brokerage', institution || null);
  const row = db.prepare('SELECT * FROM investment_accounts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ account: row });
});

router.delete('/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM investment_accounts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

function retirementRows(userId) {
  const paychecks = db.prepare(`
    SELECT p.*,
      COALESCE(SUM(a.amount), 0) AS allocated_amount
    FROM paychecks p
    LEFT JOIN retirement_contribution_allocations a
      ON a.paycheck_id = p.id AND a.user_id = p.user_id
    WHERE p.user_id = ? AND p.retirement_contribution > 0
    GROUP BY p.id
    ORDER BY p.pay_date DESC
  `).all(userId).map((p) => ({
    ...p,
    allocated_amount: Number(p.allocated_amount || 0),
    remaining_amount: Math.max(0, Number(p.retirement_contribution || 0) - Number(p.allocated_amount || 0)),
  }));

  const allocations = db.prepare(`
    SELECT a.*, p.pay_date, p.employer, ia.account_name, ia.account_type, i.symbol
    FROM retirement_contribution_allocations a
    LEFT JOIN paychecks p ON p.id = a.paycheck_id
    LEFT JOIN investment_accounts ia ON ia.id = a.investment_account_id
    LEFT JOIN investments i ON i.id = a.investment_id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC
  `).all(userId);

  return { paychecks, allocations };
}

router.get('/retirement-allocations', (req, res) => {
  res.json(retirementRows(req.user.id));
});

router.post('/retirement-allocations', (req, res) => {
  const { paycheckId, investmentAccountId, allocations } = req.body || {};
  const paycheck = db.prepare('SELECT * FROM paychecks WHERE id = ? AND user_id = ?').get(paycheckId, req.user.id);
  const account = db.prepare('SELECT * FROM investment_accounts WHERE id = ? AND user_id = ?').get(investmentAccountId, req.user.id);
  if (!paycheck) return res.status(404).json({ error: 'Paycheck not found' });
  if (!account) return res.status(404).json({ error: 'Investment account not found' });
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return res.status(400).json({ error: 'At least one allocation destination is required' });
  }

  const currentAllocated = db.prepare('SELECT COALESCE(SUM(amount), 0) as v FROM retirement_contribution_allocations WHERE user_id = ? AND paycheck_id = ?')
    .get(req.user.id, paycheck.id).v;
  const remaining = Math.max(0, Number(paycheck.retirement_contribution || 0) - Number(currentAllocated || 0));
  const requested = allocations.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (requested <= 0) return res.status(400).json({ error: 'Allocation amounts must be greater than zero' });
  if (allocations.some((item) => !item.symbol || Number(item.amount || 0) <= 0)) {
    return res.status(400).json({ error: 'Each allocation destination must include a symbol and a positive amount' });
  }
  if (requested > remaining + 0.0001) {
    return res.status(400).json({ error: 'Allocation exceeds the remaining retirement contribution' });
  }

  const tx = db.transaction((uid, pid, acctId, items) => {
    const insert = db.prepare(`
      INSERT INTO retirement_contribution_allocations
        (user_id, paycheck_id, investment_account_id, investment_id, amount)
      VALUES (?, ?, ?, ?, ?)
    `);
    const findInvestmentBySymbol = db.prepare(`
      SELECT * FROM investments
      WHERE user_id = ? AND investment_account_id = ? AND UPPER(symbol) = UPPER(?)
      LIMIT 1
    `);
    const insertInvestment = db.prepare(`
      INSERT INTO investments (user_id, investment_account_id, symbol, shares, purchase_date, purchase_price, sale_date, sale_price)
      VALUES (?, ?, ?, 0, date('now'), 0, NULL, NULL)
    `);
    for (const item of items) {
      const symbol = String(item.symbol || '').trim().toUpperCase();
      let investment = findInvestmentBySymbol.get(uid, acctId, symbol);
      if (!investment) {
        const info = insertInvestment.run(uid, acctId, symbol);
        investment = db.prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?').get(info.lastInsertRowid, uid);
      }
      insert.run(uid, pid, acctId, investment.id, Number(item.amount || 0));
    }
  });

  try {
    tx(req.user.id, paycheck.id, account.id, allocations);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to allocate retirement contribution' });
  }

  res.status(201).json(retirementRows(req.user.id));
});

router.delete('/retirement-allocations/:id', (req, res) => {
  db.prepare('DELETE FROM retirement_contribution_allocations WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

router.get('/', async (req, res) => {
  try {
    const { investments, marketSummary, failures } = await buildPortfolioSnapshot(req.user.id, req.query.mode);
    res.json({ investments, marketSummary, marketWarnings: failures });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load investments' });
  }
});

router.post('/', (req, res) => {
  const { investmentAccountId, symbol, shares, purchaseDate, purchasePrice, saleDate, salePrice } = req.body || {};
  if (!investmentAccountId || !symbol || !shares || !purchaseDate || purchasePrice == null) {
    return res.status(400).json({ error: 'investmentAccountId, symbol, shares, purchaseDate, purchasePrice are required' });
  }
  const info = db.prepare(`
    INSERT INTO investments (user_id, investment_account_id, symbol, shares, purchase_date, purchase_price, sale_date, sale_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, investmentAccountId, symbol.toUpperCase(), shares, purchaseDate, purchasePrice, saleDate || null, salePrice ?? null);

  const row = db.prepare('SELECT * FROM investments WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ investment: withGains(row) });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Investment not found' });
  const { symbol, shares, purchaseDate, purchasePrice, saleDate, salePrice } = req.body || {};

  db.prepare(`
    UPDATE investments SET symbol = ?, shares = ?, purchase_date = ?, purchase_price = ?, sale_date = ?, sale_price = ?
    WHERE id = ? AND user_id = ?
  `).run(
    (symbol ?? existing.symbol).toUpperCase(), shares ?? existing.shares, purchaseDate ?? existing.purchase_date,
    purchasePrice ?? existing.purchase_price, saleDate ?? existing.sale_date, salePrice ?? existing.sale_price,
    req.params.id, req.user.id
  );

  const row = db.prepare('SELECT * FROM investments WHERE id = ?').get(req.params.id);
  res.json({ investment: withGains(row) });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM investments WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

router.get('/report', async (req, res) => {
  try {
    const format = String(req.query.format || 'json').toLowerCase();
    const { marketSummary, reportRows } = await buildPortfolioSnapshot(req.user.id, req.query.mode);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="portfolio-report-${marketSummary.market_as_of.slice(0, 10)}.csv"`);
      return res.send(buildPortfolioCsv(reportRows, marketSummary));
    }

    res.setHeader('Content-Disposition', `attachment; filename="portfolio-report-${marketSummary.market_as_of.slice(0, 10)}.json"`);
    return res.json({ marketSummary, holdings: reportRows });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to build portfolio report' });
  }
});

// Dividends
router.get('/dividends', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*,
      COALESCE(SUM(a.amount), 0) AS allocated_amount
    FROM dividends d
    LEFT JOIN dividend_allocations a ON a.dividend_id = d.id AND a.user_id = d.user_id
    WHERE d.user_id = ?
    GROUP BY d.id
    ORDER BY d.pay_date DESC
  `).all(req.user.id).map((d) => ({
    ...d,
    allocated_amount: Number(d.allocated_amount || 0),
    remaining_amount: Math.max(0, Number(d.amount || 0) - Number(d.allocated_amount || 0)),
  }));
  res.json({ dividends: rows });
});

router.post('/dividends', (req, res) => {
  const { investmentAccountId, symbol, payDate, amount, disposition } = req.body || {};
  if (!investmentAccountId || !symbol || !payDate || amount == null) {
    return res.status(400).json({ error: 'investmentAccountId, symbol, payDate, amount are required' });
  }
  const finalDisposition = disposition === 'reinvested' ? 'reinvested' : 'cash';
  const info = db.prepare('INSERT INTO dividends (user_id, investment_account_id, symbol, pay_date, amount, disposition) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, investmentAccountId, symbol.toUpperCase(), payDate, amount, finalDisposition);
  const row = db.prepare('SELECT * FROM dividends WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ dividend: row });
});

router.post('/dividend-allocations', (req, res) => {
  const { dividendId, actionType, investmentAccountId, symbol, shares, purchaseDate, purchasePrice, payDate, description } = req.body || {};
  const dividend = db.prepare('SELECT * FROM dividends WHERE id = ? AND user_id = ?').get(dividendId, req.user.id);
  if (!dividend) return res.status(404).json({ error: 'Dividend not found' });
  if (dividend.disposition !== 'cash') return res.status(400).json({ error: 'Only cash dividends can be allocated or cashed out' });

  const allocated = db.prepare('SELECT COALESCE(SUM(amount), 0) as v FROM dividend_allocations WHERE user_id = ? AND dividend_id = ?')
    .get(req.user.id, dividend.id).v;
  const remaining = Math.max(0, Number(dividend.amount || 0) - Number(allocated || 0));
  if (remaining <= 0) return res.status(400).json({ error: 'This dividend has already been fully allocated' });

  if (Number(purchasePrice || 0) > 0 && Number(shares || 0) <= 0 && actionType === 'investment') {
    return res.status(400).json({ error: 'Shares are required for an investment allocation' });
  }

  if (actionType === 'cash_out') {
    if (!payDate) return res.status(400).json({ error: 'payDate is required to cash out a dividend' });
    const incomeInfo = db.prepare(`
      INSERT INTO other_income (user_id, income_date, income_group, category, description, amount, is_taxable, is_self_employment)
      VALUES (?, ?, 'financial', 'dividend_cashout', ?, ?, 1, 0)
    `).run(req.user.id, payDate, description || `Dividend cash-out ${dividend.symbol}`, remaining);
    const income = db.prepare('SELECT * FROM other_income WHERE id = ?').get(incomeInfo.lastInsertRowid);
    const allocInfo = db.prepare(`
      INSERT INTO dividend_allocations (user_id, dividend_id, action_type, other_income_id, amount)
      VALUES (?, ?, 'cash_out', ?, ?)
    `).run(req.user.id, dividend.id, income.id, remaining);
    const allocation = db.prepare('SELECT * FROM dividend_allocations WHERE id = ?').get(allocInfo.lastInsertRowid);
    return res.status(201).json({ allocation, otherIncome: income });
  }

  if (!investmentAccountId || !symbol || !purchaseDate) {
    return res.status(400).json({ error: 'investmentAccountId, symbol, and purchaseDate are required to allocate to an investment' });
  }

  const account = db.prepare('SELECT * FROM investment_accounts WHERE id = ? AND user_id = ?').get(investmentAccountId, req.user.id);
  if (!account) return res.status(404).json({ error: 'Investment account not found' });

  const finalShares = Number(shares || 1);
  const finalPurchasePrice = purchasePrice != null ? Number(purchasePrice) : remaining;
  const investmentInfo = db.prepare(`
    INSERT INTO investments (user_id, investment_account_id, symbol, shares, purchase_date, purchase_price, sale_date, sale_price)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(req.user.id, account.id, String(symbol).toUpperCase(), finalShares, purchaseDate, finalPurchasePrice);
  const investment = db.prepare('SELECT * FROM investments WHERE id = ?').get(investmentInfo.lastInsertRowid);
  const allocInfo = db.prepare(`
    INSERT INTO dividend_allocations (user_id, dividend_id, action_type, investment_id, amount)
    VALUES (?, ?, 'investment', ?, ?)
  `).run(req.user.id, dividend.id, investment.id, remaining);
  const allocation = db.prepare('SELECT * FROM dividend_allocations WHERE id = ?').get(allocInfo.lastInsertRowid);
  res.status(201).json({ allocation, investment });
});

router.delete('/dividends/:id', (req, res) => {
  db.prepare('DELETE FROM dividends WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

export default router;
