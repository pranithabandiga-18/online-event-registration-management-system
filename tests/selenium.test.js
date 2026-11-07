'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');
const { hashPassword } = require('../server/security');

const ADMIN_EMAIL = 'event-admin@example.test';
const ADMIN_PASSWORD = 'Selenium-Test-Admin-2026!';
const STUDENT_PASSWORD = 'Selenium-Test-Student-2026!';
const TIMEOUT_MS = 10000;

function uniqueEmail(label) {
  return `${label}-${crypto.randomBytes(5).toString('hex')}@example.test`;
}

async function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-registration-selenium-'));
  const db = openDatabase(path.join(directory, 'events.sqlite'));
  const now = new Date().toISOString();
  const admin = db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .run('Selenium Administrator', ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD), 'admin', now);
  const eventTitle = `Selenium Workshop ${crypto.randomBytes(3).toString('hex')}`;
  const event = db.prepare('INSERT INTO events(title,description,starts_at,location,capacity,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(eventTitle, 'Synthetic event used only by the browser test.', '2099-06-15T10:00:00.000Z', 'Test Innovation Lab', 5, admin.lastInsertRowid, now);
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    db,
    directory,
    eventId: Number(event.lastInsertRowid),
    eventTitle,
    server
  };
}

async function withBrowser(t, callback) {
  const fixture = await createFixture();
  let driver;
  try {
    const options = new chrome.Options().addArguments(
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1440,1000'
    );
    if (process.env.CHROME_BIN) options.setChromeBinaryPath(process.env.CHROME_BIN);
    driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    const capabilities = await driver.getCapabilities();
    t.diagnostic(`Browser: Chrome ${capabilities.getBrowserVersion()}; Node ${process.version}; started ${new Date().toISOString()}`);
    await callback({ ...fixture, driver });
  } finally {
    if (driver) await driver.quit().catch(() => {});
    await new Promise(resolve => fixture.server.close(resolve));
    fixture.db.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
}

async function waitVisible(driver, selector) {
  return driver.wait(async () => {
    const element = await driver.findElement(By.css(selector));
    return await element.isDisplayed() ? element : false;
  }, TIMEOUT_MS, `Waiting for ${selector} to become visible`);
}

async function enter(driver, selector, value) {
  const input = await driver.findElement(By.css(selector));
  await input.clear();
  await input.sendKeys(value);
}

async function registerStudent(driver, name, email) {
  await driver.findElement(By.id('account-nav')).click();
  await enter(driver, '#register-form input[name="name"]', name);
  await enter(driver, '#register-form input[name="email"]', email);
  await enter(driver, '#register-form input[name="password"]', STUDENT_PASSWORD);
  await driver.findElement(By.css('#register-form button[type="submit"]')).click();
  await waitVisible(driver, '#student-view');
}

async function signOut(driver) {
  await driver.findElement(By.id('logout')).click();
  await driver.wait(until.elementIsVisible(driver.findElement(By.id('account-nav'))), TIMEOUT_MS);
  await driver.findElement(By.id('account-nav')).click();
}

async function signInAdmin(driver) {
  await enter(driver, '#login-form input[name="email"]', ADMIN_EMAIL);
  await enter(driver, '#login-form input[name="password"]', ADMIN_PASSWORD);
  await driver.findElement(By.css('#login-form button[type="submit"]')).click();
  await waitVisible(driver, '#admin-view');
}

test('S01: open the page and display available events', async t => {
  await withBrowser(t, async ({ baseUrl, driver, eventTitle }) => {
    await driver.get(baseUrl);
    await waitVisible(driver, '#events-title');
    const card = await driver.wait(until.elementLocated(By.css('#event-list .event-card')), TIMEOUT_MS);
    assert.match(await driver.findElement(By.id('events-title')).getText(), /Make room/);
    assert.ok((await card.getText()).includes(eventTitle), 'the seeded test event should appear in the event list');
  });
});

test('S02: require registration fields and reject an invalid email in the browser', async t => {
  await withBrowser(t, async ({ baseUrl, driver }) => {
    await driver.get(baseUrl);
    await driver.findElement(By.id('account-nav')).click();
    const emptyFormValid = await driver.executeScript("return document.querySelector('#register-form').checkValidity();");
    assert.equal(emptyFormValid, false, 'the empty registration form should be invalid');

    await enter(driver, '#register-form input[name="name"]', 'Test Student');
    await enter(driver, '#register-form input[name="email"]', 'not-an-email');
    await enter(driver, '#register-form input[name="password"]', STUDENT_PASSWORD);
    const emailValid = await driver.executeScript("return document.querySelector('#register-form input[name=email]').checkValidity();");
    assert.equal(emailValid, false, 'the browser should reject an invalid email address');
  });
});

test('S03: register a student, register for an event, and view the confirmation', async t => {
  await withBrowser(t, async ({ baseUrl, driver, eventTitle }) => {
    const email = uniqueEmail('student');
    await driver.get(baseUrl);
    await registerStudent(driver, 'Selenium Student', email);

    await driver.findElement(By.css('#navigation button[data-view="events-view"]')).click();
    const registerButton = await driver.wait(until.elementLocated(By.css('#event-list [data-register-event]')), TIMEOUT_MS);
    await registerButton.click();
    await waitVisible(driver, '#confirmation-view');
    assert.match(await driver.findElement(By.id('confirmation-message')).getText(), new RegExp(eventTitle));

    await driver.findElement(By.css('#confirmation-view button[data-view="student-view"]')).click();
    await waitVisible(driver, '#student-view .event-card');
    const registration = await driver.findElement(By.css('#student-view .event-card')).getText();
    assert.ok(registration.includes(eventTitle));
    assert.match(registration, /Registered/);

    await signOut(driver);
    await enter(driver, '#login-form input[name="email"]', email);
    await enter(driver, '#login-form input[name="password"]', STUDENT_PASSWORD);
    await driver.findElement(By.css('#login-form button[type="submit"]')).click();
    await waitVisible(driver, '#student-view');
    assert.ok((await driver.findElement(By.id('identity')).getText()).includes('Selenium Student'));
  });
});

test('S04: reject a second student account using the same email', async t => {
  await withBrowser(t, async ({ baseUrl, driver }) => {
    const email = uniqueEmail('duplicate');
    await driver.get(baseUrl);
    await registerStudent(driver, 'First Student', email);
    await signOut(driver);

    await enter(driver, '#register-form input[name="name"]', 'Second Student');
    await enter(driver, '#register-form input[name="email"]', email);
    await enter(driver, '#register-form input[name="password"]', STUDENT_PASSWORD);
    await driver.findElement(By.css('#register-form button[type="submit"]')).click();
    await waitVisible(driver, '#notice');
    assert.match(await driver.findElement(By.id('notice')).getText(), /already registered/i);
  });
});

test('S05: administrator publishes an event and views its participants', async t => {
  await withBrowser(t, async ({ baseUrl, driver, eventTitle }) => {
    const studentEmail = uniqueEmail('participant');
    await driver.get(baseUrl);
    await registerStudent(driver, 'Workshop Participant', studentEmail);
    t.diagnostic('Student account created.');
    await driver.findElement(By.css('#navigation button[data-view="events-view"]')).click();
    const eventRegisterButton = await driver.wait(until.elementLocated(By.css('#event-list [data-register-event]')), TIMEOUT_MS);
    await eventRegisterButton.click();
    await waitVisible(driver, '#confirmation-view');
    t.diagnostic('Student registration confirmed.');
    await signOut(driver);
    t.diagnostic('Signed out before administrator login.');
    await signInAdmin(driver);
    t.diagnostic('Administrator dashboard opened.');

    const newTitle = `Admin Event ${crypto.randomBytes(3).toString('hex')}`;
    await enter(driver, '#event-form input[name="title"]', newTitle);
    await enter(driver, '#event-form textarea[name="description"]', 'Created by the Selenium browser test.');
    const startsAt = await driver.findElement(By.css('#event-form input[name="startsAt"]'));
    await driver.executeScript(
      "arguments[0].value='2099-08-20T18:00'; arguments[0].dispatchEvent(new Event('input',{bubbles:true})); arguments[0].dispatchEvent(new Event('change',{bubbles:true}));",
      startsAt
    );
    await enter(driver, '#event-form input[name="location"]', 'Selenium Test Hall');
    await enter(driver, '#event-form input[name="capacity"]', '20');
    await driver.findElement(By.css('#event-form button[type="submit"]')).click();
    await driver.wait(async () => (await driver.findElement(By.id('notice')).getText()).includes(newTitle), TIMEOUT_MS);
    t.diagnostic('Administrator published a new event.');
    assert.ok((await driver.findElement(By.id('admin-event-list')).getText()).includes(newTitle));

    const participantsButton = await driver.wait(until.elementLocated(By.css('#admin-event-list [data-participants-event]')), TIMEOUT_MS);
    await participantsButton.click();
    await waitVisible(driver, '#participant-panel');
    t.diagnostic('Participant panel opened.');
    const participantText = await driver.findElement(By.id('participant-list')).getText();
    assert.ok(participantText.includes('Workshop Participant'));
    assert.ok(participantText.includes(studentEmail));
    assert.ok((await driver.findElement(By.id('participant-title')).getText()).includes(eventTitle));
  });
});
