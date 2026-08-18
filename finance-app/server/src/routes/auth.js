import crypto from 'crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { ensureDefaultCategories } from '../db/index.js';
import { signToken, authRequired } from '../auth.js';

const router = Router();

function normalizeInitialAccountType(value) {
  const normalized = String(value || 'brokerage').trim().toLowerCase();
  const validTypes = ['brokerage', '401k', 'ira', 'roth_ira', 'checking', 'savings', 'credit_card', 'other'];
  return validTypes.includes(normalized) ? normalized : 'other';
}

function createInitialAccounts(userId, initialAccounts) {
  if (!Array.isArray(initialAccounts)) return;

  for (const rawAccount of initialAccounts) {
    if (!rawAccount || !String(rawAccount.accountName || '').trim()) continue;

    const accountName = String(rawAccount.accountName).trim();
    const institution = String(rawAccount.institution || '').trim() || null;
    const accountType = normalizeInitialAccountType(rawAccount.accountType);
    const currentBalance = Number(rawAccount.currentBalance || 0);

    const accountInfo = db.prepare(`
      INSERT INTO investment_accounts (user_id, account_name, account_type, institution, current_balance)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, accountName, accountType, institution, currentBalance);

    const holdings = Array.isArray(rawAccount.holdings) ? rawAccount.holdings : [];
    for (const holding of holdings) {
      const symbol = String(holding?.symbol || '').trim().toUpperCase();
      const shares = Number(holding?.shares || 0);
      if (!symbol || !Number.isFinite(shares) || shares <= 0) continue;

      const purchasePrice = Number(holding?.price || holding?.currentPrice || 0);
      db.prepare(`
        INSERT INTO investments (user_id, investment_account_id, symbol, shares, purchase_date, purchase_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, accountInfo.lastInsertRowid, symbol, shares, new Date().toISOString().slice(0, 10), purchasePrice);
    }
  }
}

router.post('/signup', (req, res) => {
  const {
    email, password, firstName, lastName, dateOfBirth, phone,
    addressLine1, addressLine2, city, state, zip,
    customerType, accountType, businessName,
    spouseFirstName, spouseLastName, spouseDateOfBirth,
    initialAccounts,
  } = req.body || {};

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const finalCustomerType = customerType === 'business' ? 'business' : 'personal';
  const validAccountTypes = ['individual', 'sole_proprietor', 'partnership', 's_corp'];
  let finalAccountType = validAccountTypes.includes(accountType) ? accountType : 'individual';
  if (finalCustomerType === 'personal') finalAccountType = 'individual';
  else if (finalAccountType === 'individual') finalAccountType = 'sole_proprietor';

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (email, password_hash, first_name, last_name, date_of_birth, phone,
      address_line1, address_line2, city, state, zip, customer_type, account_type, business_name,
      spouse_first_name, spouse_last_name, spouse_date_of_birth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    email, passwordHash, firstName || null, lastName || null, dateOfBirth || null, phone || null,
    addressLine1 || null, addressLine2 || null, city || null, state || null, zip || null,
    finalCustomerType, finalAccountType, finalCustomerType === 'business' ? (businessName || null) : null,
    spouseFirstName || null, spouseLastName || null, spouseDateOfBirth || null
  );

  ensureDefaultCategories(info.lastInsertRowid);
  createInitialAccounts(info.lastInsertRowid, initialAccounts);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(user);
  res.status(201).json({ token, user: sanitizeUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.status === 'suspended') return res.status(403).json({ error: 'This account has been suspended' });

  const token = signToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

router.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!email || !String(email).trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user) {
    return res.json({
      message: 'If an account exists for that email, a password reset link has been sent.',
    });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)')
    .run(user.id, token, expiresAt);

  const resetUrl = `${process.env.APP_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
  console.log(`Password reset link for ${user.email}: ${resetUrl}`);

  res.json({
    message: 'If an account exists for that email, a password reset link has been sent.',
    resetUrl,
  });
});

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'Reset token and new password are required' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const resetToken = db.prepare("SELECT * FROM password_reset_tokens WHERE token = ? AND expires_at > datetime('now')").get(token);
  if (!resetToken) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, resetToken.user_id);
  db.prepare('DELETE FROM password_reset_tokens WHERE token = ?').run(token);

  res.json({ message: 'Your password has been reset successfully.' });
});

router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: sanitizeUser(user) });
});

router.put('/me', authRequired, (req, res) => {
  const {
    firstName, lastName, dateOfBirth, phone,
    addressLine1, addressLine2, city, state, zip,
    customerType, accountType, businessName,
    spouseFirstName, spouseLastName, spouseDateOfBirth,
  } = req.body || {};

  const validAccountTypes = ['individual', 'sole_proprietor', 'partnership', 's_corp'];
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!current) return res.status(404).json({ error: 'User not found' });

  const finalCustomerType = customerType === 'business' || customerType === 'personal' ? customerType : current.customer_type;
  let finalAccountType = validAccountTypes.includes(accountType) ? accountType : current.account_type;
  if (finalCustomerType === 'personal') finalAccountType = 'individual';
  else if (finalAccountType === 'individual') finalAccountType = 'sole_proprietor';

  db.prepare(`
    UPDATE users SET first_name = ?, last_name = ?, date_of_birth = ?, phone = ?,
      address_line1 = ?, address_line2 = ?, city = ?, state = ?, zip = ?,
      customer_type = ?, account_type = ?, business_name = ?,
      spouse_first_name = ?, spouse_last_name = ?, spouse_date_of_birth = ?
    WHERE id = ?
  `).run(
    firstName ?? current.first_name, lastName ?? current.last_name,
    dateOfBirth ?? current.date_of_birth, phone ?? current.phone,
    addressLine1 ?? current.address_line1, addressLine2 ?? current.address_line2,
    city ?? current.city, state ?? current.state, zip ?? current.zip,
    finalCustomerType, finalAccountType, finalCustomerType === 'business' ? (businessName ?? current.business_name) : null,
    spouseFirstName ?? current.spouse_first_name, spouseLastName ?? current.spouse_last_name,
    spouseDateOfBirth ?? current.spouse_date_of_birth,
    req.user.id
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: sanitizeUser(updated) });
});

router.delete('/me', authRequired, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.json({ success: true });
});

router.get('/me/export', authRequired, (req, res) => {
  const userId = req.user.id;
  const data = {
    user: sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)),
    paychecks: db.prepare('SELECT * FROM paychecks WHERE user_id = ?').all(userId),
    transactions: db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(userId),
    categories: db.prepare('SELECT * FROM categories WHERE user_id = ?').all(userId),
    investment_accounts: db.prepare('SELECT * FROM investment_accounts WHERE user_id = ?').all(userId),
    investments: db.prepare('SELECT * FROM investments WHERE user_id = ?').all(userId),
    dividends: db.prepare('SELECT * FROM dividends WHERE user_id = ?').all(userId),
    dependents: db.prepare('SELECT * FROM dependents WHERE user_id = ?').all(userId),
  };

  const format = (req.query.format || 'json').toLowerCase();
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
    const lines = ['section,json'];
    for (const [section, rows] of Object.entries(data)) {
      lines.push(`${section},"${JSON.stringify(rows).replace(/"/g, '""')}"`);
    }
    return res.send(lines.join('\n'));
  }

  res.setHeader('Content-Disposition', 'attachment; filename="export.json"');
  res.json(data);
});

export function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

export default router;
