# Acceptance

The test identifiers below match the attached project brief. Automated HTTP integration checks are implemented in `tests/backend.test.js`; outcomes are updated after each verified run.

| Test ID | Test case | Expected result | Status |
|---|---|---|---|
| TC01 | Open registration page | Page loads with event listing and account forms | Passed — HTTP integration |
| TC02 | Register with valid details | Account is created and signed in | Passed — HTTP integration |
| TC03 | Submit an empty form | Required-field validation is returned | Passed — HTTP integration |
| TC04 | Enter an invalid email | Email validation message is returned | Passed — HTTP integration |
| TC05 | Register with a duplicate email | Duplicate account is rejected | Passed — HTTP integration |
| TC06 | Log in with valid credentials | Student session and dashboard data load | Passed — HTTP integration |
| TC07 | View registered events | Correct event appears in the student's registrations | Passed — HTTP integration |
| TC08 | View registered participants | Admin sees participant names and emails for an event | Passed — HTTP integration |
| TC09 | Repeat event registration | Duplicate registration is rejected | Passed — HTTP integration |
| TC10 | Register after event capacity is reached | Full event rejects further registrations | Passed — HTTP integration |
| TC11 | Create a future event as administrator | New event appears in the public listing | Passed — HTTP integration |
| TC12 | Attempt student registration as administrator | Request is denied | Passed — HTTP integration |

Admin routes require an administrator role. Student routes require a student role. Email uniqueness is case-insensitive. Event capacity and duplicate registration are checked inside a SQLite write transaction.

The passing results above come from the Node HTTP integration suite.

## Selenium browser cases

Run these checks with `npm run test:selenium`. They use headless Chrome and a fresh temporary SQLite database for each case.

| Test ID | Browser test | Expected result | Status |
|---|---|---|---|
| S01 | Open the page and display available events | Page and synthetic event appear | Passed — Selenium / Chrome |
| S02 | Submit empty fields and an invalid email | Browser rejects the form values | Passed — Selenium / Chrome |
| S03 | Create a student account and register for an event | Confirmation and registration history appear; student can sign in again | Passed — Selenium / Chrome |
| S04 | Create a second account using a duplicate email | The page shows a duplicate-email error | Passed — Selenium / Chrome |
| S05 | Sign in as administrator, create an event, and view participants | Event is published and the participant name/email are shown | Passed — Selenium / Chrome |

These browser tests are separate from TC01–TC12. The Selenium suite passed 5/5 on 2026-11-07 using Windows, Node.js v22.23.2, and Chrome 156.0.8078.80. Backend TC01–TC12 and the browser cases were run separately.
