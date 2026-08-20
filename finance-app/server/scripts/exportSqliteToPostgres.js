import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, '..', 'finance.db');
const defaultOutputPath = path.join(__dirname, '..', 'migrations', 'postgres', '003_sqlite_data_export.sql');

const args = process.argv.slice(2);
const outputArgIndex = args.findIndex((arg) => arg === '--output');
const outputPath = outputArgIndex >= 0 && args[outputArgIndex + 1]
  ? path.resolve(process.cwd(), args[outputArgIndex + 1])
  : defaultOutputPath;

if (args.includes('--help')) {
  console.log([
    'Usage: node scripts/exportSqliteToPostgres.js [--output <file>]',
    '',
    'Reads server/finance.db and creates a PostgreSQL-compatible data import script.',
    'Run 001_create_schema.sql first, then apply the generated SQL file to Azure Database for PostgreSQL.',
  ].join('\n'));
  process.exit(0);
}

if (!fs.existsSync(defaultDbPath)) {
  throw new Error(`SQLite database not found at ${defaultDbPath}`);
}

const db = new DatabaseSync(defaultDbPath);

const tableOrder = [
  'subscription_plans',
  'tax_years',
  'tax_standard_deductions',
  'tax_brackets',
  'tax_state_taxes',
  'users',
  'categories',
  'import_batches',
  'investment_accounts',
  'paychecks',
  'transactions',
  'bills',
  'bill_payments',
  'investments',
  'dividends',
  'dependents',
  'tax_deductions',
  'other_income',
  'category_rules',
  'quarterly_tax_payments',
  'password_reset_tokens',
  'dividend_allocations',
  'retirement_contribution_allocations',
];

function escapeIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot export non-finite number: ${value}`);
    }
    return String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'string') {
    return `'${value.replaceAll("'", "''")}'`;
  }

  throw new Error(`Unsupported value type: ${typeof value}`);
}

function getColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function getRows(tableName) {
  return db.prepare(`SELECT * FROM ${tableName}`).all();
}

const lines = [
  '-- Generated from SQLite for Azure Database for PostgreSQL.',
  `-- Source: ${defaultDbPath.replaceAll('\\', '/')}`,
  `-- Generated at: ${new Date().toISOString()}`,
  '',
  'BEGIN;',
  '',
];

for (const tableName of tableOrder) {
  const columns = getColumns(tableName);
  if (columns.length === 0) {
    continue;
  }

  const rows = getRows(tableName);
  if (rows.length === 0) {
    lines.push(`-- ${tableName}: no rows`);
    lines.push('');
    continue;
  }

  const columnList = columns.map(escapeIdentifier).join(', ');
  lines.push(`-- ${tableName}: ${rows.length} row(s)`);

  for (const row of rows) {
    const values = columns.map((column) => formatValue(row[column])).join(', ');
    lines.push(`INSERT INTO ${escapeIdentifier(tableName)} (${columnList}) VALUES (${values});`);
  }

  if (columns.includes('id')) {
    lines.push(
      `SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), ` +
      `COALESCE((SELECT MAX(id) FROM ${escapeIdentifier(tableName)}), 1), ` +
      `(SELECT COUNT(*) > 0 FROM ${escapeIdentifier(tableName)}));`,
    );
  }

  lines.push('');
}

lines.push('COMMIT;');
lines.push('');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join('\n'));

console.log(`PostgreSQL data export written to ${outputPath}`);
