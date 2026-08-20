import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name').all(req.user.id);
  res.json({ categories: rows });
});

router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const info = await db.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)').run(req.user.id, name.trim());
    const row = await db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ category: row });
  } catch (e) {
    res.status(409).json({ error: 'Category already exists' });
  }
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Category rules (e.g. "Starbucks" -> Coffee)
router.get('/rules', async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.*, c.name as category_name FROM category_rules r
    JOIN categories c ON c.id = r.category_id
    WHERE r.user_id = ? ORDER BY r.match_text
  `).all(req.user.id);
  res.json({ rules: rows });
});

router.post('/rules', async (req, res) => {
  const { matchText, categoryId } = req.body || {};
  if (!matchText || !categoryId) return res.status(400).json({ error: 'matchText and categoryId are required' });
  const info = await db.prepare('INSERT INTO category_rules (user_id, match_text, category_id) VALUES (?, ?, ?)')
    .run(req.user.id, matchText.trim(), categoryId);
  const row = await db.prepare('SELECT * FROM category_rules WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ rule: row });
});

router.delete('/rules/:id', async (req, res) => {
  await db.prepare('DELETE FROM category_rules WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

export default router;
