import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

// List plans available for the current user's customer type (personal or business).
router.get('/plans', (req, res) => {
  const user = db.prepare('SELECT customer_type FROM users WHERE id = ?').get(req.user.id);
  const plans = db.prepare(
    'SELECT * FROM subscription_plans WHERE customer_type = ? AND is_active = 1 ORDER BY monthly_price ASC'
  ).all(user.customer_type);
  res.json({ customerType: user.customer_type, plans });
});

router.get('/current', (req, res) => {
  const user = db.prepare('SELECT plan_id FROM users WHERE id = ?').get(req.user.id);
  if (!user?.plan_id) return res.json({ plan: null });
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(user.plan_id);
  res.json({ plan: plan || null });
});

router.post('/select', (req, res) => {
  const { planId } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ? AND is_active = 1').get(planId);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  if (plan.customer_type !== user.customer_type) {
    return res.status(400).json({ error: `This plan is only available to ${plan.customer_type} customers` });
  }
  db.prepare('UPDATE users SET plan_id = ? WHERE id = ?').run(plan.id, req.user.id);
  res.json({ plan });
});

export default router;
