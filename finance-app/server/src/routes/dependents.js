import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM dependents WHERE user_id = ? ORDER BY date_of_birth').all(req.user.id);
  res.json({ dependents: rows });
});

router.post('/', (req, res) => {
  const { firstName, lastName, dateOfBirth, relationship } = req.body || {};
  if (!firstName || !firstName.trim()) return res.status(400).json({ error: 'firstName is required' });

  const info = db.prepare(`
    INSERT INTO dependents (user_id, first_name, last_name, date_of_birth, relationship)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, firstName.trim(), lastName || null, dateOfBirth || null, relationship || 'child');

  const row = db.prepare('SELECT * FROM dependents WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ dependent: row });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM dependents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Dependent not found' });

  const { firstName, lastName, dateOfBirth, relationship } = req.body || {};
  db.prepare(`
    UPDATE dependents SET first_name = ?, last_name = ?, date_of_birth = ?, relationship = ?
    WHERE id = ? AND user_id = ?
  `).run(
    firstName ?? existing.first_name, lastName ?? existing.last_name,
    dateOfBirth ?? existing.date_of_birth, relationship ?? existing.relationship,
    req.params.id, req.user.id
  );

  const row = db.prepare('SELECT * FROM dependents WHERE id = ?').get(req.params.id);
  res.json({ dependent: row });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM dependents WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

export default router;
