const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { hashPassword, verifyPassword } = require('./security');
const { transaction } = require('./db');

const COOKIE_NAME = 'event_sid';
const SESSION_SECONDS = 12 * 60 * 60;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function publicUser(row) {
  return row ? { id: Number(row.id), name: row.name, email: row.email, role: row.role } : null;
}

function isUniqueConstraint(error) {
  return /CONSTRAINT_UNIQUE$/.test(String(error.code || '')) || /UNIQUE constraint failed/i.test(error.message || '');
}

function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    result[key] = value;
  }
  return result;
}

function setSessionCookie(response, id, secure) {
  const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`;
  response.append('Set-Cookie', `${COOKIE_NAME}=${id}; ${flags}`);
}

function createApp(db, options = {}) {
  const app = express();
  const sessions = options.sessions || new Map();
  const secureCookie = options.secureCookie ?? process.env.COOKIE_SECURE === 'true';

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Referrer-Policy', 'same-origin');
    response.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', etag: true }));

  app.get('/healthz', (request, response) => response.json({ ok: true }));

  app.use('/api', (request, response, next) => {
    let sessionId = parseCookies(request.headers.cookie)[COOKIE_NAME];
    let session = sessionId && sessions.get(sessionId);
    if (!session) {
      sessionId = crypto.randomBytes(32).toString('hex');
      session = { userId: null, csrfToken: crypto.randomBytes(24).toString('hex') };
      sessions.set(sessionId, session);
      setSessionCookie(response, sessionId, secureCookie);
    }
    request.sessionId = sessionId;
    request.session = session;
    const row = session.userId ? db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(session.userId) : null;
    request.user = publicUser(row);
    if (!row && session.userId) session.userId = null;
    next();
  });

  function requireCsrf(request, response, next) {
    if (!request.session.csrfToken || request.get('X-CSRF-Token') !== request.session.csrfToken) {
      return response.status(403).json({ error: 'Refresh the page and try again.' });
    }
    next();
  }

  function requireRole(role) {
    return (request, response, next) => {
      if (!request.user) return response.status(401).json({ error: 'Sign in to continue.' });
      if (role && request.user.role !== role) return response.status(403).json({ error: 'You do not have access to this page.' });
      next();
    };
  }

  function rotateSession(request, response, userId) {
    sessions.delete(request.sessionId);
    const id = crypto.randomBytes(32).toString('hex');
    const session = { userId: Number(userId), csrfToken: crypto.randomBytes(24).toString('hex') };
    sessions.set(id, session);
    request.sessionId = id;
    request.session = session;
    setSessionCookie(response, id, secureCookie);
    return session;
  }

  function listEvents({ includeInactive = false, upcomingOnly = !includeInactive } = {}) {
    const conditions = [];
    if (!includeInactive) conditions.push('e.active=1');
    if (upcomingOnly) conditions.push('e.starts_at>?');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const parameters = upcomingOnly ? [new Date().toISOString()] : [];
    return db.prepare(`
      SELECT e.id,e.title,e.description,e.starts_at AS startsAt,e.location,e.capacity,e.active,
        COUNT(r.id) AS registeredCount,
        e.capacity-COUNT(r.id) AS seatsRemaining
      FROM events e LEFT JOIN registrations r ON r.event_id=e.id
      ${where}
      GROUP BY e.id
      ORDER BY e.starts_at,e.id
    `).all(...parameters).map(event => ({
      ...event,
      id: Number(event.id),
      capacity: Number(event.capacity),
      active: Boolean(event.active),
      registeredCount: Number(event.registeredCount),
      seatsRemaining: Number(event.seatsRemaining)
    }));
  }

  app.get('/api/session', (request, response) => response.json({ user: request.user, csrfToken: request.session.csrfToken }));

  app.post('/api/register', requireCsrf, (request, response) => {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const errors = {};
    if (!name || name.length > 120) errors.name = 'Enter your name (up to 120 characters).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = 'Enter a valid email address.';
    if (password.length < 12 || password.length > 256) errors.password = 'Password must be at least 12 characters.';
    if (Object.keys(errors).length) return response.status(400).json({ error: 'Check the highlighted fields.', fieldErrors: errors });

    try {
      const result = db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
        .run(name, email, hashPassword(password), 'student', new Date().toISOString());
      const session = rotateSession(request, response, result.lastInsertRowid);
      const user = publicUser(db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(result.lastInsertRowid));
      return response.status(201).json({ message: 'Registration successful.', user, csrfToken: session.csrfToken });
    } catch (error) {
      if (isUniqueConstraint(error)) return response.status(409).json({ error: 'That email address is already registered.' });
      throw error;
    }
  });

  app.post('/api/login', requireCsrf, (request, response) => {
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (!email || !password) return response.status(400).json({ error: 'Enter your email and password.' });
    const row = db.prepare('SELECT id,name,email,password_hash,role FROM users WHERE email=? AND role IN (\'student\',\'admin\')').get(email);
    if (!row || !verifyPassword(password, row.password_hash)) return response.status(401).json({ error: 'Invalid email or password.' });
    const session = rotateSession(request, response, row.id);
    return response.json({ message: 'Signed in successfully.', user: publicUser(row), csrfToken: session.csrfToken });
  });

  app.post('/api/logout', requireCsrf, (request, response) => {
    sessions.delete(request.sessionId);
    const id = crypto.randomBytes(32).toString('hex');
    const session = { userId: null, csrfToken: crypto.randomBytes(24).toString('hex') };
    sessions.set(id, session);
    request.sessionId = id;
    request.session = session;
    request.user = null;
    setSessionCookie(response, id, secureCookie);
    return response.json({ message: 'Signed out.', user: null, csrfToken: session.csrfToken });
  });

  app.get('/api/events', (request, response) => response.json({ events: listEvents() }));

  app.post('/api/events/:eventId/register', requireRole('student'), requireCsrf, (request, response) => {
    const eventId = Number(request.params.eventId);
    if (!Number.isSafeInteger(eventId) || eventId < 1) return response.status(404).json({ error: 'Event not found.' });
    const registeredAt = new Date().toISOString();
    try {
      const registration = transaction(db, () => {
        const event = db.prepare('SELECT id,title,description,starts_at AS startsAt,location,capacity,active FROM events WHERE id=?').get(eventId);
        if (!event || !event.active) {
          const error = new Error('Event not found.'); error.status = 404; throw error;
        }
        if (event.startsAt <= registeredAt) {
          const error = new Error('Registration for this event has closed.'); error.status = 400; throw error;
        }
        if (db.prepare('SELECT 1 FROM registrations WHERE user_id=? AND event_id=?').get(request.user.id, eventId)) {
          const error = new Error('You are already registered for this event.'); error.status = 409; throw error;
        }
        const count = Number(db.prepare('SELECT COUNT(*) AS count FROM registrations WHERE event_id=?').get(eventId).count);
        if (count >= Number(event.capacity)) {
          const error = new Error('This event is full.'); error.status = 409; throw error;
        }
        const result = db.prepare('INSERT INTO registrations(user_id,event_id,registered_at) VALUES (?,?,?)')
          .run(request.user.id, eventId, registeredAt);
        return { id: Number(result.lastInsertRowid), registeredAt, event };
      });
      return response.status(201).json({ message: 'Event registration confirmed.', registration });
    } catch (error) {
      if (error.status) return response.status(error.status).json({ error: error.message });
      if (isUniqueConstraint(error)) return response.status(409).json({ error: 'You are already registered for this event.' });
      throw error;
    }
  });

  app.get('/api/student/registrations', requireRole('student'), (request, response) => {
    const registrations = db.prepare(`
      SELECT r.id AS registrationId,r.registered_at AS registeredAt,
        e.id AS eventId,e.title,e.description,e.starts_at AS startsAt,e.location
      FROM registrations r JOIN events e ON e.id=r.event_id
      WHERE r.user_id=?
      ORDER BY e.starts_at,e.id
    `).all(request.user.id).map(row => ({ ...row, registrationId: Number(row.registrationId), eventId: Number(row.eventId) }));
    return response.json({ registrations });
  });

  app.get('/api/admin/dashboard', requireRole('admin'), (request, response) => {
    const students = Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='student'").get().count);
    const eventCount = Number(db.prepare('SELECT COUNT(*) AS count FROM events').get().count);
    const registrationCount = Number(db.prepare('SELECT COUNT(*) AS count FROM registrations').get().count);
    return response.json({ summary: { students, events: eventCount, registrations: registrationCount }, events: listEvents({ includeInactive: true }) });
  });

  app.post('/api/admin/events', requireRole('admin'), requireCsrf, (request, response) => {
    const body = request.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const capacity = Number(body.capacity);
    const startsAtDate = typeof body.startsAt === 'string' ? new Date(body.startsAt) : new Date(NaN);
    const errors = {};
    if (title.length < 3 || title.length > 120) errors.title = 'Enter an event title between 3 and 120 characters.';
    if (description.length > 2000) errors.description = 'Description must be 2,000 characters or fewer.';
    if (!location || location.length > 150) errors.location = 'Enter a location (up to 150 characters).';
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) errors.capacity = 'Capacity must be a whole number from 1 to 10,000.';
    if (Number.isNaN(startsAtDate.getTime()) || startsAtDate.getTime() <= Date.now()) errors.startsAt = 'Choose a valid future date and time.';
    if (Object.keys(errors).length) return response.status(400).json({ error: 'Check the highlighted fields.', fieldErrors: errors });
    const startsAt = startsAtDate.toISOString();
    const result = db.prepare('INSERT INTO events(title,description,starts_at,location,capacity,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(title, description, startsAt, location, capacity, request.user.id, new Date().toISOString());
    const event = listEvents({ includeInactive: true }).find(item => item.id === Number(result.lastInsertRowid));
    return response.status(201).json({ message: 'Event created.', event });
  });

  app.get('/api/admin/events/:eventId/participants', requireRole('admin'), (request, response) => {
    const eventId = Number(request.params.eventId);
    const event = db.prepare('SELECT id,title FROM events WHERE id=?').get(eventId);
    if (!event) return response.status(404).json({ error: 'Event not found.' });
    const participants = db.prepare(`
      SELECT u.id,u.name,u.email,r.registered_at AS registeredAt
      FROM registrations r JOIN users u ON u.id=r.user_id
      WHERE r.event_id=? ORDER BY r.registered_at,u.name
    `).all(eventId).map(person => ({ ...person, id: Number(person.id) }));
    return response.json({ event: { id: Number(event.id), title: event.title }, participants });
  });

  app.use('/api', (request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return response.status(400).json({ error: 'Request body must be valid JSON.' });
    console.error('Request failed:', error.message);
    return response.status(error.status || 500).json({ error: error.status ? error.message : 'The server could not complete the request.' });
  });

  return app;
}

module.exports = { createApp };
