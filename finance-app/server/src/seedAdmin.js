import bcrypt from 'bcryptjs';
import db, { initDb } from './db/index.js';

const email = process.argv[2] || 'admin@example.com';
const password = process.argv[3] || 'admin1234';

await initDb();

const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  await db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
  console.log(`Existing user ${email} promoted to admin.`);
} else {
  const passwordHash = bcrypt.hashSync(password, 10);
  await db.prepare(`
    INSERT INTO users (email, password_hash, first_name, last_name, account_type, role)
    VALUES (?, ?, 'Admin', 'User', 'individual', 'admin')
  `).run(email, passwordHash);
  console.log(`Admin user created: ${email} / ${password}`);
}
