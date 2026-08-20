import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool, types } = pg;

// By default node-postgres parses DATE/TIMESTAMP columns into JS Date objects.
// The rest of this app treats dates as plain 'YYYY-MM-DD' strings (comparisons, slicing, etc.),
// matching SQLite's behavior. Keep Postgres returning raw strings so date logic works identically.
types.setTypeParser(1082, (value) => value); // DATE
types.setTypeParser(1114, (value) => value); // TIMESTAMP WITHOUT TIME ZONE
types.setTypeParser(1184, (value) => value); // TIMESTAMP WITH TIME ZONE

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', '..', 'finance.db');
const isPostgres = /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '');

const DEFAULT_CATEGORIES = [
  'Groceries', 'Dining', 'Rent/Mortgage', 'Utilities', 'Transportation',
  'Insurance', 'Healthcare', 'Entertainment', 'Shopping', 'Travel',
  'Subscriptions', 'Education', 'Personal Care', 'Business Expense', 'Other',
];

function replaceQuestionPlaceholders(sql) {
  let output = '';
  let placeholderIndex = 1;
  let inString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];

    if (char === "'") {
      output += char;
      if (inString && sql[i + 1] === "'") {
        output += "'";
        i += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (!inString && char === '?') {
      output += `$${placeholderIndex}`;
      placeholderIndex += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function normalizePostgresSql(sql) {
  let normalized = sql.trim();
  let insertOrIgnore = false;

  if (/^\s*INSERT\s+OR\s+IGNORE\b/i.test(normalized)) {
    insertOrIgnore = true;
    normalized = normalized.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT');
  }

  normalized = normalized
    .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/date\('now'\)/gi, 'CURRENT_DATE')
    .replace(/strftime\('%Y-%m',\s*([^)]+)\)/gi, (_, expr) => `TO_CHAR(${expr.trim()}::date, 'YYYY-MM')`)
    .replace(/strftime\('%Y',\s*([^)]+)\)/gi, (_, expr) => `TO_CHAR(${expr.trim()}::date, 'YYYY')`)
    .replace(/""/g, "''");

  normalized = replaceQuestionPlaceholders(normalized);

  if (insertOrIgnore && !/\bON\s+CONFLICT\b/i.test(normalized)) {
    normalized = `${normalized} ON CONFLICT DO NOTHING`;
  }

  return normalized;
}

function createSqliteCompatDatabase(sqliteDb) {
  return {
    backend: 'sqlite',
    prepare(sql) {
      const statement = sqliteDb.prepare(sql);
      return {
        get: async (...params) => statement.get(...params),
        all: async (...params) => statement.all(...params),
        run: async (...params) => statement.run(...params),
      };
    },
    exec: async (sql) => {
      sqliteDb.exec(sql);
    },
    transaction(fn) {
      return async (...args) => {
        sqliteDb.exec('BEGIN');
        try {
          const result = await fn(...args);
          sqliteDb.exec('COMMIT');
          return result;
        } catch (err) {
          sqliteDb.exec('ROLLBACK');
          throw err;
        }
      };
    },
  };
}

function createPostgresCompatDatabase() {
  const transactionStore = new AsyncLocalStorage();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
  });

  async function query(text, params = []) {
    const executor = transactionStore.getStore() || pool;
    return executor.query(text, params);
  }

  return {
    backend: 'postgres',
    pool,
    async connect() {
      await pool.query('SELECT 1');
    },
    prepare(sql) {
      const normalized = normalizePostgresSql(sql);

      return {
        get: async (...params) => {
          const result = await query(normalized, params);
          return result.rows[0];
        },
        all: async (...params) => {
          const result = await query(normalized, params);
          return result.rows;
        },
        run: async (...params) => {
          const text = /^\s*insert\b/i.test(normalized) && !/\breturning\b/i.test(normalized)
            ? `${normalized} RETURNING id`
            : normalized;
          const result = await query(text, params);
          return {
            changes: result.rowCount || 0,
            lastInsertRowid: result.rows[0]?.id,
          };
        },
      };
    },
    async exec(sql) {
      await query(sql);
    },
    transaction(fn) {
      return async (...args) => {
        const existingClient = transactionStore.getStore();
        if (existingClient) {
          return fn(...args);
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await transactionStore.run(client, () => fn(...args));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      };
    },
  };
}

function bootstrapSqlite(sqliteDb) {
  sqliteDb.exec('PRAGMA journal_mode = WAL');
  sqliteDb.exec('PRAGMA foreign_keys = ON');

  sqliteDb.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  date_of_birth TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  account_type TEXT NOT NULL DEFAULT 'individual',
  customer_type TEXT NOT NULL DEFAULT 'personal',
  business_name TEXT,
  spouse_first_name TEXT,
  spouse_last_name TEXT,
  spouse_date_of_birth TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS paychecks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL DEFAULT 'self',
  pay_date TEXT NOT NULL,
  employer TEXT,
  gross_pay REAL NOT NULL DEFAULT 0,
  federal_tax REAL NOT NULL DEFAULT 0,
  state_tax REAL NOT NULL DEFAULT 0,
  social_security REAL NOT NULL DEFAULT 0,
  medicare REAL NOT NULL DEFAULT 0,
  benefits_deduction REAL NOT NULL DEFAULT 0,
  retirement_contribution REAL NOT NULL DEFAULT 0,
  net_pay REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  txn_date TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  import_batch_id INTEGER,
  cash_account_id INTEGER REFERENCES cash_accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bill_name TEXT NOT NULL,
  category TEXT NOT NULL,
  bill_type TEXT NOT NULL DEFAULT 'one_time',
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL,
  recurrence_unit TEXT,
  recurrence_interval_count INTEGER NOT NULL DEFAULT 1,
  recurrence_count INTEGER,
  recurrence_end_type TEXT,
  recurrence_end_date TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_text TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investment_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'brokerage',
  institution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investment_account_id INTEGER NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  shares REAL NOT NULL,
  purchase_date TEXT NOT NULL,
  purchase_price REAL NOT NULL,
  sale_date TEXT,
  sale_price REAL,
  pending_shares INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dividends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investment_account_id INTEGER NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  amount REAL NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'cash',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dividend_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dividend_id INTEGER NOT NULL REFERENCES dividends(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  investment_id INTEGER REFERENCES investments(id) ON DELETE CASCADE,
  other_income_id INTEGER REFERENCES other_income(id) ON DELETE CASCADE,
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS retirement_contribution_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paycheck_id INTEGER NOT NULL REFERENCES paychecks(id) ON DELETE CASCADE,
  investment_account_id INTEGER NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
  investment_id INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'checking',
  tier INTEGER NOT NULL DEFAULT 1,
  institution TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'posted',
  source_type TEXT,
  source_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
  to_cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  transfer_date TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dependents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT,
  date_of_birth TEXT,
  relationship TEXT NOT NULL DEFAULT 'child',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ded_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  miles REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS other_income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  income_date TEXT NOT NULL,
  income_group TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  is_taxable INTEGER NOT NULL DEFAULT 1,
  is_self_employment INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  customer_type TEXT NOT NULL DEFAULT 'personal',
  monthly_price REAL NOT NULL DEFAULT 0,
  yearly_price REAL NOT NULL DEFAULT 0,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quarterly_tax_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL,
  paid_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_years (
  tax_year INTEGER PRIMARY KEY,
  social_security_rate REAL NOT NULL DEFAULT 0.062,
  social_security_wage_base REAL NOT NULL DEFAULT 168600,
  medicare_rate REAL NOT NULL DEFAULT 0.0145,
  additional_medicare_rate REAL NOT NULL DEFAULT 0.009,
  additional_medicare_threshold REAL NOT NULL DEFAULT 200000,
  mileage_rate REAL NOT NULL DEFAULT 0.67,
  capital_gains_rate REAL NOT NULL DEFAULT 0.15,
  self_employment_rate REAL NOT NULL DEFAULT 0.153,
  child_tax_credit REAL NOT NULL DEFAULT 2000,
  default_state_rate REAL NOT NULL DEFAULT 0.05,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_standard_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tax_year INTEGER NOT NULL REFERENCES tax_years(tax_year) ON DELETE CASCADE,
  filing_status TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  UNIQUE(tax_year, filing_status)
);

CREATE TABLE IF NOT EXISTS tax_brackets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tax_year INTEGER NOT NULL REFERENCES tax_years(tax_year) ON DELETE CASCADE,
  filing_status TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  upto_income REAL,
  rate REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_state_taxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tax_year INTEGER NOT NULL REFERENCES tax_years(tax_year) ON DELETE CASCADE,
  state_code TEXT NOT NULL,
  tax_name TEXT NOT NULL,
  tax_type TEXT NOT NULL DEFAULT 'state_income',
  rate REAL NOT NULL DEFAULT 0,
  wage_base REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

  const existingUserColumns = sqliteDb.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  for (const col of ['spouse_first_name', 'spouse_last_name', 'spouse_date_of_birth']) {
    if (!existingUserColumns.includes(col)) {
      sqliteDb.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
    }
  }
  if (!existingUserColumns.includes('filing_status')) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN filing_status TEXT NOT NULL DEFAULT 'single'");
  }
  if (!existingUserColumns.includes('customer_type')) {
    sqliteDb.exec("ALTER TABLE users ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'personal'");
    sqliteDb.exec("UPDATE users SET customer_type = 'business' WHERE account_type IN ('sole_proprietor', 'partnership', 's_corp')");
  }
  if (!existingUserColumns.includes('plan_id')) {
    sqliteDb.exec('ALTER TABLE users ADD COLUMN plan_id INTEGER REFERENCES subscription_plans(id)');
  }
  if (!existingUserColumns.includes('include_semi_liquid_in_available_cash')) {
    sqliteDb.exec('ALTER TABLE users ADD COLUMN include_semi_liquid_in_available_cash INTEGER NOT NULL DEFAULT 0');
  }

  const existingDividendColumns = sqliteDb.prepare("PRAGMA table_info(dividends)").all().map((c) => c.name);
  if (!existingDividendColumns.includes('disposition')) {
    sqliteDb.exec("ALTER TABLE dividends ADD COLUMN disposition TEXT NOT NULL DEFAULT 'cash'");
  }

  const existingPaycheckColumns = sqliteDb.prepare("PRAGMA table_info(paychecks)").all().map((c) => c.name);
  if (!existingPaycheckColumns.includes('owner_type')) {
    sqliteDb.exec("ALTER TABLE paychecks ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'self'");
  }

  const existingInvestmentAccountColumns = sqliteDb.prepare("PRAGMA table_info(investment_accounts)").all().map((c) => c.name);
  if (!existingInvestmentAccountColumns.includes('current_balance')) {
    sqliteDb.exec('ALTER TABLE investment_accounts ADD COLUMN current_balance REAL NOT NULL DEFAULT 0');
  }
  if (!existingInvestmentAccountColumns.includes('is_active')) {
    sqliteDb.exec('ALTER TABLE investment_accounts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  }

  const existingCashAccountColumns = sqliteDb.prepare("PRAGMA table_info(cash_accounts)").all().map((c) => c.name);
  if (existingCashAccountColumns.length > 0) {
    if (!existingCashAccountColumns.includes('is_active')) sqliteDb.exec('ALTER TABLE cash_accounts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
    if (!existingCashAccountColumns.includes('currency')) sqliteDb.exec("ALTER TABLE cash_accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'");
  }

  const existingTransactionColumns = sqliteDb.prepare("PRAGMA table_info(transactions)").all().map((c) => c.name);
  if (existingTransactionColumns.length > 0 && !existingTransactionColumns.includes('cash_account_id')) {
    sqliteDb.exec('ALTER TABLE transactions ADD COLUMN cash_account_id INTEGER');
  }

  const existingInvestmentColumns = sqliteDb.prepare("PRAGMA table_info(investments)").all().map((c) => c.name);
  if (!existingInvestmentColumns.includes('pending_shares')) {
    sqliteDb.exec('ALTER TABLE investments ADD COLUMN pending_shares INTEGER NOT NULL DEFAULT 0');
  }

  const existingBillColumns = sqliteDb.prepare("PRAGMA table_info(bills)").all().map((c) => c.name);
  if (existingBillColumns.length > 0) {
    if (!existingBillColumns.includes('bill_name')) sqliteDb.exec('ALTER TABLE bills ADD COLUMN bill_name TEXT');
    if (!existingBillColumns.includes('category')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN category TEXT NOT NULL DEFAULT 'other'");
    if (!existingBillColumns.includes('bill_type')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN bill_type TEXT NOT NULL DEFAULT 'one_time'");
    if (!existingBillColumns.includes('amount')) sqliteDb.exec('ALTER TABLE bills ADD COLUMN amount REAL NOT NULL DEFAULT 0');
    if (!existingBillColumns.includes('due_date')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN due_date TEXT NOT NULL DEFAULT '2026-01-01'");
    if (!existingBillColumns.includes('recurrence_unit')) sqliteDb.exec('ALTER TABLE bills ADD COLUMN recurrence_unit TEXT');
    if (!existingBillColumns.includes('recurrence_interval_count')) sqliteDb.exec('ALTER TABLE bills ADD COLUMN recurrence_interval_count INTEGER NOT NULL DEFAULT 1');
    if (!existingBillColumns.includes('recurrence_count')) sqliteDb.exec('ALTER TABLE bills ADD COLUMN recurrence_count INTEGER');
    if (!existingBillColumns.includes('recurrence_end_type')) sqliteDb.exec('ALTER TABLE bills ADD COLUMN recurrence_end_type TEXT');
    if (!existingBillColumns.includes('recurrence_end_date')) sqliteDb.exec('ALTER TABLE bills ADD COLUMN recurrence_end_date TEXT');
    if (!existingBillColumns.includes('notes')) sqliteDb.exec('ALTER TABLE bills ADD COLUMN notes TEXT');
    if (!existingBillColumns.includes('status')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }

  const existingBillPaymentColumns = sqliteDb.prepare("PRAGMA table_info(bill_payments)").all().map((c) => c.name);
  if (existingBillPaymentColumns.length > 0) {
    if (!existingBillPaymentColumns.includes('bill_id')) sqliteDb.exec('ALTER TABLE bill_payments ADD COLUMN bill_id INTEGER');
    if (!existingBillPaymentColumns.includes('payment_date')) sqliteDb.exec("ALTER TABLE bill_payments ADD COLUMN payment_date TEXT NOT NULL DEFAULT '2026-01-01'");
    if (!existingBillPaymentColumns.includes('amount')) sqliteDb.exec('ALTER TABLE bill_payments ADD COLUMN amount REAL NOT NULL DEFAULT 0');
    if (!existingBillPaymentColumns.includes('notes')) sqliteDb.exec('ALTER TABLE bill_payments ADD COLUMN notes TEXT');
  }

  if (sqliteDb.prepare('SELECT COUNT(*) as c FROM subscription_plans').get().c === 0) {
    const insertPlan = sqliteDb.prepare(`
      INSERT INTO subscription_plans (name, customer_type, monthly_price, yearly_price, description)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertPlan.run('Basic', 'personal', 4.99, 49.99, 'Core budgeting, spending, and paycheck tracking.');
    insertPlan.run('Premium', 'personal', 9.99, 99.99, 'Everything in Basic plus tax center, investments, and AI insights.');
    insertPlan.run('Business', 'business', 24.99, 249.99, 'Business income/expense tracking, P&L statements, quarterly estimated taxes, and receipt uploads.');
  }

  function seedTaxYearIfMissing(year) {
    const existing = sqliteDb.prepare('SELECT tax_year FROM tax_years WHERE tax_year = ?').get(year);
    if (existing) return;

    sqliteDb.prepare(`
      INSERT INTO tax_years (tax_year, social_security_rate, social_security_wage_base, medicare_rate,
        additional_medicare_rate, additional_medicare_threshold, mileage_rate, capital_gains_rate,
        self_employment_rate, child_tax_credit, default_state_rate)
      VALUES (?, 0.062, 168600, 0.0145, 0.009, 200000, 0.67, 0.15, 0.153, 2000, 0.05)
    `).run(year);

    const standardDeductions = {
      single: 14600, married_joint: 29200, married_separate: 14600, head_of_household: 21900,
    };
    const insertDeduction = sqliteDb.prepare('INSERT INTO tax_standard_deductions (tax_year, filing_status, amount) VALUES (?, ?, ?)');
    for (const [status, amount] of Object.entries(standardDeductions)) {
      insertDeduction.run(year, status, amount);
    }

    const brackets = {
      single: [
        [11600, 0.10], [47150, 0.12], [100525, 0.22], [191950, 0.24],
        [243725, 0.32], [609350, 0.35], [null, 0.37],
      ],
      married_joint: [
        [23200, 0.10], [94300, 0.12], [201050, 0.22], [383900, 0.24],
        [487450, 0.32], [731200, 0.35], [null, 0.37],
      ],
      married_separate: [
        [11600, 0.10], [47150, 0.12], [100525, 0.22], [191950, 0.24],
        [243725, 0.32], [365600, 0.35], [null, 0.37],
      ],
      head_of_household: [
        [16550, 0.10], [63100, 0.12], [100500, 0.22], [191950, 0.24],
        [243700, 0.32], [609350, 0.35], [null, 0.37],
      ],
    };
    const insertBracket = sqliteDb.prepare('INSERT INTO tax_brackets (tax_year, filing_status, seq, upto_income, rate) VALUES (?, ?, ?, ?, ?)');
    for (const [status, rows] of Object.entries(brackets)) {
      rows.forEach(([upto, rate], seq) => insertBracket.run(year, status, seq, upto, rate));
    }

    const stateTaxes = [
      ['FL', 'State Income Tax', 'state_income', 0], ['TX', 'State Income Tax', 'state_income', 0],
      ['WA', 'State Income Tax', 'state_income', 0], ['NV', 'State Income Tax', 'state_income', 0],
      ['TN', 'State Income Tax', 'state_income', 0], ['SD', 'State Income Tax', 'state_income', 0],
      ['WY', 'State Income Tax', 'state_income', 0], ['AK', 'State Income Tax', 'state_income', 0],
      ['NH', 'State Income Tax', 'state_income', 0],
      ['CA', 'State Income Tax', 'state_income', 0.093], ['NY', 'State Income Tax', 'state_income', 0.0685],
      ['NJ', 'State Income Tax', 'state_income', 0.0637], ['OR', 'State Income Tax', 'state_income', 0.0875],
      ['MN', 'State Income Tax', 'state_income', 0.0785], ['MA', 'State Income Tax', 'state_income', 0.05],
      ['IL', 'State Income Tax', 'state_income', 0.0495], ['PA', 'State Income Tax', 'state_income', 0.0307],
      ['CO', 'State Income Tax', 'state_income', 0.044], ['AZ', 'State Income Tax', 'state_income', 0.025],
      ['GA', 'State Income Tax', 'state_income', 0.0549], ['NC', 'State Income Tax', 'state_income', 0.0425],
      ['VA', 'State Income Tax', 'state_income', 0.0575], ['MI', 'State Income Tax', 'state_income', 0.0425],
      ['OH', 'State Income Tax', 'state_income', 0.035],
      ['CO', 'FAMLI (Paid Family & Medical Leave)', 'additional', 0.009, 176100],
    ];
    const insertState = sqliteDb.prepare('INSERT INTO tax_state_taxes (tax_year, state_code, tax_name, tax_type, rate, wage_base) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [state, name, type, rate, wageBase] of stateTaxes) {
      insertState.run(year, state, name, type, rate, wageBase ?? null);
    }
  }

  const currentYear = new Date().getFullYear();
  seedTaxYearIfMissing(currentYear - 1);
  seedTaxYearIfMissing(currentYear);
  seedTaxYearIfMissing(currentYear + 1);
}

let db;
let initDb;

if (isPostgres) {
  db = createPostgresCompatDatabase();
  initDb = async () => {
    await db.connect();
    await db.exec(`
      ALTER TABLE bills ADD COLUMN IF NOT EXISTS recurrence_interval_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE bills ADD COLUMN IF NOT EXISTS recurrence_end_type TEXT;
      ALTER TABLE bills ADD COLUMN IF NOT EXISTS recurrence_end_date DATE;
      ALTER TABLE investments ADD COLUMN IF NOT EXISTS pending_shares SMALLINT NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS cash_accounts (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_name TEXT NOT NULL,
        account_type TEXT NOT NULL DEFAULT 'checking',
        tier SMALLINT NOT NULL DEFAULT 1,
        institution TEXT,
        is_active SMALLINT NOT NULL DEFAULT 1,
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS cash_allocations (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id BIGINT NOT NULL,
        cash_account_id BIGINT NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
        amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE cash_accounts ADD COLUMN IF NOT EXISTS is_active SMALLINT NOT NULL DEFAULT 1;
      ALTER TABLE cash_accounts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
      ALTER TABLE investment_accounts ADD COLUMN IF NOT EXISTS is_active SMALLINT NOT NULL DEFAULT 1;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS include_semi_liquid_in_available_cash SMALLINT NOT NULL DEFAULT 0;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cash_account_id BIGINT REFERENCES cash_accounts(id) ON DELETE SET NULL;
      CREATE TABLE IF NOT EXISTS account_ledger_entries (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cash_account_id BIGINT NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
        entry_date DATE NOT NULL,
        direction TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        category TEXT,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'posted',
        source_type TEXT,
        source_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS cash_transfers (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_cash_account_id BIGINT NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
        to_cash_account_id BIGINT NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
        amount DOUBLE PRECISION NOT NULL,
        transfer_date DATE NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  };
} else {
  const sqliteDb = new DatabaseSync(dbPath);
  bootstrapSqlite(sqliteDb);
  db = createSqliteCompatDatabase(sqliteDb);
  initDb = async () => {};
}

export async function ensureDefaultCategories(userId) {
  const insert = db.prepare('INSERT OR IGNORE INTO categories (user_id, name, is_default) VALUES (?, ?, 1)');
  const tx = db.transaction(async (uid) => {
    for (const name of DEFAULT_CATEGORIES) {
      await insert.run(uid, name);
    }
  });
  await tx(userId);
}

export { initDb, isPostgres };
export default db;
