# Flux local Demo / QA

This branch includes a reusable local environment for manual browser QA. It has its **own persistent PostgreSQL cluster**, fake users and example projects. It does not use production or the automated synthetic test databases.

## Launch

After installing dependencies and PostgreSQL tools once:

```sh
pnpm demo
```

Open **http://127.0.0.1:3101/sign-in**. The terminal prints all logins and direct project links. A yellow **DEMO / QA** banner identifies the app. Use a separate browser profile or private window for each user.

The first launch creates the database, applies this branch's migrations and seeds fixtures. Later launches apply new migrations and preserve your projects, passwords, notes, approvals and progress. Restart the command after pulling future changes; normal Next development hot reload is available while it runs.

## Public fake demo credentials

**Password for every account: `FluxDemo-Only!2026`**

| Account | Email | QA purpose |
| --- | --- | --- |
| Super Admin | `super-admin@flux-demo.test` | Administration and assigning Director template capability |
| Director | `director@flux-demo.test` | Template editing and Custom approval through an explicit capability; underlying role is USER |
| Project Owner | `owner@flux-demo.test` | USER with project-creation permission; owns all demo projects and manages their stages |
| Co-owner | `co-owner@flux-demo.test` | Co-owner of the structured projects; ADMIN as required by existing co-owner selection rules |
| Executor | `executor@flux-demo.test` | Assigned Packaging task through Tasker; no normal stage management |
| Collaborator | `collaborator@flux-demo.test` | Project participation and Private Project collaboration; no owner/Director authority |

These are intentionally public fake credentials, not secrets or existing company accounts. All emails use the reserved `.test` domain. Passwords are hashed through the application's normal password helper; login authentication is not bypassed.

## One-time prerequisites

- Node.js 22 or 24 and pnpm **10.34.6** (the repository's pinned version).
- PostgreSQL tools, preferably version 17: `initdb`, `pg_ctl`, `psql`.
- A regular OS user; `initdb` refuses to run as root. Windows users can use WSL.

```sh
corepack enable
corepack pnpm install --frozen-lockfile
```

On macOS, install PostgreSQL with your package manager, for example:

```sh
brew install postgresql@17
FLUX_DEMO_PG_BIN="$(brew --prefix postgresql@17)/bin" pnpm demo
```

On Linux, install PostgreSQL through the distribution's package manager. The launcher checks PATH, `pg_config --bindir` and `/usr/lib/postgresql/*/bin`. For a custom installation, set `FLUX_DEMO_PG_BIN=/absolute/path/to/postgresql/bin` for the first launch; it remembers the directory in the ignored local marker.

Do not start or reconfigure a shared PostgreSQL service for Demo Mode. The command manages a separate cluster itself. Port **55439** must be free; a conflict causes startup to fail without adopting the existing service. If HTTP port 3101 is busy, use `FLUX_DEMO_PORT=3102 pnpm demo`.

## Reset and other commands

Stop the running demo app with **Ctrl+C**, then:

```sh
pnpm demo:reset
pnpm demo
```

Reset replaces **only the `flux_demo` database in this checkout's owned local cluster**. It removes all manual QA changes, restores the six logins and recreates the initial scenarios. New project IDs are printed afterward. It does not reset production, the prior local development database or isolated automated test clusters. It refuses to run while a Demo Mode command is active, and refuses to drop a database with other active connections. No Prisma force-reset or data-loss bypass is used.

| Command | Purpose |
| --- | --- |
| `pnpm demo` | Prepare and launch the latest checkout locally |
| `pnpm demo:setup` | Prepare/seed without launching; preserves existing fixtures |
| `pnpm demo:reset` | Explicitly recreate the demo database and fixtures |
| `pnpm demo:credentials` | Print the initial fake logins without accessing any database |
| `pnpm demo:stop` | Stop the owned PostgreSQL process after exiting the app; data remains saved |
| `pnpm demo:verify` | Verify the initial demo fixture logins, counts and access; run after reset if QA changed these |
| `pnpm demo:safety-check` | Run datasource/environment/cluster-ownership guard tests without touching a database |

Database files, logs, ownership marker and project-link manifest live under **`.demo/`**, which is gitignored. They persist across normal restarts on the same machine. They are not pushed to GitHub: a fresh checkout/workspace recreates them with `pnpm demo`. If seeding was interrupted, the command refuses to overwrite partial data; use the explicit reset command. Do not point `.demo` at a symlink or move a marked cluster between checkouts.

## Seeded QA scenarios

Every title begins with `[DEMO]`; all briefs and guidance describe fictional work.

| Project | Initial workflow state | Try |
| --- | --- | --- |
| Paper Moon carton — inquiry | Packaging Stage 1 active, eight total | Inquiry autosave, contacts, locking and owner/co-owner access |
| Paper Moon carton — concept tasks | Packaging Stage 3 active | Executor's assigned concept task in Tasker; comments and completion without a file |
| Moonlight counter cards — research | POSM Stage 2 active, six total | Read previous notes and progress the active stage |
| Imaginary shop display — technical design | Retail Stage 4 active, seven total | Navigation across completed, active and locked stages |
| Fictional Expo stand — event | Exhibition Stage 7 active, eight total | Event notes and progression to wrap-up report |
| Paper Moon microsite — maintenance | Digital Maintenance active | Open-ended project with no fixed end date or completion button |
| Fictional launch cards — completed | POSM fully completed | Completed filter and read-only stage notes |
| Custom campaign — awaiting Director | Three-stage unapproved draft | Add, duplicate, reorder, rename, remove and request Director approval |
| Custom campaign — approved and active | Four stages, optional Stage 2 active | Skip with a reason; inspect structure lock and audit history |
| Private planning notes | Separate Private Project, two milestones | Notes, milestone progress and demo collaboration |

The Packaging concept scenario explicitly seeds its first two stages as complete and records a `DEMO_FIXTURE_SETUP` event. This is fake fixture setup, not a claim that business approvals occurred. Other generic stages advance through the normal services. Deadlines are relative to the seed date; reset refreshes them.

## Safety and external-service limits

- Database host, role, database and port are fixed to the owned loopback demo cluster. The runner does not accept an arbitrary database URL.
- The runner checks its ownership marker and PostgreSQL's actual `data_directory` before database mutation/reset. The app also rejects a non-demo datasource when Demo Mode is active.
- Existing production configuration and `.env` files are not modified. Child processes get a restricted environment with the demo datasource and explicit empty email, S3, AI and Ably credentials, overriding inherited/environment-file values used by those integrations.
- The app binds to **127.0.0.1**, not the LAN. Do not deploy or publicly expose this demo or reuse these public passwords.
- Real email delivery, cloud upload/download, AI and external realtime are intentionally unavailable and may display the existing “not configured” messages. No successful email/upload is fabricated. In-app database notifications, notes, tasks and progression remain usable.
- Existing synthetic seeders and fixtures continue using their own databases. Never point them at this persistent manual QA database. The Prisma client regression check additionally verifies the Demo Mode datasource guard before client creation.

## Optional real-browser verification

With `pnpm demo` running and the initial fixtures present, use an existing Playwright/Chromium installation:

```sh
PLAYWRIGHT_MODULE_PATH=/path/to/playwright-core \
CHROMIUM_PATH=/path/to/chromium \
node scripts/demo/browser-check.cjs
```

It logs in through the real sign-in form as all six accounts, checks the demo banner and role boundaries, checks the Executor assignment and Private Project, and leaves project state unchanged. No Playwright dependency is added to the application. Set `DEMO_BROWSER_URL=http://127.0.0.1:3102` if using another demo HTTP port.

## Setup validation

Validated on local PostgreSQL 17 and Node 24:

- Initial setup creates six usable logins, nine structured projects and one Private Project.
- All six accounts sign in through the actual browser form with the documented password; Director approval, owner/co-owner stages, Executor Tasker and Collaborator restrictions pass.
- Manual notes and project IDs survive repeated setup and database stop/start.
- Explicit reset recreates fixtures; the separate pre-existing test database remains unchanged.
- Reset is refused while the demo app is running. A remote inherited `DATABASE_URL` is replaced with the owned loopback datasource.
- Safety tests, demo fixture verification, existing isolated template integration, layout and Prisma-client regressions, lint, typecheck and production build pass.

No production connection, migration, configuration change or application dependency upgrade was used for this setup.
