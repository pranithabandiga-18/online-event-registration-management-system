const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');
const { hashPassword } = require('../server/security');

const ADMIN_EMAIL = 'event-admin@example.test';
const ADMIN_PASSWORD = 'Test-Admin-Password-2026!';
const STUDENT_PASSWORD = 'Test-Student-Password-2026!';

async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-registration-'));
  const db = openDatabase(path.join(directory, 'test.sqlite'));
  const admin = db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run('Test Administrator', ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD), 'admin', new Date().toISOString());
  const event = db.prepare('INSERT INTO events(title,description,starts_at,location,capacity,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
    .run('Future Campus Workshop', 'A test event.', '2099-06-15T10:00:00.000Z', 'Innovation Lab', 2, admin.lastInsertRowid, new Date().toISOString());
  const app = createApp(db);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, baseUrl, eventId: Number(event.lastInsertRowid) };
}

function makeClient(baseUrl) {
  let cookie = '';
  let csrfToken = '';
  return {
    async request(url, options = {}) {
      const method = options.method || 'GET';
      const headers = { Accept: 'application/json' };
      if (cookie) headers.Cookie = cookie;
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (!['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrfToken;
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
      if (data.csrfToken) csrfToken = data.csrfToken;
      return { response, data };
    }
  };
}

async function signIn(client, email, password) {
  await client.request('/api/session');
  return client.request('/api/login', { method: 'POST', body: { email, password } });
}

test('TC01: open registration page and see the event system', async t => {
  const { baseUrl } = await setup(t);
  const response = await fetch(baseUrl);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Create your student account/);
  assert.match(html, /Open events/);
});

test('TC02: register with valid details and receive a signed-in student account', async t => {
  const { baseUrl } = await setup(t);
  const client = makeClient(baseUrl);
  await client.request('/api/session');
  const { response, data } = await client.request('/api/register', {
    method: 'POST',
    body: { name: 'Asha Student', email: 'Asha.Student@example.test', password: STUDENT_PASSWORD }
  });
  assert.equal(response.status, 201);
  assert.equal(data.message, 'Registration successful.');
  assert.equal(data.user.email, 'asha.student@example.test');
  assert.equal(data.user.role, 'student');
  const session = await client.request('/api/session');
  assert.equal(session.data.user.email, 'asha.student@example.test');
});

test('TC03: reject an empty registration form with field validation', async t => {
  const { baseUrl } = await setup(t);
  const client = makeClient(baseUrl);
  await client.request('/api/session');
  const { response, data } = await client.request('/api/register', { method: 'POST', body: {} });
  assert.equal(response.status, 400);
  assert.equal(data.error, 'Check the highlighted fields.');
  assert.ok(data.fieldErrors.name);
  assert.ok(data.fieldErrors.email);
  assert.ok(data.fieldErrors.password);
});

test('TC04: reject an invalid email address', async t => {
  const { baseUrl } = await setup(t);
  const client = makeClient(baseUrl);
  await client.request('/api/session');
  const { response, data } = await client.request('/api/register', {
    method: 'POST',
    body: { name: 'Asha Student', email: 'not-an-email', password: STUDENT_PASSWORD }
  });
  assert.equal(response.status, 400);
  assert.equal(data.fieldErrors.email, 'Enter a valid email address.');
});

test('TC05: prevent duplicate student emails, including case differences', async t => {
  const { baseUrl } = await setup(t);
  const client = makeClient(baseUrl);
  await client.request('/api/session');
  const body = { name: 'Asha Student', email: 'asha@example.test', password: STUDENT_PASSWORD };
  const first = await client.request('/api/register', { method: 'POST', body });
  const duplicate = await client.request('/api/register', { method: 'POST', body: { ...body, email: 'ASHA@example.test' } });
  assert.equal(first.response.status, 201);
  assert.equal(duplicate.response.status, 409);
  assert.match(duplicate.data.error, /already registered/i);
});

test('TC06: sign in with valid credentials and load the student dashboard', async t => {
  const { baseUrl, db } = await setup(t);
  db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run('Mina Student', 'mina@example.test', hashPassword(STUDENT_PASSWORD), 'student', new Date().toISOString());
  const client = makeClient(baseUrl);
  const { response, data } = await signIn(client, 'mina@example.test', STUDENT_PASSWORD);
  assert.equal(response.status, 200);
  assert.equal(data.user.name, 'Mina Student');
  const dashboard = await client.request('/api/student/registrations');
  assert.equal(dashboard.response.status, 200);
  assert.deepEqual(dashboard.data.registrations, []);
});

test('TC07: register for an event and show it in the student registrations list', async t => {
  const { baseUrl, db, eventId } = await setup(t);
  db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run('Mina Student', 'mina@example.test', hashPassword(STUDENT_PASSWORD), 'student', new Date().toISOString());
  const client = makeClient(baseUrl);
  await signIn(client, 'mina@example.test', STUDENT_PASSWORD);
  const registration = await client.request(`/api/events/${eventId}/register`, { method: 'POST', body: {} });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.data.message, 'Event registration confirmed.');
  assert.equal(registration.data.registration.event.title, 'Future Campus Workshop');
  const saved = await client.request('/api/student/registrations');
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.registrations.length, 1);
  assert.equal(saved.data.registrations[0].title, 'Future Campus Workshop');
});

test('admin dashboard lists participants for its event', async t => {
  const { baseUrl, db, eventId } = await setup(t);
  const student = db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run('Mina Student', 'mina@example.test', hashPassword(STUDENT_PASSWORD), 'student', new Date().toISOString());
  db.prepare('INSERT INTO registrations(user_id,event_id,registered_at) VALUES (?,?,?)')
    .run(student.lastInsertRowid, eventId, new Date().toISOString());
  const client = makeClient(baseUrl);
  const login = await signIn(client, ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(login.response.status, 200);
  const dashboard = await client.request('/api/admin/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.summary.students, 1);
  const participants = await client.request(`/api/admin/events/${eventId}/participants`);
  assert.equal(participants.response.status, 200);
  assert.equal(participants.data.participants[0].email, 'mina@example.test');
});

test('admin can publish a future event and it appears in the public event list', async t => {
  const { baseUrl } = await setup(t);
  const client = makeClient(baseUrl);
  await signIn(client, ADMIN_EMAIL, ADMIN_PASSWORD);
  const created = await client.request('/api/admin/events', {
    method: 'POST',
    body: {
      title: 'Campus Arts Evening',
      description: 'Student performances and exhibits.',
      startsAt: '2099-08-20T18:00:00.000Z',
      location: 'Arts Hall',
      capacity: 75
    }
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.event.title, 'Campus Arts Evening');
  const listing = await client.request('/api/events');
  assert.ok(listing.data.events.some(event => event.title === 'Campus Arts Evening'));
});

test('admin accounts cannot register as students', async t => {
  const { baseUrl, eventId } = await setup(t);
  const client = makeClient(baseUrl);
  await signIn(client, ADMIN_EMAIL, ADMIN_PASSWORD);
  const result = await client.request(`/api/events/${eventId}/register`, { method: 'POST', body: {} });
  assert.equal(result.response.status, 403);
});

test('event registration prevents duplicates and respects capacity', async t => {
  const { baseUrl, db, eventId } = await setup(t);
  db.prepare('UPDATE events SET capacity=1 WHERE id=?').run(eventId);
  const firstUser = db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run('First Student', 'first@example.test', hashPassword(STUDENT_PASSWORD), 'student', new Date().toISOString());
  const secondUser = db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run('Second Student', 'second@example.test', hashPassword(STUDENT_PASSWORD), 'student', new Date().toISOString());
  const first = makeClient(baseUrl);
  await signIn(first, 'first@example.test', STUDENT_PASSWORD);
  assert.equal((await first.request(`/api/events/${eventId}/register`, { method: 'POST', body: {} })).response.status, 201);
  assert.equal((await first.request(`/api/events/${eventId}/register`, { method: 'POST', body: {} })).response.status, 409);
  const second = makeClient(baseUrl);
  await signIn(second, 'second@example.test', STUDENT_PASSWORD);
  const full = await second.request(`/api/events/${eventId}/register`, { method: 'POST', body: {} });
  assert.equal(full.response.status, 409);
  assert.match(full.data.error, /full/i);
  assert.ok(firstUser.lastInsertRowid);
  assert.ok(secondUser.lastInsertRowid);
});
