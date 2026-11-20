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
| 0.10 Chart | In progress | ortus-deploy (not pushed yet) | Chart written; k3d test found and fixed two real bugs (service-link env vars clobbering ORTUS_WEB_PORT; no CA store in the scratch image → S3 client panic, core 5c17c28) |
| 0.11 CI matrix and story harness | Done | ortus e0e49c3 | `stories/` Playwright harness; steps.json from story.py (24 V1 steps; S1.1 and S3.3–4 kept with web stand-ins); every story runs on a fresh install of the release program; CI matrix one-machine × cluster |
| 0.12 App interface | Done | ortus-core 0ca5eee | `App` trait: switcher entry, migrations, routes under /api/v1/<id>, job kinds, role tasks, services; per-app switch (config default, DB wins); off = gone from switcher, API `not_installed`, jobs wait, tasks not started |
| 0.13 Cross-app interfaces | Done | ortus-core 0ca5eee | `Services` by trait with `NotInstalled`; first traits Calendar, Contacts, Drive, Chat, Tasks (grow per slice); web not-installed screen in six languages |
| 0.14 Four programs from pinned versions | Done | ortus ceaa1a5; app repos 9e9876e (mail) 83ca5bf (calendar) e3e6e70 (drive) c48a718 (docs) fa47c32 (chat) 2cf342f (calls) 945fd0a (tasks) | ortus, ortus-mail, ortus-drive, ortus-chat; every app repo is a crate with ci/check.sh and CI |

## Slice 1: Sign-in and admin base

Not started; break it into tasks when it begins. It must include, besides the plan in `GOAL.md`:

- The project website at the root (a setting that only the public demo turns on), in six languages, with a Sign in link.
- The sign-in and sign-up pages, open sign-up with an email check, the demo limits from `GOAL.md` (quotas, account cap, 30-day expiry) and the terms and privacy page.
- After sign-in: the app chooser the first time, then the last app used.

## Slices 2 to 13

Not started. Break each into tasks when it begins.
