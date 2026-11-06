const { openDatabase, transaction } = require('../server/db');
const { hashPassword } = require('../server/security');

const db = openDatabase();
const username = typeof process.env.ADMIN_USERNAME === 'string' ? process.env.ADMIN_USERNAME.trim() : '';
const password = process.env.ADMIN_PASSWORD || '';
let failed = false;

if (!username || username.length > 120 || password.length < 12 || password.length > 256) {
  console.error('Set ADMIN_USERNAME and an ADMIN_PASSWORD between 12 and 256 characters.');
  failed = true;
} else {
  transaction(db, () => {
    const existingAdmin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
    let adminId = existingAdmin ? Number(existingAdmin.id) : null;
    if (!existingAdmin) {
      const created = db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
        .run(username, `${username.toLowerCase()}@admin.local`, hashPassword(password), 'admin', new Date().toISOString());
      adminId = Number(created.lastInsertRowid);
      console.log('Initial administrator created.');
    } else {
      console.log('An administrator already exists; its credentials were not changed.');
    }

    if (process.env.SEED_DEMO === 'true') {
      const demos = [
        ['Welcome Day', 'Meet student societies, collect your campus pass, and learn what is happening this term.', 'Student Centre', 120],
        ['Web Development Workshop', 'A hands-on introduction to building accessible web applications.', 'Innovation Lab', 40]
      ];
      for (const [title, description, location, capacity] of demos) {
        if (!db.prepare('SELECT id FROM events WHERE title=?').get(title)) {
          db.prepare('INSERT INTO events(title,description,starts_at,location,capacity,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
            .run(title, description, '2099-06-15T10:00:00.000Z', location, capacity, adminId, new Date().toISOString());
        }
      }
      console.log('Synthetic demonstration events are available.');
    }
  });
}

db.close();
if (failed) process.exitCode = 1;
