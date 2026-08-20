import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';
import { CASH_ACCOUNT_TIERS, CASH_ACCOUNT_TYPE_VALUES, tierForAccountType } from '../lib/cashAccountTypes.js';
import { INVESTMENT_ACCOUNT_TIERS, classifyInvestmentAccountType } from '../lib/investmentAccountTiers.js';
import { buildPortfolioSnapshot } from './investments.js';
import { postLedgerEntry, deleteLedgerEntriesForSource, postedBalancesByAccount, projectedBalancesByAccount, accountLedgerHistory } from '../lib/accountLedger.js';

const router = Router();
router.use(authRequired);

router.get('/account-types', (req, res) => {
  res.json({ tiers: CASH_ACCOUNT_TIERS, investmentTiers: INVESTMENT_ACCOUNT_TIERS });
});

router.get('/accounts', async (req, res) => {
  const accounts = await db.prepare('SELECT * FROM cash_accounts WHERE user_id = ? ORDER BY tier, account_name').all(req.user.id);
  res.json({ accounts });
});

router.post('/accounts', async (req, res) => {
  const { accountName, accountType, institution, currency } = req.body || {};
  if (!accountName) return res.status(400).json({ error: 'accountName is required' });
  if (!CASH_ACCOUNT_TYPE_VALUES.has(accountType)) return res.status(400).json({ error: 'A valid accountType is required' });

  const tier = tierForAccountType(accountType);
  const info = await db.prepare(`
    INSERT INTO cash_accounts (user_id, account_name, account_type, tier, institution, currency)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, accountName, accountType, tier, institution || null, currency || 'USD');
  const row = await db.prepare('SELECT * FROM cash_accounts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ account: row });
});

router.put('/accounts/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Cash account not found' });
  const { accountName, accountType, institution, currency, isActive } = req.body || {};
  const finalAccountType = accountType && CASH_ACCOUNT_TYPE_VALUES.has(accountType) ? accountType : existing.account_type;
  const finalTier = finalAccountType === existing.account_type ? existing.tier : tierForAccountType(finalAccountType);

  await db.prepare(`
    UPDATE cash_accounts SET account_name = ?, account_type = ?, tier = ?, institution = ?, currency = ?, is_active = ?
    WHERE id = ? AND user_id = ?
  `).run(
    accountName ?? existing.account_name,
    finalAccountType,
    finalTier,
    institution ?? existing.institution,
    currency ?? existing.currency,
    isActive != null ? (isActive ? 1 : 0) : existing.is_active,
    req.params.id, req.user.id
  );
  const row = await db.prepare('SELECT * FROM cash_accounts WHERE id = ?').get(req.params.id);
  res.json({ account: row });
});

router.delete('/accounts/:id', async (req, res) => {
  await db.prepare('DELETE FROM cash_accounts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});


async function allocationRows(userId) {
  const paychecks = (await db.prepare(`
    SELECT p.*,
      COALESCE(SUM(CASE WHEN a.source_type = 'paycheck' THEN a.amount ELSE 0 END), 0) AS allocated_amount
    FROM paychecks p
    LEFT JOIN cash_allocations a ON a.source_type = 'paycheck' AND a.source_id = p.id AND a.user_id = p.user_id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.pay_date DESC
  `).all(userId)).map((p) => ({
    ...p,
    allocated_amount: Number(p.allocated_amount || 0),
    remaining_amount: Math.max(0, Number(p.net_pay || 0) - Number(p.allocated_amount || 0)),
  }));

  const otherIncome = (await db.prepare(`
    SELECT oi.*,
      COALESCE(SUM(CASE WHEN a.source_type = 'other_income' THEN a.amount ELSE 0 END), 0) AS allocated_amount
    FROM other_income oi
    LEFT JOIN cash_allocations a ON a.source_type = 'other_income' AND a.source_id = oi.id AND a.user_id = oi.user_id
    WHERE oi.user_id = ?
    GROUP BY oi.id
    ORDER BY oi.income_date DESC
  `).all(userId)).map((oi) => ({
    ...oi,
    allocated_amount: Number(oi.allocated_amount || 0),
    remaining_amount: Math.max(0, Number(oi.amount || 0) - Number(oi.allocated_amount || 0)),
  }));

  const allocations = await db.prepare(`
    SELECT a.*, ca.account_name, ca.account_type, ca.tier
    FROM cash_allocations a
    LEFT JOIN cash_accounts ca ON ca.id = a.cash_account_id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC
  `).all(userId);

  return { paychecks, otherIncome, allocations };
}

router.get('/allocations', async (req, res) => {
  res.json(await allocationRows(req.user.id));
});

async function allocateSource(req, res, sourceType, table, amountField, dateField, notFoundMessage) {
  const { sourceId, allocations } = req.body || {};
  const source = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(sourceId, req.user.id);
  if (!source) return res.status(404).json({ error: notFoundMessage });
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return res.status(400).json({ error: 'At least one destination account is required' });
  }
  if (allocations.some((item) => !item.cashAccountId || Number(item.amount || 0) <= 0)) {
    return res.status(400).json({ error: 'Each destination must include an account and a positive amount' });
  }

  const accounts = await db.prepare('SELECT * FROM cash_accounts WHERE user_id = ?').all(req.user.id);
  const accountIds = new Set(accounts.map((a) => String(a.id)));
  if (allocations.some((item) => !accountIds.has(String(item.cashAccountId)))) {
    return res.status(400).json({ error: 'One or more destination accounts were not found' });
  }
  const activeAccountIds = new Set(accounts.filter((a) => a.is_active).map((a) => String(a.id)));
  if (allocations.some((item) => !activeAccountIds.has(String(item.cashAccountId)))) {
    return res.status(400).json({ error: 'One or more destination accounts are inactive. Reactivate the account first.' });
  }

  const currentAllocated = (await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as v FROM cash_allocations WHERE user_id = ? AND source_type = ? AND source_id = ?
  `).get(req.user.id, sourceType, source.id)).v;
  const remaining = Math.max(0, Number(source[amountField] || 0) - Number(currentAllocated || 0));
  const requested = allocations.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (requested > remaining + 0.0001) {
    return res.status(400).json({ error: 'Allocation exceeds the remaining amount for this entry' });
  }

  const entryDate = source[dateField];
  const description = sourceType === 'paycheck'
    ? `Paycheck${source.employer ? ` — ${source.employer}` : ''}`
    : `Other income${source.description ? ` — ${source.description}` : ''}`;

  const tx = db.transaction(async (uid, sType, sId, items) => {
    const insert = db.prepare(`
      INSERT INTO cash_allocations (user_id, source_type, source_id, cash_account_id, amount)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      const info = await insert.run(uid, sType, sId, Number(item.cashAccountId), Number(item.amount || 0));
      await postLedgerEntry(uid, {
        cashAccountId: Number(item.cashAccountId),
        entryDate,
        direction: 'inflow',
        amount: Number(item.amount || 0),
        category: sType,
        description,
        sourceType: 'cash_allocation',
        sourceId: info.lastInsertRowid,
      });
    }
  });

  try {
    await tx(req.user.id, sourceType, source.id, allocations);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to allocate funds' });
  }

  res.status(201).json(await allocationRows(req.user.id));
}

router.post('/paycheck-allocations', (req, res) => (
  allocateSource(req, res, 'paycheck', 'paychecks', 'net_pay', 'pay_date', 'Paycheck not found')
));
router.post('/other-income-allocations', (req, res) => (
  allocateSource(req, res, 'other_income', 'other_income', 'amount', 'income_date', 'Other income entry not found')
));

router.delete('/allocations/:id', async (req, res) => {
  await deleteLedgerEntriesForSource(req.user.id, 'cash_allocation', req.params.id);
  await db.prepare('DELETE FROM cash_allocations WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

router.get('/transfers', async (req, res) => {
  const transfers = await db.prepare(`
    SELECT t.*, fa.account_name as from_account_name, ta.account_name as to_account_name
    FROM cash_transfers t
    LEFT JOIN cash_accounts fa ON fa.id = t.from_cash_account_id
    LEFT JOIN cash_accounts ta ON ta.id = t.to_cash_account_id
    WHERE t.user_id = ?
    ORDER BY t.transfer_date DESC, t.id DESC
  `).all(req.user.id);
  res.json({ transfers });
});

router.post('/transfers', async (req, res) => {
  const { fromCashAccountId, toCashAccountId, amount, transferDate, description } = req.body || {};
  if (!fromCashAccountId || !toCashAccountId) {
    return res.status(400).json({ error: 'fromCashAccountId and toCashAccountId are required' });
  }
  if (String(fromCashAccountId) === String(toCashAccountId)) {
    return res.status(400).json({ error: 'Source and destination accounts must be different' });
  }
  if (!(Number(amount) > 0)) {
    return res.status(400).json({ error: 'Amount must be greater than zero' });
  }
  if (!transferDate) {
    return res.status(400).json({ error: 'transferDate is required' });
  }

  const fromAccount = await db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND user_id = ?').get(fromCashAccountId, req.user.id);
  const toAccount = await db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND user_id = ?').get(toCashAccountId, req.user.id);
  if (!fromAccount || !toAccount) {
    return res.status(404).json({ error: 'One or both accounts were not found' });
  }
  if (!fromAccount.is_active || !toAccount.is_active) {
    return res.status(400).json({ error: 'Both accounts must be active to transfer funds. Reactivate the inactive account first.' });
  }

  const tx = db.transaction(async (uid, from, to, amt, date, desc) => {
    const info = await db.prepare(`
      INSERT INTO cash_transfers (user_id, from_cash_account_id, to_cash_account_id, amount, transfer_date, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uid, from.id, to.id, amt, date, desc || null);

    const label = desc || `Transfer: ${from.account_name} → ${to.account_name}`;
    await postLedgerEntry(uid, {
      cashAccountId: from.id, entryDate: date, direction: 'transfer_out', amount: amt,
      category: 'transfer', description: label, sourceType: 'transfer', sourceId: info.lastInsertRowid,
    });
    await postLedgerEntry(uid, {
      cashAccountId: to.id, entryDate: date, direction: 'transfer_in', amount: amt,
      category: 'transfer', description: label, sourceType: 'transfer', sourceId: info.lastInsertRowid,
    });
    return info.lastInsertRowid;
  });

  let transferId;
  try {
    transferId = await tx(req.user.id, fromAccount, toAccount, Number(amount), transferDate, description);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to create transfer' });
  }

  const transfer = await db.prepare(`
    SELECT t.*, fa.account_name as from_account_name, ta.account_name as to_account_name
    FROM cash_transfers t
    LEFT JOIN cash_accounts fa ON fa.id = t.from_cash_account_id
    LEFT JOIN cash_accounts ta ON ta.id = t.to_cash_account_id
    WHERE t.id = ?
  `).get(transferId);
  res.status(201).json({ transfer });
});

router.delete('/transfers/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM cash_transfers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Transfer not found' });
  await deleteLedgerEntriesForSource(req.user.id, 'transfer', req.params.id);
  await db.prepare('DELETE FROM cash_transfers WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

router.get('/settings', async (req, res) => {
  const user = await db.prepare('SELECT include_semi_liquid_in_available_cash FROM users WHERE id = ?').get(req.user.id);
  res.json({ includeSemiLiquidInAvailableCash: !!user?.include_semi_liquid_in_available_cash });
});

router.put('/settings', async (req, res) => {
  const { includeSemiLiquidInAvailableCash } = req.body || {};
  await db.prepare('UPDATE users SET include_semi_liquid_in_available_cash = ? WHERE id = ?')
    .run(includeSemiLiquidInAvailableCash ? 1 : 0, req.user.id);
  res.json({ includeSemiLiquidInAvailableCash: !!includeSemiLiquidInAvailableCash });
});

// Liquidity snapshot: Tier 1-3 totals are the true posted ledger balance (inflows and
// transfers-in, minus cash/check outflows and transfers-out) for each account, plus a
// projected balance that also includes pending (future-dated) items. Tier 4/5 totals reuse
// the Investments feature's live market values so users don't have to re-enter those accounts.
router.get('/liquidity-summary', async (req, res) => {
  const user = await db.prepare('SELECT include_semi_liquid_in_available_cash FROM users WHERE id = ?').get(req.user.id);
  const includeSemiLiquid = !!user?.include_semi_liquid_in_available_cash;

  const cashAccountRows = await db.prepare(`
    SELECT * FROM cash_accounts WHERE user_id = ? AND is_active = 1 ORDER BY tier, account_name
  `).all(req.user.id);
  const postedBalances = await postedBalancesByAccount(req.user.id);
  const projectedBalances = await projectedBalancesByAccount(req.user.id);
  const cashAccounts = cashAccountRows.map((acct) => {
    const balance = postedBalances.get(acct.id) || 0;
    const projectedBalance = projectedBalances.get(acct.id) || 0;
    return { ...acct, balance, projected_balance: projectedBalance, overdraft: balance < 0 };
  });

  const tier1Total = cashAccounts.filter((a) => a.tier === 1).reduce((s, a) => s + a.balance, 0);
  const tier2Total = cashAccounts.filter((a) => a.tier === 2).reduce((s, a) => s + a.balance, 0);
  const tier3Total = cashAccounts.filter((a) => a.tier === 3).reduce((s, a) => s + a.balance, 0);
  const tier1Projected = cashAccounts.filter((a) => a.tier === 1).reduce((s, a) => s + a.projected_balance, 0);
  const tier2Projected = cashAccounts.filter((a) => a.tier === 2).reduce((s, a) => s + a.projected_balance, 0);

  const investmentAccounts = await db.prepare('SELECT * FROM investment_accounts WHERE user_id = ? AND (is_active = 1 OR is_active IS NULL)').all(req.user.id);
  const { investments } = await buildPortfolioSnapshot(req.user.id, 'close');
  const valueByInvestmentAccount = new Map();
  for (const inv of investments) {
    if (inv.is_sold) continue;
    const current = valueByInvestmentAccount.get(inv.investment_account_id) || 0;
    const value = inv.market_value != null ? inv.market_value : inv.cost_basis;
    valueByInvestmentAccount.set(inv.investment_account_id, current + Number(value || 0));
  }

  let tier4Total = 0;
  let tier5Total = 0;
  const investmentAccountBreakdown = investmentAccounts.map((acct) => {
    const { tier, configWarning } = classifyInvestmentAccountType(acct.account_type);
    const value = valueByInvestmentAccount.get(acct.id) || 0;
    if (tier === 4) tier4Total += value;
    if (tier === 5) tier5Total += value;
    return { ...acct, tier, configWarning, current_value: value };
  });

  const availableCashToday = tier1Total + (includeSemiLiquid ? tier2Total : 0);
  const availableCashProjected = tier1Projected + (includeSemiLiquid ? tier2Projected : 0);
  const restrictedCash = tier3Total;
  const investedAssets = tier4Total;
  const retirementAssets = tier5Total;
  const totalCash = tier1Total + tier2Total + tier3Total + tier4Total + tier5Total;
  const overdraftAccounts = cashAccounts.filter((a) => a.overdraft);
  const configWarnings = investmentAccountBreakdown.filter((a) => a.configWarning);

  res.json({
    includeSemiLiquidInAvailableCash: includeSemiLiquid,
    availableCashToday,
    availableCashProjected,
    restrictedCash,
    investedAssets,
    retirementAssets,
    totalCash,
    overdraftAccounts,
    configWarnings,
    tiers: {
      tier1: { total: tier1Total, projectedTotal: tier1Projected, accounts: cashAccounts.filter((a) => a.tier === 1) },
      tier2: { total: tier2Total, projectedTotal: tier2Projected, accounts: cashAccounts.filter((a) => a.tier === 2) },
      tier3: { total: tier3Total, accounts: cashAccounts.filter((a) => a.tier === 3) },
      tier4: { total: tier4Total, accounts: investmentAccountBreakdown.filter((a) => a.tier === 4) },
      tier5: { total: tier5Total, accounts: investmentAccountBreakdown.filter((a) => a.tier === 5) },
    },
    methodologyNote: 'Tier 1-3 balances reflect income allocated to each account, transfers between accounts, and cash/check spending posted so far. "Projected" also includes scheduled items dated in the future.',
  });
});

router.get('/accounts/:id/ledger', async (req, res) => {
  const account = await db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!account) return res.status(404).json({ error: 'Cash account not found' });
  const ledger = await accountLedgerHistory(req.user.id, account.id);
  res.json({ account, ...ledger });
});

export default router;
