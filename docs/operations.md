# Operations

## Local run

Use Node.js 22.23.2 and the committed npm lockfile. Bootstrap the first administrator with `ADMIN_USERNAME` and `ADMIN_PASSWORD` set only in the shell, then run `npm run seed`. The admin email becomes `<ADMIN_USERNAME>@admin.local` unless you adjust the seed procedure. Set `SEED_DEMO=true` only when you want labelled synthetic events. Start with `npm start`; the default host port is 3001 and the default database is `data/events.sqlite`.

The server keeps sessions in memory, so restarting it signs users out. Account passwords are stored as salted scrypt hashes. Session cookies are HttpOnly and SameSite=Lax; set `COOKIE_SECURE=true` behind HTTPS. Write actions require a session CSRF token.

## Docker Compose

Build and start the application:

```powershell
docker compose build
docker compose up -d
```

Create the first admin and optional demo events while using the same named volume:

```powershell
$env:ADMIN_USERNAME = 'event-admin'
$secure = Read-Host 'Admin password' -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
$env:SEED_DEMO = 'true'
docker compose run --rm -e ADMIN_USERNAME -e ADMIN_PASSWORD -e SEED_DEMO event-registration node scripts/seed.js
Remove-Item Env:ADMIN_USERNAME, Env:ADMIN_PASSWORD, Env:SEED_DEMO
```

The app is at `http://localhost:3001`. The database volume is `event-data`; do not remove it with `docker compose down -v` while records must be retained. Export backups outside the volume and verify them before recovery.

## Kubernetes

Build and load an immutable image into an isolated local cluster. Create a dedicated namespace, then apply `k8s/event-registration.yaml` with an explicit context and namespace. The manifest uses one replica, `Recreate`, a PVC, non-root UID/GID 1000, and health probes.

For first-time administrator bootstrap, keep the app stopped so the ReadWriteOnce claim has one writer:

1. Scale `deployment/event-registration` to zero and wait for its Pod to terminate.
2. Create `event-registration-admin` from protected local files with keys `username` and `password`. Use no trailing newline in either file.
3. Apply `k8s/bootstrap-job.yaml`, wait for it to complete, and delete the Job and Secret.
4. Scale the Deployment back to one and wait for rollout.
5. Port-forward `service/event-registration` locally and sign in.

Every `kubectl` command must include the intended `--context` and `-n` flags. Do not put passwords in command arguments, manifests, screenshots, or build logs. Delete bootstrap files after use. For restore, use a separate PVC and never overwrite the only database copy.

## Jenkins

The Jenkins pipeline runs `npm ci`, executes the HTTP integration and Selenium browser suites, builds an image tagged with the source revision and build number, and optionally applies the Kubernetes manifest when both `TEST_KUBE_CONTEXT` and `TEST_NAMESPACE` are supplied. The Linux Jenkins agent needs Chrome or Chromium for Selenium. For kind, set `KIND_NODE` to load the image locally. Use an isolated namespace and dedicated test account; this sample pipeline does not publish to a registry.

## Selenium browser tests

Run `npm ci`, `npm test`, and `npm run test:selenium` from the project folder. The Selenium suite starts the Express app on a temporary local port, creates a new temporary SQLite database for each test, and opens Chrome in headless mode. It does not use or modify the Compose database or a real administrator account. Set `CHROME_BIN` only if Chrome is installed at a non-standard path.

## Persistence and scaling

SQLite and its WAL files are stored at `DB_PATH`; mount persistent storage at `/data` in containers. This app intentionally uses one writer and one replica. Use a consistent SQLite online backup and restore into a separate directory or PVC before recovery. Verify integrity and representative accounts/events/registrations against an independent baseline.
