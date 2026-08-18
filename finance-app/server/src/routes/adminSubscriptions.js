import { Router } from 'express';
import db from '../db/index.js';
import { authRequired, adminRequired } from '../auth.js';

const router = Router();
router.use(authRequired, adminRequired);

router.get('/plans', (req, res) => {
  const plans = db.prepare('SELECT * FROM subscription_plans ORDER BY customer_type, monthly_price').all();
  res.json({ plans });
});

router.post('/plans', (req, res) => {
  const { name, customerType, monthlyPrice, yearlyPrice, description } = req.body || {};
  if (!name || !['personal', 'business'].includes(customerType)) {
    return res.status(400).json({ error: 'name and a valid customerType (personal|business) are required' });
  }
  const info = db.prepare(`
    INSERT INTO subscription_plans (name, customer_type, monthly_price, yearly_price, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, customerType, Number(monthlyPrice || 0), Number(yearlyPrice || 0), description || null);
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ plan });
});

router.put('/plans/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Plan not found' });
  const { name, customerType, monthlyPrice, yearlyPrice, description, isActive } = req.body || {};
  const finalCustomerType = ['personal', 'business'].includes(customerType) ? customerType : existing.customer_type;
  db.prepare(`
    UPDATE subscription_plans SET name = ?, customer_type = ?, monthly_price = ?, yearly_price = ?,
      description = ?, is_active = ?
    WHERE id = ?
  `).run(
    name ?? existing.name, finalCustomerType,
    monthlyPrice != null ? Number(monthlyPrice) : existing.monthly_price,
    yearlyPrice != null ? Number(yearlyPrice) : existing.yearly_price,
    description ?? existing.description,
    isActive != null ? (isActive ? 1 : 0) : existing.is_active,
    req.params.id
  );
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(req.params.id);
  res.json({ plan });
});

router.delete('/plans/:id', (req, res) => {
  db.prepare('DELETE FROM subscription_plans WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Overview of subscriptions by customer type / plan, for the admin dashboard.
router.get('/overview', (req, res) => {
  const byPlan = db.prepare(`
    SELECT p.id as plan_id, p.name, p.customer_type, p.monthly_price, COUNT(u.id) as subscriber_count
    FROM subscription_plans p
    LEFT JOIN users u ON u.plan_id = p.id
    GROUP BY p.id ORDER BY p.customer_type, p.monthly_price
  `).all();
  const unassigned = db.prepare("SELECT customer_type, COUNT(*) as c FROM users WHERE role = 'user' AND plan_id IS NULL GROUP BY customer_type").all();
  res.json({ byPlan, unassigned });
});

export default router;
