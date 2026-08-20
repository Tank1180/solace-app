import db from '../db/index.js';

// Unified per-account transaction ledger. Every posted cash movement affecting a Tier 1-3
// cash account — paycheck/other-income allocations (inflows), cash/check spending (outflows),
// and (in a later phase) transfers — is recorded here so account balances can be computed
// consistently instead of relying on separate ad-hoc aggregates.

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Entries dated in the future are not yet "real" money movements from the account's
// perspective, so they're marked Pending rather than Posted until their date arrives.
function statusForDate(entryDate) {
  return entryDate > todayKey() ? 'pending' : 'posted';
}

export async function postLedgerEntry(userId, {
  cashAccountId, entryDate, direction, amount, category, description, sourceType, sourceId,
}) {
  const info = await db.prepare(`
    INSERT INTO account_ledger_entries
      (user_id, cash_account_id, entry_date, direction, amount, category, description, status, source_type, source_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, cashAccountId, entryDate, direction, Number(amount || 0),
    category || null, description || null, statusForDate(entryDate), sourceType || null, sourceId ?? null
  );
  return db.prepare('SELECT * FROM account_ledger_entries WHERE id = ?').get(info.lastInsertRowid);
}

export async function deleteLedgerEntriesForSource(userId, sourceType, sourceId) {
  await db.prepare('DELETE FROM account_ledger_entries WHERE user_id = ? AND source_type = ? AND source_id = ?')
    .run(userId, sourceType, sourceId);
}

function signedAmount(direction, amount) {
  const isInflow = direction === 'inflow' || direction === 'transfer_in';
  return isInflow ? Number(amount || 0) : -Number(amount || 0);
}

// Net balance per cash account for a given set of statuses. Passing ['posted'] gives
// AvailableCashToday's building block; passing ['posted', 'pending'] gives the projected
// balance if every currently scheduled item happens as dated.
async function balancesByAccountForStatuses(userId, statuses) {
  const placeholders = statuses.map(() => '?').join(', ');
  const rows = await db.prepare(`
    SELECT cash_account_id,
      COALESCE(SUM(CASE WHEN direction IN ('inflow', 'transfer_in') THEN amount ELSE 0 END), 0) AS inflow_total,
      COALESCE(SUM(CASE WHEN direction IN ('outflow', 'transfer_out') THEN amount ELSE 0 END), 0) AS outflow_total
    FROM account_ledger_entries
    WHERE user_id = ? AND status IN (${placeholders})
    GROUP BY cash_account_id
  `).all(userId, ...statuses);

  const byAccount = new Map();
  for (const row of rows) {
    byAccount.set(row.cash_account_id, Number(row.inflow_total || 0) - Number(row.outflow_total || 0));
  }
  return byAccount;
}

// Net posted balance (inflows minus outflows/transfers-out, plus transfers-in) per cash
// account, as of today. This is the "AvailableCashToday" building block for Tier 1-3.
export async function postedBalancesByAccount(userId) {
  return balancesByAccountForStatuses(userId, ['posted']);
}

// Posted + pending (future-dated) balance per account — "what my balance will be if every
// scheduled item posts as dated." Used for AvailableCashAfterScheduledItems style forecasting.
export async function projectedBalancesByAccount(userId) {
  return balancesByAccountForStatuses(userId, ['posted', 'pending']);
}

// Chronological running balance for a single account: Balance[Date] = previous balance +
// today's inflows - today's outflows, processed in ascending date order. Only posted entries
// contribute to the running balance; pending (future-dated) entries are returned separately
// so the UI can show them without folding them into the historical balance line.
export async function accountLedgerHistory(userId, cashAccountId) {
  const entries = await db.prepare(`
    SELECT * FROM account_ledger_entries
    WHERE user_id = ? AND cash_account_id = ?
    ORDER BY entry_date ASC, id ASC
  `).all(userId, cashAccountId);

  const posted = entries.filter((e) => e.status === 'posted');
  const pending = entries.filter((e) => e.status === 'pending');

  let runningBalance = 0;
  const history = posted.map((entry) => {
    runningBalance += signedAmount(entry.direction, entry.amount);
    return { ...entry, running_balance: runningBalance };
  });

  const projectedBalance = pending.reduce((sum, entry) => sum + signedAmount(entry.direction, entry.amount), runningBalance);

  return {
    history,
    pending,
    postedBalance: runningBalance,
    projectedBalance,
  };
}
