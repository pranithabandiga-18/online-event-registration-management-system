const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function openDatabase(file = process.env.DB_PATH || path.join(process.cwd(), 'data', 'events.sqlite')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode=WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','admin')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 120),
      description TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL,
      location TEXT NOT NULL CHECK(length(location) BETWEEN 1 AND 150),
      capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 10000),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      event_id INTEGER NOT NULL REFERENCES events(id),
      registered_at TEXT NOT NULL,
      UNIQUE(user_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS events_active_start ON events(active, starts_at);
    CREATE INDEX IF NOT EXISTS registrations_event ON registrations(event_id);
    CREATE INDEX IF NOT EXISTS registrations_user ON registrations(user_id);
  `);
  return db;
}

function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = callback();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

module.exports = { openDatabase, transaction };
