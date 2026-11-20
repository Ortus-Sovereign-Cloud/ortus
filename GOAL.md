# Building Ortus V1: instructions for the build agent

You are building Ortus V1 on your own, task after task, without stopping to ask. Every decision the owner has made is below. When you meet a choice that is not covered, take the safest reversible option, write it to `DECISIONS.md` with the reason, and keep going. When a task needs something only the owner can provide, build and test it with a stand-in, add it to `OWNER-NEEDED.md`, and keep going.

Read this file, `PROGRESS.md`, `DECISIONS.md` and `OWNER-NEEDED.md` at the start and again after every context compaction. `PROGRESS.md` tells you where you are. The build machine also has private instructions for the agent; they take precedence over this file.

## Sources

| What | Where |
| --- | --- |
| Every screen to build | `ortus-brand/design/` (boards, screenshots, `DENSITY_RULES.md`); the V1 list is in `design/README.md` |
| User stories S1 to S4, step by step | `ortus-brand/design/tools/generators/story.py` and `ortus-brand/design/stories/` |
| Code | the 14 repositories in https://github.com/Ortus-Sovereign-Cloud |
| Where the work stands | `PROGRESS.md` in this repository |

## Decisions already made

- **Scope:** the whole V1 in one public release: the 41 boards tagged V1, the story steps on them, native iOS and Android apps, and four features that must really work: classification labels, records and retention, eID sign-in (generic OpenID Connect and SAML broker), and federation (Matrix-compatible chat).
- **Licence:** every repository is MIT OR Apache-2.0. Dependencies that ship must be permissive (MIT, Apache-2.0, BSD, ISC and similar). No GPL, AGPL, LGPL or MPL in shipped code; fonts may carry the SIL Open Font License. Test-only tools in CI (a Matrix server to federate with, a mail server to send to, an identity provider) may have any licence, because they never ship.
- **Shape:** one Rust program on rws that holds every service, plus a Kubernetes chart running the same program by role (web, mail, media, worker). Apps also ship alone: `ortus-mail` (mail, calendar, contacts), `ortus-drive` (drive, docs), `ortus-chat` (chat, calls). Every app has an on and off switch; apps depend only on `ortus-core`, never on each other.
- **Data:** SQLite in the one-machine program, PostgreSQL in the chart (CloudNativePG bundled, or external by setting). Files in a local directory or S3 (RustFS bundled, or external).
- **Server interfaces:** async underneath, with blocking wrappers.
- **Web client:** TypeScript, Lit and lit-material, built by Vite and embedded in the program. Dark theme only.
- **Languages:** English, Polish, Ukrainian, German, French and Arabic, right to left for Arabic. Every new piece of interface text goes into all six catalogs; logical CSS properties only.
- **Editor:** Tiptap with Yjs; own document format with basic Word import and export.
- **Calls:** own media server in the program, small calls first (up to 12 people).
- **Encryption:** server-side by default; an admin may allow end-to-end rooms, which are then excluded from search, records and legal hold.
- **Signing in V1:** with certificates the organisation issues. Qualified eID signatures come after V1.
- **Phones:** native Swift and Kotlin on the public API. iOS builds and tests on GitHub's macOS runners. End-to-end rooms use hand-written bindings to vodozemac.
- **Security review:** our own, per slice (below). No outside review is planned.
- **Front page and sign-in:** an installation's root address shows the project website to visitors and the app once signed in, on the same host. The project website (what Ortus is, install guide, links) is a setting that only the public demo at ortus.cc turns on; an organisation's own installation opens on its sign-in page. The website is in the same six languages as the app.
- **After signing in:** the first time, the All apps chooser; after that, straight into the app used last, with the chooser one click away on the rail.
- **Public demo:** open sign-up for anyone, with an email check, small quotas (about 100 MB per account, no mail to outside addresses, a cap on new accounts per day and per address), accounts and their data deleted after 30 days, and a short terms and privacy page (no real or sensitive data, no guarantee, data may be wiped).
- **Ortus OS** and all V2 and Later boards start after V1.

## The plan

Work in this order. Each slice ends when its screens work on a fresh install in both shapes, its tests pass on SQLite and PostgreSQL in CI, and its story steps pass as browser tests.

| Slice | What | Done when |
| --- | --- | --- |
| 0 | Foundation. Left: 0.9 one-machine install (release build, data directory, service unit, backup and restore commands), 0.10 chart (one workload per role, CloudNativePG or external PostgreSQL, RustFS or external S3), 0.11 CI matrix and story-test harness with named steps, 0.12 app interface in the core (an app registers routes, listeners, tables, jobs and its switcher entry; a switch per app), 0.13 cross-app interfaces with a "not installed" answer, 0.14 the `ortus` repository builds the four programs from pinned app versions | An empty Ortus installs, upgrades and backs up in both shapes |
| 1 | Sign-in and admin base: the project website and the sign-in page at the root, open sign-up with an email check (for the demo), accounts and roles, first-start token, passkeys, password with one-time code and a recovery kit, sessions, OpenID Connect provider, broker to outside providers (OIDC, then SAML), audit events, admin screens (first run, users, sign-in policy), welcome and personal settings | Story steps S2.1 and S2.3 pass; a new user signs in with a passkey. **Gate A** |
| 2 | Policy and audit: labels and one policy function, hash-chained audit log, retention and legal hold, Sovereignty screen | A label blocks a forbidden share and the attempt is in the audit log |
| 3 | Mail: store, receiving with sender checks, sending with queue and signing, IMAP, JMAP, basic spam filter, Inbox and Compose, Domains and Deliverability, mailbox import | Mail to and from an outside server in CI; an IMAP app works; S2.2, S2.4 and S2.9 pass |
| 4 | Calendar and contacts: CalDAV, CardDAV, invitations by mail, free and busy | An outside invitation round trip; a CalDAV app works |
| 5 | Drive and search: files, versions, label-aware sharing, previews, search index. **Gate B** | A file is shared by label rules; search finds mail and files |
| 6 | Docs: Yjs sync server, editor, comments and suggestions, review route, Word and PDF | Two people edit one document; S1.7 and S1.8 pass |
| 7 | Tasks, approvals, signing, records, read-and-confirm | S1.5, S1.9, S1.10 and S3.7 pass; the filed PDF's signature verifies |
| 8 | Chat with Matrix federation, end-to-end rooms by policy | A room shared with an independent Matrix server in CI; S1.4 and S3.8 pass |
| 9 | Calls: signalling, audio, video, screen share, relay. **Gate C** | Twelve people in a call on the one-machine install; S1.1 to S1.10 pass in the browser |
| 10 | Notifications, backup screen and restore test, load test, own security review | S2.10 passes; no open high findings |
| 11 | iOS app: the 15 V1 phone boards | The phone steps of S1 to S3 pass in the simulator on CI |
| 12 | Android app: the same boards | The same steps pass in the emulator on CI |
| 13 | Release readiness: install guide, API reference site, dependency licence audit, signed builds. **Gate D** | Every V1 step of S1 to S3 passes on web and both phones on a fresh install |

Break each slice into tasks of a day or less before starting it, write them into `PROGRESS.md`, then work through them. Steps on V2 and Later boards (S1.11, S2.6, S2.7, S3.5, S3.9 and all of S4) are out of V1.

## Rules for every task

1. Commit straight to `main` and push.
2. Run `ci/check.sh` in the repository before every push, and push only when it prints `all checks passed`. After pushing, wait for the CI run of that commit and fix it at once if it is red.
3. Each task adds its own tests. Storage tests run on SQLite and PostgreSQL, file tests on a local directory and S3, screens in a real browser in all six languages.
4. A screen is done when it matches its board at 1440 by 900 (or 390 by 844): render the board with `ortus-brand/design/tools/render.sh`, take the same screenshot of the real screen, look at both. Keep the sample world out of the product; use it only in tests and the demo.
5. The program serves only its own paths (`web::OnlyOrtusPaths`); never weaken that or the content security policy.
6. New dependencies: check the licence in the repository's own LICENSE file first. The licence gates in CI decide.
7. After each task, update `PROGRESS.md`: task, commit, one line of notes, anything left out.
8. Before closing a slice, have a separate reviewer read the slice's changes for bugs and security holes. Fix what it confirms; note the rest in `PROGRESS.md`.
9. Owner-only items go to `OWNER-NEEDED.md` with exactly what is needed and why: a real mail domain and DNS records, Apple and Google developer accounts, an eID test provider, native speakers to check each language, anything that costs money.

## When V1 is done

V1 is done when every task of slices 0 to 13 in `PROGRESS.md` is marked Done or Owner-needed, `ci/check.sh` passes in every repository, and CI is green everywhere. Then write the gate D review into `PROGRESS.md` and say `ORTUS V1 COMPLETE` followed by the list from `OWNER-NEEDED.md`.
