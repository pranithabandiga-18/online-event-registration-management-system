const state = { user: null, csrfToken: '', events: [] };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function showNotice(message, error = false) {
  const notice = $('#notice');
  notice.textContent = message || '';
  notice.hidden = !message;
  notice.classList.toggle('notice-error', error);
  if (message) notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function api(url, options = {}) {
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const request = { method, headers, credentials: 'same-origin' };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(options.body);
  }
  if (!['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(url, request);
  const data = await response.json().catch(() => ({}));
  if (data.csrfToken) state.csrfToken = data.csrfToken;
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setView(viewId) {
  $$('.view').forEach(view => { view.hidden = view.id !== viewId; });
  $$('#navigation [data-view]').forEach(button => {
    if (button.dataset.view === viewId) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  showNotice('');
  const heading = $(`#${viewId} h1, #${viewId} h2`);
  heading?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateNavigation() {
  $('#identity').hidden = !state.user;
  $('#logout').hidden = !state.user;
  $('#identity').textContent = state.user ? `${state.user.name} · ${state.user.role}` : '';
  $('#account-nav').hidden = Boolean(state.user);
  $('#create-account-cta').hidden = Boolean(state.user);
  $('#student-nav').hidden = state.user?.role !== 'student';
  $('#admin-nav').hidden = state.user?.role !== 'admin';
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function eventCard(event, registered = false) {
  const card = element('article', 'event-card');
  const badge = element('span', `badge ${registered ? 'badge-confirmed' : ''}`, registered ? 'Registered' : 'Open');
  const top = element('div', 'event-card-top');
  top.append(badge, element('span', 'seat-count', `${event.seatsRemaining ?? '—'} seats left`));
  card.append(top);
  card.append(element('p', 'event-date', formatDate(event.startsAt)));
  card.append(element('h3', '', event.title));
  card.append(element('p', 'event-location', event.location));
  if (event.description) card.append(element('p', 'event-description', event.description));
  if (registered) {
    card.append(element('p', 'confirmation-inline', `Registered ${formatDate(event.registeredAt)}.`));
  } else {
    const button = element('button', 'button', state.user?.role === 'student' ? 'Register for event' : 'Sign in to register');
    button.type = 'button';
    button.dataset.registerEvent = String(event.id);
    button.disabled = Number(event.seatsRemaining) <= 0;
    if (button.disabled) button.textContent = 'Event is full';
    card.append(button);
  }
  return card;
}

async function refreshEvents() {
  const data = await api('/api/events');
  state.events = data.events;
  const list = $('#event-list');
  list.replaceChildren(...state.events.map(event => eventCard(event)));
  $('#empty-events').hidden = state.events.length !== 0;
}

async function refreshStudentRegistrations() {
  const data = await api('/api/student/registrations');
  const list = $('#registration-list');
  list.replaceChildren(...data.registrations.map(registration => eventCard({
    id: registration.eventId,
    title: registration.title,
    description: registration.description,
    startsAt: registration.startsAt,
    location: registration.location,
    registeredAt: registration.registeredAt
  }, true)));
  $('#empty-registrations').hidden = data.registrations.length !== 0;
}

function summaryCard(label, value) {
  const card = element('article', 'stat-card');
  card.append(element('span', 'stat-label', label), element('strong', 'stat-value', String(value)));
  return card;
}

async function refreshAdminDashboard() {
  const data = await api('/api/admin/dashboard');
  $('#admin-summary').replaceChildren(
    summaryCard('Students', data.summary.students),
    summaryCard('Events', data.summary.events),
    summaryCard('Registrations', data.summary.registrations)
  );
  const list = $('#admin-event-list');
  list.replaceChildren();
  $('#empty-admin-events').hidden = data.events.length !== 0;
  for (const event of data.events) {
    const row = element('div', 'admin-event-row');
    const detail = element('div', 'admin-event-detail');
    detail.append(element('strong', '', event.title), element('span', '', `${formatDate(event.startsAt)} · ${event.registeredCount}/${event.capacity} registered`));
    const participants = element('button', 'button button-small button-quiet', 'Participants');
    participants.type = 'button';
    participants.dataset.participantsEvent = String(event.id);
    row.append(detail, participants);
    list.append(row);
  }
}

async function showParticipants(eventId) {
  const data = await api(`/api/admin/events/${eventId}/participants`);
  $('#participant-title').textContent = `Participants · ${data.event.title}`;
  const list = $('#participant-list');
  list.replaceChildren();
  if (!data.participants.length) list.append(element('p', 'empty-state', 'No one has registered yet.'));
  for (const person of data.participants) {
    const row = element('div', 'participant-row');
    row.append(element('strong', '', person.name), element('span', '', person.email), element('time', '', formatDate(person.registeredAt)));
    list.append(row);
  }
  $('#participant-panel').hidden = false;
}

function showConfirmation(registration) {
  const event = registration.event;
  $('#confirmation-message').textContent = `Your place for ${event.title} is confirmed.`;
  const details = $('#confirmation-details');
  details.replaceChildren(
    element('span', '', formatDate(event.startsAt)),
    element('span', '', event.location)
  );
  setView('confirmation-view');
}

async function start() {
  const session = await api('/api/session');
  state.user = session.user;
  state.csrfToken = session.csrfToken;
  updateNavigation();
  await refreshEvents();
  if (state.user?.role === 'student') await refreshStudentRegistrations();
  if (state.user?.role === 'admin') await refreshAdminDashboard();
}

$('#navigation').addEventListener('click', async event => {
  const button = event.target.closest('button[data-view]');
  if (!button) return;
  try {
    if (button.dataset.view === 'student-view') await refreshStudentRegistrations();
    if (button.dataset.view === 'admin-view') await refreshAdminDashboard();
    setView(button.dataset.view);
  } catch (error) { showNotice(error.message, true); }
});

document.body.addEventListener('click', async event => {
  const viewButton = event.target.closest('button[data-view]:not(#navigation button)');
  if (viewButton) {
    if (viewButton.dataset.view === 'student-view' && state.user?.role === 'student') await refreshStudentRegistrations();
    setView(viewButton.dataset.view);
    return;
  }
  const registerButton = event.target.closest('[data-register-event]');
  if (registerButton) {
    if (!state.user) { setView('account-view'); showNotice('Create an account or sign in to register for an event.'); return; }
    if (state.user.role !== 'student') { showNotice('Student accounts register for events.', true); return; }
    registerButton.disabled = true;
    try {
      const data = await api(`/api/events/${registerButton.dataset.registerEvent}/register`, { method: 'POST', body: {} });
      await Promise.all([refreshEvents(), refreshStudentRegistrations()]);
      showConfirmation(data.registration);
    } catch (error) { showNotice(error.message, true); registerButton.disabled = false; }
    return;
  }
  const participantsButton = event.target.closest('[data-participants-event]');
  if (participantsButton) {
    try { await showParticipants(participantsButton.dataset.participantsEvent); }
    catch (error) { showNotice(error.message, true); }
  }
});

$('#register-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  try {
    const data = await api('/api/register', { method: 'POST', body });
    state.user = data.user;
    state.csrfToken = data.csrfToken;
    form.reset();
    updateNavigation();
    await refreshEvents();
    await refreshStudentRegistrations();
    setView('student-view');
    showNotice(data.message);
  } catch (error) { showNotice(error.message, true); }
});

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api('/api/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    state.user = data.user;
    state.csrfToken = data.csrfToken;
    form.reset();
    updateNavigation();
    if (state.user.role === 'admin') { await refreshAdminDashboard(); setView('admin-view'); }
    else { await refreshStudentRegistrations(); setView('student-view'); }
    showNotice(data.message);
  } catch (error) { showNotice(error.message, true); }
});

$('#logout').addEventListener('click', async () => {
  try {
    const data = await api('/api/logout', { method: 'POST', body: {} });
    state.user = data.user;
    state.csrfToken = data.csrfToken;
    updateNavigation();
    await refreshEvents();
    setView('events-view');
    showNotice(data.message);
  } catch (error) { showNotice(error.message, true); }
});

$('#refresh-events').addEventListener('click', () => refreshEvents().catch(error => showNotice(error.message, true)));
$('#refresh-registrations').addEventListener('click', () => refreshStudentRegistrations().catch(error => showNotice(error.message, true)));
$('#refresh-admin').addEventListener('click', () => refreshAdminDashboard().catch(error => showNotice(error.message, true)));
$('#close-participants').addEventListener('click', () => { $('#participant-panel').hidden = true; });

$('#event-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.capacity = Number(values.capacity);
  try {
    values.startsAt = new Date(values.startsAt).toISOString();
    const data = await api('/api/admin/events', { method: 'POST', body: values });
    form.reset();
    await refreshAdminDashboard();
    await refreshEvents();
    showNotice(`${data.event.title} is now listed.`);
  } catch (error) { showNotice(error.message, true); }
});

start().catch(error => showNotice(`Could not load the event service: ${error.message}`, true));
