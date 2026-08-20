# Solace — Personal & Business Finance Tracker (Slice 1)

A working prototype of a personal/business finance tracking web app, covering the
first slice of end-user and admin features:

- Sign up / log in (JWT auth) with demographic info; users choose a Personal or Business
  account type (business adds sole proprietor/partnership/S-corp structure and business name)
- Paycheck entry with automatic net pay calculation (gross pay, federal/state tax,
  social security, medicare, benefits, retirement contributions); saving no longer forces
  a redirect — a non-blocking reminder/badge tracks any retirement contribution still
  awaiting allocation
- Manual spending entry (cash / check / credit card), with an optional link to a specific
  Cash Account for cash/check spending, and categories
- CSV import of credit card transactions (auto-detects common Date/Description/Amount
  header variants)
- User-defined category rules (e.g. "Starbucks" → "Dining") applied automatically to
  manual entries and CSV imports
- Bulk editing (category/payment method) of selected transactions
- Bills: one-time or recurring bills (weekly/biweekly/monthly/quarterly/yearly), with
  recurrence ending by number of billing cycles, a specific date, or until stopped;
  upcoming-obligation windows (7/14/30/60 days) and a simple all-bills list with
  edit/delete
- Investment accounts, investments (purchase/sale, cost basis, realized gains, live
  market pricing), and dividend tracking. Retirement contributions from a paycheck can
  be allocated to a destination investment; new destinations are held as a "pending
  shares" placeholder (excluded from portfolio totals) until the user confirms the
  number of shares and price paid, at which point they join the regular holdings
- Cash Accounts & Liquidity: a 5-tier liquidity model (Tier 1 fully liquid — checking,
  savings, HYSA, cash management, etc.; Tier 2 semi-liquid — online savings, T-Bills,
  MMFs, etc.; Tier 3 restricted — HSA, FSA, 529, CDs, etc.; Tier 4 market-dependent —
  brokerage/crypto, reusing Investments accounts; Tier 5 long-term retirement — 401k/IRA/
  pension, also reusing Investments accounts). Paycheck and Other Income entries can be
  split across one or more cash accounts. A unified per-account transaction ledger
  (inflows, outflows, and paired transfer entries) drives a true chronological running
  balance and a projected balance that includes pending (future-dated) items. The
  Liquidity Overview reports `AvailableCashToday` (Tier 1, plus Tier 2 if the user opts
  in), `RestrictedCash` (Tier 3), `InvestedAssets` (Tier 4), `RetirementAssets` (Tier 5),
  `TotalCash`, overdraft alerts (negative account balance), and configuration warnings
  for any account type that doesn't map to a known tier (defaults to Tier 3 and logs a
  warning). Account-to-account transfers are supported and net to zero on total cash.
- Other Income tracking: log non-paycheck income (gifts, winnings, rental income, gig/side-hustle,
  government payments, crypto, foreign income, etc.) with a category taxonomy that auto-flags
  taxable/self-employment status; feeds into Tax Center projections and the dashboard
- Dashboard: income/spending summary over a rolling past-12-months reference range
  (gross pay, net pay, other income, spending), a running current-cash-balance card
  (net pay + other income, minus cash/check spending, all-time), bills due in the next
  30 days, an investments snapshot (cost basis, live portfolio market value, unrealized
  gain, and realized gains for the current calendar year), spending-by-category and
  spending-by-month charts (styled to the site's brand palette), and unusual-transaction
  alerts
- Profile page: update demographics, spouse info (clearly marked optional), dependents,
  personal/business account type, export all data (JSON/CSV), delete account
- Tax Center: state-of-residence-aware federal/state/payroll tax projection presented as
  an income-statement-style "Tax Projection Statement" (grouped income with subtotal,
  grouped deductions with subtotal, calculated taxable income, taxes paid so far with a
  subtotal, estimated taxes with per-item percentages including a capital-gains
  placeholder, and a conditionally color-coded projected refund/amount owed), tax-deductible
  expense tracking (charity, business expense, mileage, home office), what-if scenario
  simulation, and a tax-ready income/deduction/gains summary
- Subscription plans: personal (Basic/Premium) and business-only plan tiers; users view
  and select the plan available to their account type
- Business Center (business accounts only): profit & loss statement (business revenue vs.
  expenses) and quarterly estimated tax payment tracking
- Admin dashboard: view all users (with personal/business breakdown) + stats, suspend/reactivate
  accounts (suspended users cannot log in)
- Admin Tax Configuration: manage tax years, standard deductions per filing status,
  federal bracket ladders, Social Security/Medicare rates and wage bases, capital gains
  and self-employment rates, mileage rate, and per-state additional/local taxes (e.g.
  Colorado FAMLI, local payroll taxes)
- Admin Subscription management: create/edit/deactivate personal and business plans,
  adjust pricing, and see subscriber counts per plan

Not included in this slice (future work): Plaid/bank integration, receipt scanning/OCR,
AI assistant/insights, MFA, real payment processing/billing cycles, sharing with spouse/accountant, push
notifications. The Cash Accounts liquidity system also does not yet feed the Dashboard's
"current cash" card (that still uses a simpler all-time net-pay-based formula) — unifying
the two is tracked as follow-up work. The data model and API are structured so these can
be layered on incrementally.

## Stack

- **Backend**: Node.js + Express. Uses `node:sqlite` (Node's built-in SQLite module —
  chosen because native `better-sqlite3` requires build tools not available in this
  environment) for local development, or PostgreSQL (via `pg`) in production/Azure when
  `DATABASE_URL` is set — see "Azure Database for PostgreSQL migration" below. JWT auth,
  bcrypt password hashing, multer for CSV upload, `csv-parse` for parsing, `yahoo-finance2`
  for live investment quotes.
- **Frontend**: React + Vite, React Router, Recharts for charts, Axios for API calls.

## Running locally

### Backend

```powershell
cd finance-app\server
npm install
node src/index.js
```

Runs on `http://localhost:4000`. Database file `finance.db` is created automatically
in `finance-app/server/`.

To create an admin user:

```powershell
node src/seedAdmin.js admin@example.com yourpassword
```

### Azure Database for PostgreSQL migration

The repository now includes PostgreSQL migration assets for an Azure deployment:

- `server/migrations/postgres/001_create_schema.sql` creates the Solace schema in Azure Database for PostgreSQL.
- `server/migrations/postgres/002_seed_defaults.sql` seeds default subscription plans plus tax configuration for the prior, current, and next tax year.
- `server/scripts/exportSqliteToPostgres.js` reads the local SQLite database and generates a PostgreSQL data import script.

The backend now supports two runtime modes:

- no `DATABASE_URL`: uses the local SQLite database at `finance-app/server/finance.db`
- `DATABASE_URL=postgresql://...`: uses PostgreSQL (including Azure Database for PostgreSQL)

Typical migration flow:

```powershell
cd finance-app\server

# 1) Create the Azure PostgreSQL schema
psql "$env:DATABASE_URL" -f .\migrations\postgres\001_create_schema.sql

# 2a) Fresh Azure sandbox with no local data
psql "$env:DATABASE_URL" -f .\migrations\postgres\002_seed_defaults.sql

# 2b) Existing local SQLite data to migrate
npm run db:export:postgres
psql "$env:DATABASE_URL" -f .\migrations\postgres\003_sqlite_data_export.sql
```

Notes:

- Run either the default seed script or the generated SQLite export for reference data, not both, unless you intentionally want local data to overwrite seeded defaults.
- The generated `003_sqlite_data_export.sql` file can contain user financial data, so review where you store it and avoid committing it to source control.
- When running against Azure PostgreSQL, set `DATABASE_URL` and keep SSL enabled (Azure connection strings typically use `sslmode=require`).

### Frontend

```powershell
cd finance-app\client
npm install
npm run dev
```

Runs on `http://localhost:5173` and talks to the API at the URL configured in
`client/.env` (`VITE_API_URL`, defaults to `/api`). The Vite dev server proxies `/api`
to `http://localhost:4000`.

## Azure App Service deployment

The repository root now contains a [package.json](C:/fantasy-frontend/finance-app/package.json)
so Azure can build and run Solace as a single web app:

- `npm install` at the repo root installs both `server/` and `client/`
- `npm run build` builds the React app into `client/dist`
- `npm start` starts Express from `server/`, which serves both `/api/*` and the built client

Recommended Azure App Service settings:

- Startup command: `npm start`
- App setting `NODE_ENV=production`
- App setting `PORT=8080`
- App setting `APP_URL=https://<your-app-name>.azurewebsites.net`
- App setting `DATABASE_URL=postgresql://<user>:<password>@<server>.postgres.database.azure.com:5432/<database>?sslmode=require`
- App setting `JWT_SECRET=<strong-secret>`

Typical deployment steps for App Service:

```powershell
cd C:\fantasy-frontend\finance-app
git add .
git commit -m "Prepare Azure App Service deployment"
git push
```

Then in Azure Portal for your web app:

1. Open **Deployment Center**
2. Choose **GitHub**
3. Select repo `Tank1180/solace-app`
4. Set the app path to the repository root that contains `finance-app/`, or point Azure directly at `finance-app/`
5. Save and let Azure build with the root `package.json`

Before first startup, create the PostgreSQL schema:

```powershell
psql "$env:DATABASE_URL" -f .\server\migrations\postgres\001_create_schema.sql
psql "$env:DATABASE_URL" -f .\server\migrations\postgres\002_seed_defaults.sql
```

### Faster developer deploys from Windows

Once Azure CLI is installed and you're logged in, you can deploy the current app with one command from
[finance-app/](C:/fantasy-frontend/finance-app):

```powershell
npm run deploy:azure
```

The helper script at [deploy-azure.ps1](C:/fantasy-frontend/finance-app/scripts/deploy-azure.ps1):

- builds the client
- creates a Linux-friendly zip package
- excludes local SQLite and `node_modules`
- deploys to App Service
- restarts the app
- checks `/api/health`

Optional examples:

```powershell
npm run deploy:azure -- -ResourceGroup solace-sandbox-rg -WebAppName Solice-test
npm run deploy:azure -- -Subscription "Azure subscription 1"
npm run deploy:azure -- -SkipBuild
npm run deploy:azure -- -SkipHealthCheck
```

## Project layout

```
finance-app/
  server/
    src/
      db/index.js         # schema + node:sqlite/PostgreSQL setup + seeded tax-year defaults
      auth.js              # JWT sign/verify middleware
      lib/
        taxEngine.js        # DB-driven federal/state/payroll tax projection engine
        cashAccountTypes.js # Tier 1-3 cash account taxonomy + tier classification
        investmentAccountTiers.js # Tier 4-5 investment/retirement account taxonomy
        accountLedger.js    # unified ledger: posted/pending entries, running + projected balances
      routes/               # auth, paychecks, categories, transactions, investments,
                            #  dashboard, admin, dependents, tax, adminTax, otherIncome,
                            #  bills, subscriptions, adminSubscriptions, business,
                            #  cashAccounts (accounts, allocations, transfers, liquidity summary)
      seedAdmin.js          # CLI helper to create/promote an admin user
  client/
    src/
      api/client.js         # axios instance with auth header injection
      context/AuthContext.jsx
      components/           # Layout (nav + reminder badges), ProtectedRoute
      pages/                # Login, Signup, Dashboard, Paychecks, Transactions, Bills,
                            #  Investments, CashAccounts, Tax, OtherIncome, Profile,
                            #  Subscription, Business, Admin, AdminTax, AdminSubscriptions
```
