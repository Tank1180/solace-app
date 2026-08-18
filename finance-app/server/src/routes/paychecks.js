import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

function computeNet(p) {
  return (
    Number(p.gross_pay || 0)
    - Number(p.federal_tax || 0)
    - Number(p.state_tax || 0)
    - Number(p.social_security || 0)
    - Number(p.medicare || 0)
    - Number(p.benefits_deduction || 0)
    - Number(p.retirement_contribution || 0)
  );
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM paychecks WHERE user_id = ? ORDER BY pay_date DESC').all(req.user.id);
  res.json({ paychecks: rows });
});

router.post('/', (req, res) => {
  const p = req.body || {};
  if (!p.payDate || p.grossPay == null) return res.status(400).json({ error: 'payDate and grossPay are required' });
  const ownerType = p.ownerType === 'spouse' ? 'spouse' : 'self';

  const netPay = computeNet({
    gross_pay: p.grossPay, federal_tax: p.federalTax, state_tax: p.stateTax,
    social_security: p.socialSecurity, medicare: p.medicare,
    benefits_deduction: p.benefitsDeduction, retirement_contribution: p.retirementContribution,
  });

  const info = db.prepare(`
    INSERT INTO paychecks (user_id, owner_type, pay_date, employer, gross_pay, federal_tax, state_tax,
      social_security, medicare, benefits_deduction, retirement_contribution, net_pay)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, ownerType, p.payDate, p.employer || null, p.grossPay || 0, p.federalTax || 0, p.stateTax || 0,
    p.socialSecurity || 0, p.medicare || 0, p.benefitsDeduction || 0, p.retirementContribution || 0, netPay
  );

  const row = db.prepare('SELECT * FROM paychecks WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ paycheck: row });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM paychecks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Paycheck not found' });

  const p = req.body || {};
  if (!p.payDate || p.grossPay == null) return res.status(400).json({ error: 'payDate and grossPay are required' });
  const ownerType = p.ownerType === 'spouse' ? 'spouse' : 'self';

  const allocated = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as v FROM retirement_contribution_allocations WHERE user_id = ? AND paycheck_id = ?'
  ).get(req.user.id, req.params.id).v;
  const newRetirementContribution = Number(p.retirementContribution || 0);
  if (newRetirementContribution < Number(allocated || 0)) {
    return res.status(400).json({ error: 'Retirement contribution cannot be less than the amount already allocated in Investments' });
  }

  const netPay = computeNet({
    gross_pay: p.grossPay, federal_tax: p.federalTax, state_tax: p.stateTax,
    social_security: p.socialSecurity, medicare: p.medicare,
    benefits_deduction: p.benefitsDeduction, retirement_contribution: p.retirementContribution,
  });

  db.prepare(`
    UPDATE paychecks
    SET owner_type = ?, pay_date = ?, employer = ?, gross_pay = ?, federal_tax = ?, state_tax = ?,
      social_security = ?, medicare = ?, benefits_deduction = ?, retirement_contribution = ?, net_pay = ?
    WHERE id = ? AND user_id = ?
  `).run(
    ownerType, p.payDate, p.employer || null, p.grossPay || 0, p.federalTax || 0, p.stateTax || 0,
    p.socialSecurity || 0, p.medicare || 0, p.benefitsDeduction || 0, p.retirementContribution || 0, netPay,
    req.params.id, req.user.id
  );

  const row = db.prepare('SELECT * FROM paychecks WHERE id = ?').get(req.params.id);
  res.json({ paycheck: row });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM paychecks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

export default router;
