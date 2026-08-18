import { Router } from 'express';
import db from '../db/index.js';
import { authRequired, adminRequired } from '../auth.js';
import { sanitizeUser } from './auth.js';

const router = Router();
router.use(authRequired, adminRequired);

router.get('/users', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json({ users: rows.map(sanitizeUser) });
});

router.get('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const paycheckCount = db.prepare('SELECT COUNT(*) as c FROM paychecks WHERE user_id = ?').get(req.params.id).c;
  const transactionCount = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE user_id = ?').get(req.params.id).c;
  const investmentCount = db.prepare('SELECT COUNT(*) as c FROM investments WHERE user_id = ?').get(req.params.id).c;

  res.json({ user: sanitizeUser(user), activity: { paycheckCount, transactionCount, investmentCount } });
});

router.put('/users/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'status must be active or suspended' });
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  res.json({ user: sanitizeUser(user) });
});

router.delete('/users/:id', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/stats', (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'user'").get().c;
  const activeUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'user' AND status = 'active'").get().c;
  const suspendedUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'user' AND status = 'suspended'").get().c;
  const byAccountType = db.prepare("SELECT account_type, COUNT(*) as c FROM users WHERE role = 'user' GROUP BY account_type").all();
  const byCustomerType = db.prepare("SELECT customer_type, COUNT(*) as c FROM users WHERE role = 'user' GROUP BY customer_type").all();
  const totalTransactions = db.prepare('SELECT COUNT(*) as c FROM transactions').get().c;
  const totalTransactionVolume = db.prepare('SELECT COALESCE(SUM(amount),0) as v FROM transactions').get().v;

  res.json({ totalUsers, activeUsers, suspendedUsers, byAccountType, byCustomerType, totalTransactions, totalTransactionVolume });
});

export default router;
