import 'express-async-errors';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.js';
import paycheckRoutes from './routes/paychecks.js';
import categoryRoutes from './routes/categories.js';
import transactionRoutes from './routes/transactions.js';
import investmentRoutes from './routes/investments.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';
import dependentRoutes from './routes/dependents.js';
import taxRoutes from './routes/tax.js';
import adminTaxRoutes from './routes/adminTax.js';
import otherIncomeRoutes from './routes/otherIncome.js';
import billRoutes from './routes/bills.js';
import subscriptionRoutes from './routes/subscriptions.js';
import adminSubscriptionRoutes from './routes/adminSubscriptions.js';
import businessRoutes from './routes/business.js';
import cashAccountRoutes from './routes/cashAccounts.js';
import { initDb } from './db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');
const hasClientBuild = fs.existsSync(path.join(clientDistPath, 'index.html'));
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/paychecks', paycheckRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/dependents', dependentRoutes);
app.use('/api/tax', taxRoutes);
app.use('/api/admin/tax', adminTaxRoutes);
app.use('/api/other-income', otherIncomeRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin/subscriptions', adminSubscriptionRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/cash-accounts', cashAccountRoutes);

if (hasClientBuild) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.status(404).send(hasClientBuild ? 'Client route not found' : 'Client build not found');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

await initDb();

app.listen(PORT, () => {
  console.log(`Finance app server listening on http://localhost:${PORT}`);
});
