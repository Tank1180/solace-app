# Solace — Personal & Business Finance Tracker (Slice 1)

A working prototype of a personal/business finance tracking web app, covering the
first slice of end-user and admin features:

- Sign up / log in (JWT auth) with demographic info; users choose a Personal or Business
  account type (business adds sole proprietor/partnership/S-corp structure and business name)
- Paycheck entry with automatic net pay calculation (gross pay, federal/state tax,
  social security, medicare, benefits, retirement contributions)
- Manual spending entry (cash / check / credit card) with categories
- CSV import of credit card transactions (auto-detects common Date/Description/Amount
  header variants)
- User-defined category rules (e.g. "Starbucks" → "Dining") applied automatically to
  manual entries and CSV imports
- Bulk editing (category/payment method) of selected transactions
- Investment accounts, investments (purchase/sale, cost basis, realized gains), and
  dividend tracking
- Other Income tracking: log non-paycheck income (gifts, winnings, rental income, gig/side-hustle,
  government payments, crypto, foreign income, etc.) with a category taxonomy that auto-flags
  taxable/self-employment status; feeds into Tax Center projections and the dashboard
- Dashboard: income/spending/net worth summary, spending by category (bar) and by
  month (bar), and unusual-transaction alerts
- Profile page: update demographics, spouse info, dependents, personal/business account
  type, export all data (JSON/CSV), delete account
- Tax Center: state-of-residence-aware federal/state/payroll tax projection, tax-deductible
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
notifications. The data model and API are structured so these can be layered on
incrementally.

## Stack

- **Backend**: Node.js + Express + `node:sqlite` (Node's built-in SQLite module —
  chosen because native `better-sqlite3` requires build tools not available in this
  environment). JWT auth, bcrypt password hashing, multer for CSV upload, `csv-parse`
  for parsing.
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

### Frontend

```powershell
cd finance-app\client
npm install
npm run dev
```

Runs on `http://localhost:5173` and talks to the API at the URL configured in
`client/.env` (`VITE_API_URL`, defaults to `http://localhost:4000/api`).

## Project layout

```
finance-app/
  server/
    src/
      db/index.js         # schema + node:sqlite setup + seeded tax-year defaults
      auth.js              # JWT sign/verify middleware
      lib/taxEngine.js      # DB-driven federal/state/payroll tax projection engine
      routes/               # auth, paychecks, categories, transactions, investments,
                            #  dashboard, admin, dependents, tax, adminTax
      seedAdmin.js          # CLI helper to create/promote an admin user
  client/
    src/
      api/client.js         # axios instance with auth header injection
      context/AuthContext.jsx
      components/           # Layout, ProtectedRoute
      pages/                # Login, Signup, Dashboard, Paychecks, Transactions,
                            #  Investments, Tax, Profile, Admin, AdminTax
```
