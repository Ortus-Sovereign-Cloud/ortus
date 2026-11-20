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
| 0.9 One-machine install | Next | | |
| 0.10 Chart | | | |
| 0.11 CI matrix and story harness | | | |
| 0.12 App interface | | | |
| 0.13 Cross-app interfaces | | | |
| 0.14 Four programs from pinned versions | | | |

## Slice 1: Sign-in and admin base

Not started; break it into tasks when it begins. It must include, besides the plan in `GOAL.md`:

- The project website at the root (a setting that only the public demo turns on), in six languages, with a Sign in link.
- The sign-in and sign-up pages, open sign-up with an email check, the demo limits from `GOAL.md` (quotas, account cap, 30-day expiry) and the terms and privacy page.
- After sign-in: the app chooser the first time, then the last app used.

## Slices 2 to 13

Not started. Break each into tasks when it begins.
