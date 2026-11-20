# Ortus V1 progress

Newest work at the bottom of each slice. Status is Done, In progress, Next or Owner-needed.

## Slice 0: Foundation

| Task | Status | Commit | Notes |
| --- | --- | --- | --- |
| 0.1 Core crate on rws, health check | Done | ortus-core 05d0c2b | `/api/v1/health` |
| 0.2 Licence gate and CI | Done | ortus-core 1e71c90 | cargo-deny allow list; self-test proves MPL is refused |
| 0.3 Storage interface, SQLite and PostgreSQL, migrations | Done | ortus-core a333fa2 | 16 tests on both engines |
| 0.4 File interface, local and S3 | Done | ortus-core 142dae0 | Files are read and written whole; streaming is still to do before slice 5 |
| 0.5 Job table and worker | Done | ortus-core 51277c6 | Exactly once for database writes only; outside effects must be safe to repeat |
| 0.5b Async interfaces with blocking wrappers | Done | ortus-core 2bc92f5 | One process-wide I/O runtime |
| 0.6 Configuration and roles | Done | ortus-core 9e48ee3 | Mail and media roles open nothing yet |
| 0.7 Public API skeleton | Done | ortus-core 363321d, 7227206 | `api/openapi.json` is generated; a test fails when stale |
| 0.8 Web shell, six languages, right to left | Done | ortus-core 3ec3985 | 18 browser tests; design match checked by eye only; translations need native readers; PostgreSQL has no TLS yet |
| 0.9 One-machine install | Done | ortus-core ffa2d1f, ortus 865b259 | `ortus serve/backup/check-backup/restore/version`; engine-independent backups (SQLite+dir ↔ PostgreSQL+S3); hardened systemd unit, daily backup timer, upgrade with backup and rollback; CI installs for real. One local test run used sudo here by mistake before the real install was gated to CI; it removed everything it made |
| 0.10 Chart | Done | ortus-deploy 979fa35 | Chart written; k3d test found and fixed two real bugs (service-link env vars clobbering ORTUS_WEB_PORT; no CA store in the scratch image → S3 client panic, core 5c17c28) |
| 0.11 CI matrix and story harness | Done | ortus e0e49c3 | `stories/` Playwright harness; steps.json from story.py (24 V1 steps; S1.1 and S3.3–4 kept with web stand-ins); every story runs on a fresh install of the release program; CI matrix one-machine × cluster |
| 0.12 App interface | Done | ortus-core 0ca5eee | `App` trait: switcher entry, migrations, routes under /api/v1/<id>, job kinds, role tasks, services; per-app switch (config default, DB wins); off = gone from switcher, API `not_installed`, jobs wait, tasks not started |
| 0.13 Cross-app interfaces | Done | ortus-core 0ca5eee | `Services` by trait with `NotInstalled`; first traits Calendar, Contacts, Drive, Chat, Tasks (grow per slice); web not-installed screen in six languages |
| 0.14 Four programs from pinned versions | Done | ortus ceaa1a5; app repos 9e9876e (mail) 83ca5bf (calendar) e3e6e70 (drive) c48a718 (docs) fa47c32 (chat) 2cf342f (calls) 945fd0a (tasks) | ortus, ortus-mail, ortus-drive, ortus-chat; every app repo is a crate with ci/check.sh and CI |

Slice 0 review (separate reviewer, 2026-11-20): 15 findings; fixed in ortus-core 9c49c23, ortus-deploy dce3e7a and ortus (install.sh): job claim starvation (high), nested-transaction hang now fails after 30 s (high, documented rule for handlers), commit after a failed statement, PostgreSQL TLS (sslmode), backup partial pruning and skipped files, install backup before replacing the program, chart startup allowance, GitOps secret, backup sizing, deferred foreign keys on restore, worker error logging, secrets out of Debug. Left as notes: backups and files are read whole into memory (streaming before slice 5); SQLite decimal values become text in backups; `helm rollback` after a migration needs a restore (documented).

## Slice 1: Sign-in and admin base

Boards: AdminFirstRun, AdminUsers, AdminSignIn, WebWelcome, WebPersonal, AppSwitcher (and the sign-in pages, which have no board: built in the same style). Story steps S2.1, S2.3 (and S3.1, S3.6 groundwork). Gate A: S2.1 and S2.3 pass; a new user signs in with a passkey.

| Task | Status | Commit | Notes |
| --- | --- | --- | --- |
| 1.1 Accounts, roles and sessions: tables, session cookie, CSRF, `/api/v1/me`, auth on every API route | Done | ortus-core 52442e5 | Token hash only in DB; __Host- cookie over HTTPS; X-Requested-With: ortus on every change; `public_url` setting |
| 1.2 First-start token and the owner account (setup link in the log) | Done | ortus-core 52442e5 | Printed once; `ortus setup-link` for a new one; ORTUS_SETUP_TOKEN for automation |
| 1.3 Password with one-time code (TOTP) and a recovery kit | Done | ortus-core ed2f606 | Argon2id; password always needs the code until the sign-in policy (1.15) can relax it; attempt limits per address and IP |
| 1.4 Passkeys (own WebAuthn: ES256, EdDSA, RS256; no MPL webauthn-rs) | Done | ortus-core f43d0ed | aws-lc-rs signatures, own CBOR reader; discoverable passkeys, user verification required; Chrome virtual-authenticator test |
| 1.5 Sign-in and sign-up pages; open sign-up with an email check; outgoing mail for codes | Done | ortus-core 75e5136 | lettre SMTP via job queue; code in six languages; no account enumeration; Mailpit in CI (test only) |
| 1.6 Demo limits: quotas, no outside mail, account caps, 30-day expiry job, terms and privacy page | Done | ortus-core 75e5136 | caps per day/address; hourly expiry with App::forget_user; quota stored on account (enforced by drive, slice 5); 'no outside mail' is enforced by the mail app (slice 3) |
| 1.7 Project website at the root (setting), six languages, Sign in link | Done | ortus-core d645651 | [site] website; GET /api/v1/session for visitors |
| 1.8 After sign-in: app chooser the first time, then the last app used | Done | ortus-core f03c977 | PUT /api/v1/me/place |
| 1.9 Audit events (base; the hash chain is slice 2) | Next | | |
| 1.10 OpenID Connect provider (code + PKCE, ES256 ID tokens, discovery, JWKS) | | | |
| 1.11 Broker to outside OpenID Connect providers, tested against a test IdP in CI | | | |
| 1.12 Broker to outside SAML providers | | | |
| 1.13 Admin: first run checklist (AdminFirstRun) | | | |
| 1.14 Admin: users and groups, invite, CSV and directory import, quotas (AdminUsers) | | | |
| 1.15 Admin: sign-in policy and devices (AdminSignIn) | | | |
| 1.16 Welcome page and personal settings (WebWelcome, WebPersonal) | | | |
| 1.17 Story tests S2.1 and S2.3; passkey sign-in in the browser (virtual authenticator) | | | |
| 1.18 First demo deploy at ortus.cc | | | |
| 1.19 Slice review by a separate reviewer; Gate A | | | |

## Slices 2 to 13

Not started. Break each into tasks when it begins.
