import 'dotenv/config';
import express from 'express';
import cors from 'cors';

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

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Finance app server listening on http://localhost:${PORT}`);
});
