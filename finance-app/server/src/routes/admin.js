import { Router } from 'express';
import db from '../db/index.js';
import { authRequired, adminRequired } from '../auth.js';
import { sanitizeUser } from './auth.js';

const router = Router();
router.use(authRequired, adminRequired);

router.get('/users', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json({ users: rows.map(sanitizeUser) });
});

router.get('/users/:id', async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const paycheckCount = (await db.prepare('SELECT COUNT(*) as c FROM paychecks WHERE user_id = ?').get(req.params.id)).c;
  const transactionCount = (await db.prepare('SELECT COUNT(*) as c FROM transactions WHERE user_id = ?').get(req.params.id)).c;
  const investmentCount = (await db.prepare('SELECT COUNT(*) as c FROM investments WHERE user_id = ?').get(req.params.id)).c;

  res.json({ user: sanitizeUser(user), activity: { paycheckCount, transactionCount, investmentCount } });
});

router.put('/users/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'status must be active or suspended' });
  await db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  res.json({ user: sanitizeUser(user) });
});

router.delete('/users/:id', async (req, res) => {
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/stats', async (req, res) => {
  const totalUsers = (await db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'user'").get()).c;
  const activeUsers = (await db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'user' AND status = 'active'").get()).c;
  const suspendedUsers = (await db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'user' AND status = 'suspended'").get()).c;
  const byAccountType = await db.prepare("SELECT account_type, COUNT(*) as c FROM users WHERE role = 'user' GROUP BY account_type").all();
  const byCustomerType = await db.prepare("SELECT customer_type, COUNT(*) as c FROM users WHERE role = 'user' GROUP BY customer_type").all();
  const totalTransactions = (await db.prepare('SELECT COUNT(*) as c FROM transactions').get()).c;
  const totalTransactionVolume = (await db.prepare('SELECT COALESCE(SUM(amount),0) as v FROM transactions').get()).v;

  res.json({ totalUsers, activeUsers, suspendedUsers, byAccountType, byCustomerType, totalTransactions, totalTransactionVolume });
});

export default router;
