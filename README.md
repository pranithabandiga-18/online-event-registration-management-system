# Online Event Registration and Management System

A separate Express, vanilla JavaScript, and SQLite project for campus event registration. Students can create accounts, browse events, reserve seats, and view confirmations. Administrators can publish events and review registered participants.

## Modules

- Student registration and secure login
- Public event listing
- Event registration with duplicate and capacity checks
- Student registration history and confirmation details
- Admin dashboard with event and registration totals
- Event creation and participant lists

## Run locally on Windows

Use Node.js **22.23.2** and npm. From this folder:

```powershell
npm ci
$env:ADMIN_USERNAME = 'event-admin'
$secure = Read-Host 'Admin password (12 characters minimum)' -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
$env:SEED_DEMO = 'true'
npm run seed
Remove-Item Env:ADMIN_USERNAME, Env:ADMIN_PASSWORD, Env:SEED_DEMO
npm start
```

Open [http://localhost:3001](http://localhost:3001). The seeded admin login email is `event-admin@admin.local`; use the password entered above. The seed command creates two labelled synthetic events. Student accounts are created from the registration page.

The local SQLite database defaults to `data/events.sqlite`. Set `DB_PATH` to a different path before starting if you want to keep it elsewhere. No default administrator password is built into the application.

## Tests

```powershell
npm test
```

The Node integration suite covers the seven test cases from the project brief plus the admin participant dashboard, duplicate event registration, and capacity enforcement. See [docs/acceptance.md](docs/acceptance.md).

## Docker, Kubernetes, and Jenkins

- `Dockerfile` builds a non-root image; `compose.yaml` stores SQLite in a named volume and publishes port 3001 by default.
- `k8s/event-registration.yaml` defines a one-replica `Recreate` Deployment, PVC, health probes, and ClusterIP Service.
- `k8s/bootstrap-job.yaml` initializes the admin while the Deployment is stopped.
- `Jenkinsfile` installs dependencies, runs the test suite, builds a commit-tagged image, and can deploy to an explicitly supplied isolated context and namespace.

Operational steps and security notes are in [docs/operations.md](docs/operations.md). SQLite is a single-writer demonstration store; keep one app replica and back up the database outside its volume.
