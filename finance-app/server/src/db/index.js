import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', '..', 'finance.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// node:sqlite's DatabaseSync has no built-in transaction() helper (unlike better-sqlite3),
// so provide a small wrapper with the same call signature used throughout the routes.
db.transaction = function transaction(fn) {
  return function wrapped(...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

db.exec(`
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
  account_type TEXT NOT NULL DEFAULT 'individual', -- individual | sole_proprietor | partnership | s_corp
  customer_type TEXT NOT NULL DEFAULT 'personal', -- personal | business
  business_name TEXT,
  spouse_first_name TEXT,
  spouse_last_name TEXT,
  spouse_date_of_birth TEXT,
  role TEXT NOT NULL DEFAULT 'user', -- user | admin
  status TEXT NOT NULL DEFAULT 'active', -- active | suspended
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS paychecks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL DEFAULT 'self', -- self | spouse
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
  payment_method TEXT NOT NULL DEFAULT 'cash', -- cash | check | credit_card | import
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | csv_import
  import_batch_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bill_name TEXT NOT NULL,
  category TEXT NOT NULL, -- housing | utilities | insurance | loans | subscriptions | other
  bill_type TEXT NOT NULL DEFAULT 'one_time', -- one_time | recurring
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL,
  recurrence_unit TEXT, -- weekly | biweekly | monthly | quarterly | yearly
  recurrence_count INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | paid | paused
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
  account_type TEXT NOT NULL DEFAULT 'brokerage', -- brokerage | 401k | ira | roth_ira | other
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dividends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investment_account_id INTEGER NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  amount REAL NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'cash', -- cash | reinvested
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dividend_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dividend_id INTEGER NOT NULL REFERENCES dividends(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- investment | cash_out
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

CREATE TABLE IF NOT EXISTS dependents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT,
  date_of_birth TEXT,
  relationship TEXT NOT NULL DEFAULT 'child', -- child | other
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ded_date TEXT NOT NULL,
  category TEXT NOT NULL, -- charity | business_expense | mileage | home_office
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  miles REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS other_income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  income_date TEXT NOT NULL,
  income_group TEXT NOT NULL, -- e.g. personal | business | government | education | financial | misc | crypto | foreign
  category TEXT NOT NULL, -- specific type, e.g. gambling_winnings, rental_income, gig_economy
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  is_taxable INTEGER NOT NULL DEFAULT 1,
  is_self_employment INTEGER NOT NULL DEFAULT 0, -- counts toward self-employment/business income for SE tax
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin-managed subscription plans, scoped to either personal or business customers.
CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  customer_type TEXT NOT NULL DEFAULT 'personal', -- personal | business
  monthly_price REAL NOT NULL DEFAULT 0,
  yearly_price REAL NOT NULL DEFAULT 0,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Quarterly estimated tax payments actually made by a business/self-employed user.
CREATE TABLE IF NOT EXISTS quarterly_tax_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL, -- 1-4
  paid_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin-configurable tax settings, one row per tax year.
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
  filing_status TEXT NOT NULL, -- single | married_joint | married_separate | head_of_household
  amount REAL NOT NULL DEFAULT 0,
  UNIQUE(tax_year, filing_status)
);

CREATE TABLE IF NOT EXISTS tax_brackets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tax_year INTEGER NOT NULL REFERENCES tax_years(tax_year) ON DELETE CASCADE,
  filing_status TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  upto_income REAL, -- NULL means unbounded (top bracket)
  rate REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_state_taxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tax_year INTEGER NOT NULL REFERENCES tax_years(tax_year) ON DELETE CASCADE,
  state_code TEXT NOT NULL,
  tax_name TEXT NOT NULL, -- e.g. "State Income Tax", "FAMLI", "SF Payroll Tax"
  tax_type TEXT NOT NULL DEFAULT 'state_income', -- state_income | additional | local
  rate REAL NOT NULL DEFAULT 0,
  wage_base REAL, -- optional cap on taxable wages for this tax
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

// Lightweight migration: add spouse/tax columns to users table if this DB predates them.
const existingUserColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
for (const col of ['spouse_first_name', 'spouse_last_name', 'spouse_date_of_birth']) {
  if (!existingUserColumns.includes(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
  }
}
if (!existingUserColumns.includes('filing_status')) {
  db.exec("ALTER TABLE users ADD COLUMN filing_status TEXT NOT NULL DEFAULT 'single'");
}
if (!existingUserColumns.includes('customer_type')) {
  db.exec("ALTER TABLE users ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'personal'");
  // Backfill: anyone with a business-style account_type is treated as a business customer.
  db.exec("UPDATE users SET customer_type = 'business' WHERE account_type IN ('sole_proprietor', 'partnership', 's_corp')");
}
if (!existingUserColumns.includes('plan_id')) {
  db.exec('ALTER TABLE users ADD COLUMN plan_id INTEGER REFERENCES subscription_plans(id)');
}

const existingDividendColumns = db.prepare("PRAGMA table_info(dividends)").all().map((c) => c.name);
if (!existingDividendColumns.includes('disposition')) {
  db.exec("ALTER TABLE dividends ADD COLUMN disposition TEXT NOT NULL DEFAULT 'cash'");
}

const existingPaycheckColumns = db.prepare("PRAGMA table_info(paychecks)").all().map((c) => c.name);
if (!existingPaycheckColumns.includes('owner_type')) {
  db.exec("ALTER TABLE paychecks ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'self'");
}

const existingInvestmentAccountColumns = db.prepare("PRAGMA table_info(investment_accounts)").all().map((c) => c.name);
if (!existingInvestmentAccountColumns.includes('current_balance')) {
  db.exec('ALTER TABLE investment_accounts ADD COLUMN current_balance REAL NOT NULL DEFAULT 0');
}

const existingBillColumns = db.prepare("PRAGMA table_info(bills)").all().map((c) => c.name);
if (existingBillColumns.length > 0) {
  if (!existingBillColumns.includes('bill_name')) db.exec('ALTER TABLE bills ADD COLUMN bill_name TEXT');
  if (!existingBillColumns.includes('category')) db.exec("ALTER TABLE bills ADD COLUMN category TEXT NOT NULL DEFAULT 'other'");
  if (!existingBillColumns.includes('bill_type')) db.exec("ALTER TABLE bills ADD COLUMN bill_type TEXT NOT NULL DEFAULT 'one_time'");
  if (!existingBillColumns.includes('amount')) db.exec('ALTER TABLE bills ADD COLUMN amount REAL NOT NULL DEFAULT 0');
  if (!existingBillColumns.includes('due_date')) db.exec("ALTER TABLE bills ADD COLUMN due_date TEXT NOT NULL DEFAULT '2026-01-01'");
  if (!existingBillColumns.includes('recurrence_unit')) db.exec('ALTER TABLE bills ADD COLUMN recurrence_unit TEXT');
  if (!existingBillColumns.includes('recurrence_count')) db.exec('ALTER TABLE bills ADD COLUMN recurrence_count INTEGER');
  if (!existingBillColumns.includes('notes')) db.exec('ALTER TABLE bills ADD COLUMN notes TEXT');
  if (!existingBillColumns.includes('status')) db.exec("ALTER TABLE bills ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
}

const existingBillPaymentColumns = db.prepare("PRAGMA table_info(bill_payments)").all().map((c) => c.name);
if (existingBillPaymentColumns.length > 0) {
  if (!existingBillPaymentColumns.includes('bill_id')) db.exec('ALTER TABLE bill_payments ADD COLUMN bill_id INTEGER');
  if (!existingBillPaymentColumns.includes('payment_date')) db.exec("ALTER TABLE bill_payments ADD COLUMN payment_date TEXT NOT NULL DEFAULT '2026-01-01'");
  if (!existingBillPaymentColumns.includes('amount')) db.exec('ALTER TABLE bill_payments ADD COLUMN amount REAL NOT NULL DEFAULT 0');
  if (!existingBillPaymentColumns.includes('notes')) db.exec('ALTER TABLE bill_payments ADD COLUMN notes TEXT');
}

// Seed default subscription plans (one Personal set, one Business set) if none exist.
if (db.prepare('SELECT COUNT(*) as c FROM subscription_plans').get().c === 0) {
  const insertPlan = db.prepare(`
    INSERT INTO subscription_plans (name, customer_type, monthly_price, yearly_price, description)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertPlan.run('Basic', 'personal', 4.99, 49.99, 'Core budgeting, spending, and paycheck tracking.');
  insertPlan.run('Premium', 'personal', 9.99, 99.99, 'Everything in Basic plus tax center, investments, and AI insights.');
  insertPlan.run('Business', 'business', 24.99, 249.99, 'Business income/expense tracking, P&L statements, quarterly estimated taxes, and receipt uploads.');
}

// Seed default tax-year configuration (illustrative 2025/2026 federal brackets) if empty.
function seedTaxYearIfMissing(year) {
  const existing = db.prepare('SELECT tax_year FROM tax_years WHERE tax_year = ?').get(year);
  if (existing) return;

  db.prepare(`
    INSERT INTO tax_years (tax_year, social_security_rate, social_security_wage_base, medicare_rate,
      additional_medicare_rate, additional_medicare_threshold, mileage_rate, capital_gains_rate,
      self_employment_rate, child_tax_credit, default_state_rate)
    VALUES (?, 0.062, 168600, 0.0145, 0.009, 200000, 0.67, 0.15, 0.153, 2000, 0.05)
  `).run(year);

  const standardDeductions = {
    single: 14600, married_joint: 29200, married_separate: 14600, head_of_household: 21900,
  };
  const insertDeduction = db.prepare('INSERT INTO tax_standard_deductions (tax_year, filing_status, amount) VALUES (?, ?, ?)');
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
  const insertBracket = db.prepare('INSERT INTO tax_brackets (tax_year, filing_status, seq, upto_income, rate) VALUES (?, ?, ?, ?, ?)');
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
  const insertState = db.prepare('INSERT INTO tax_state_taxes (tax_year, state_code, tax_name, tax_type, rate, wage_base) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [state, name, type, rate, wageBase] of stateTaxes) {
    insertState.run(year, state, name, type, rate, wageBase ?? null);
  }
}

const currentYear = new Date().getFullYear();
seedTaxYearIfMissing(currentYear - 1);
seedTaxYearIfMissing(currentYear);
seedTaxYearIfMissing(currentYear + 1);

const DEFAULT_CATEGORIES = [
  'Groceries', 'Dining', 'Rent/Mortgage', 'Utilities', 'Transportation',
  'Insurance', 'Healthcare', 'Entertainment', 'Shopping', 'Travel',
  'Subscriptions', 'Education', 'Personal Care', 'Business Expense', 'Other',
];

export function ensureDefaultCategories(userId) {
  const insert = db.prepare('INSERT OR IGNORE INTO categories (user_id, name, is_default) VALUES (?, ?, 1)');
  const tx = db.transaction((uid) => {
    for (const name of DEFAULT_CATEGORIES) insert.run(uid, name);
  });
  tx(userId);
}

export default db;
