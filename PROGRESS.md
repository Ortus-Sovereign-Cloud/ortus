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
| 1.9 Audit events (base; the hash chain is slice 2) | Done | ortus-core 9164676 | Hash chain already (head row serialises writers); verify(); admin API list/verify; chain survives backup/restore |
| 1.10 OpenID Connect provider (code + PKCE, ES256 ID tokens, discovery, JWKS) | Done | ortus-core 9ccf487 | Admin-registered clients; PKCE S256 always; key made once in DB (stored unencrypted in the database: note for slice 2 key handling) |
| 1.11 Broker to outside OpenID Connect providers, tested against a test IdP in CI | Done | ortus-core 51a0e50 | RS256/ES256 ID token checks; link by verified email / create accounts per provider; mock-oauth2-server in CI (test only) |
| 1.12 Broker to outside SAML providers | Done | ortus-core 82c019f | Narrow SP-initiated SAML (DECISIONS); bergshamra-c14n; real IdP fixture + 8 attack mutations + live SimpleSAMLphp test; also fixed: OIDC broker login CSRF (trip cookie) and password-alone confirmation (core 0b947c6) |
| 1.13 Admin: first run checklist (AdminFirstRun) | Done | ortus-core db485b0 | Six steps from real state (recovery kit, HTTPS address, people, sign-in policy, data place confirmed, backup checked by `ortus check-backup`); installation facts without secrets; second-owner nudge |
| 1.14 Admin: users and groups, invite, CSV and directory import, quotas (AdminUsers) | Done | ortus-core 840055d, c69173e | Invitations by mail (7 days, once), CSV import with per-line report, roles (never above one's own, last owner kept), suspend, quotas, reset sign-in, devices; LDAP/AD directory sync tested against a real OpenLDAP (test only) |
| 1.15 Admin: sign-in policy and devices (AdminSignIn) | Done | ortus-core 5402a86 | Passwords (always with app code) on/off, session idle and maximum days; off is refused while someone depends on a password; board's QR / smart card rows map to passkeys and organisation sign-in (DECISIONS) |
| 1.16 Welcome page and personal settings (WebWelcome, WebPersonal) | Done | ortus-core c6710fd | Invitation link page, first-day steps from real state, people from one's groups, app cards; settings: devices, language, text size, motion, name |
| 1.17 Story tests S2.1 and S2.3; passkey sign-in in the browser (virtual authenticator) | Done | ortus (this commit) | Both shapes; S2.1 creates the owner, saves the kit, adds a passkey, signs out and back in with it, works the checklist; S2.3 connects a test OpenLDAP and syncs people and groups; core pinned to eb066fd |
| 1.18 First demo deploy at ortus.cc | Done | ortus f87ca40 | Live 2026-11-20: website, open sign-up (codes DKIM-signed as ortus.cc), passkeys; brought forward before 1.10–1.17 (DECISIONS); redeploys after each green ortus CI |
| 1.19 Slice review by a separate reviewer; Gate A | Done | ortus-core e65a587 | Gate A passed 2026-11-20 (review below) |

Slice 1 review (separate reviewer, 2026-11-20): no role bypass or direct account takeover; 4 medium and 11 low findings, all fixed in ortus-core e65a587 with tests: open redirect through a tab in `?return=` (server and client now share one check); sign-up resends uncapped and the code's try counter racy (mails counted per address and network, tries taken in one conditional statement); sign-up before the first owner (closed until an owner exists; only an owner ends setup); sign-in tries racy (taken atomically up front); admin edge cases (validate before writing, invited stays invited after a suspension, owners' devices hidden from admins, last owner cannot reset, reset removes outside links, links answered when no mail is configured); suspended accounts' OIDC tokens; linking by email to unverified sign-ups; prefix-matched addresses (now parsed); the directory's kept password; leftovers in the expiry sweep. Gate A: passed.

## Slice 2: Policy and audit

Done when a label blocks a forbidden share and the attempt is in the audit log; S2.8 passes.

| Task | State | Commit | Notes |
| --- | --- | --- | --- |
| 2.1 Classification labels: ordered labels with rules (outside sharing, links, federation, phones, forwarding, watermark); defaults PUBLIC, INTERNAL, OFFICIAL-SENSITIVE, SECRET; owner edits them | Done | ortus-core b466d00 | Four default labels; owner edits; unknown label = strictest |
| 2.2 One policy function: `policy::decide(action, actor, label, audience)` answers allow, deny or allow-with-reason; every deny and every overridden warning goes to the audit log; apps reach it through `Services` | Done | ortus-core b466d00 | decide/judge; refusals and reasoned overrides audited; `/policy/check` for clients |
| 2.3 Federation allow-list: partner organisations by domain, with what they may do (mail, chat, full); used by the policy function | Done | ortus-core b466d00 | Partners by domain (subdomains included) and channel |
| 2.4 Retention per kind (mail, chat, recordings, files, deleted items) and legal hold (people or channels, with a case reference); apps ask `policy::keep_until` and `policy::on_hold`; a sweep job interface | Done | ortus-core ab41deb | Periods per kind, holds on people and channels, `App::purge` daily sweep, held people's accounts kept |
| 2.5 Secrets at rest: a master key (file or environment) encrypts stored secrets (OIDC signing key, provider and directory passwords) with AES-256-GCM; `ortus rotate-keys`; key facts for the screen | Done | ortus-core 088a1ba, ortus-deploy 76d3f99 | OIDC key, provider/directory passwords, TOTP sealed; key file or env; rotate-keys; restore names the key; chart keeps one key for all pods |
| 2.6 Data location facts and the outbound-calls check (nothing reaches a third-party cloud unless configured) | Done | ortus-core f054037 | Every outbound call noted with purpose; unconfigured hosts flagged; compliance report with audit verified |
| 2.7 Admin › Sovereignty & compliance screen (AdminSovereignty) and the compliance report export | Done | ortus-core 2ae80d3 | Matches the board; owner edits partners, labels, periods, holds; report download |
| 2.8 Story test S2.8; the slice's done-when test (a label blocks a share, the attempt is audited) in Rust and the browser | Done | ortus (this commit), ortus-core b466d00 | S2.8 in both shapes (partner, retention, audit checked); done-when in Rust on both engines (SECRET share refused and audited); its browser half comes with Drive's share dialog (5.x) |
| 2.9 Slice review by a separate reviewer | Done | ortus-core 95c4d28, ortus-deploy 4e590d3 | Review below |

Slice 2 review (separate reviewer, 2026-11-20): 1 high, 2 medium, 2 low-medium findings, all fixed in ortus-core 95c4d28 with tests: an authenticator secret that failed to open (a process left on an older key after a rotation) became an empty HMAC key whose codes anyone could compute (high; now refuses, empty secrets never match; the directory password likewise no longer becomes an anonymous bind); an unknown or deleted label was judged by the highest-ranked label (now by all-deny rules); the secrets check value was not re-sealed at start (now it is); account deletion ignored holds on channels (apps now get the rules); an override could pass unaudited (now refused if it cannot be recorded). Smaller: one address only in policy domains; key file permissions over a leftover temp file; rotation instructions in the chart. Left as a note: the compliance report (a GET) records an audit event and the last check; harmless. Slice 2 done.

## Slice 3: Mail

Done when mail goes to and from an outside server in CI, an IMAP app works, and S2.2, S2.4 and S2.9 pass. The app lives in ortus-mail; protocol parsing uses permissive crates (checked per crate) and our own server code.

| Task | State | Commit | Notes |
| --- | --- | --- | --- |
| 3.0 App screens: the core serves each app's built web client under `/assets/apps/<id>/`, publishes a shared kit (`/assets/kit.js`: Lit, styles, API, translations) so apps share one Lit and one look, the shell loads an app's module when its path opens, app catalogs join the six languages; app repos get a web build and a browser-test harness | Done | ortus-core 7c0295d, 2f86032; ortus-mail 56ed1b6 | Kit at /assets/kit.js, app web files, shell loading, app catalogs, admin sections; app repos build and browser-test their web clients |
| 3.1 Mail store: domains, addresses and aliases, mailboxes per person, messages (raw in the file store, metadata and threads in the database), flags, UIDs and modification sequences for IMAP, quota use | Done | ortus-mail 3674684 | Mailboxes with IMAP numbers, raw in files, summaries and threads in the DB, retention and forgetting; both shapes |
| 3.2 Domains: add a domain, generate its records (MX, SPF, DKIM, DMARC, MTA-STS, autoconfig), check them on a schedule through a configurable resolver; Admin › Domains (AdminDomains); S2.2 | Done | ortus-mail fde953f, 082dd05; ortus (S2.2) | DKIM keys sealed; records and checks via a configurable resolver; AdminDomains screen; S2.2 in the stories |
| 3.3 Receiving: SMTP on the mail role, STARTTLS, recipient and size checks, SPF/DKIM/DMARC verdicts recorded, delivery into the store | Done | ortus-mail 205f355 | SMTP with STARTTLS, SPF/DKIM/DMARC verdicts, reject/quarantine; tested over TCP and TLS |
| 3.4 Sending: submission with app passwords, the outbound queue (MX lookup, retries, bounces), DKIM signing, TLS; the label policy decides before anything leaves | Done | ortus-mail 0de3b52; ortus-core 47bc59d | Policy before sending, DKIM signing, local delivery, outbound jobs outside the transaction, retries and bounces; installation-to-installation test |
| 3.5 Basic spam filter: authentication verdicts, header and content rules, a junk folder, people's junk/not-junk corrections | Done | ortus-mail e57a911, dbc51be | Scores with reasons in X-Ortus-Spam; Junk at 5; per-person corrections by sender |
| 3.6 App passwords in personal settings (for IMAP and submission) | Done | ortus-core 0a67e11; ortus-mail 3fdb736 | Settings card in six languages; limits per address; submission on 587/465 with AUTH only over TLS |
| 3.7 IMAP server (the subset real apps use: LOGIN/AUTHENTICATE PLAIN, LIST, SELECT, FETCH, STORE, SEARCH, UID, COPY/MOVE, APPEND, EXPUNGE, IDLE); tested with a real IMAP client | Done | ortus-mail ae087cc | Own parser; 993 TLS, 143 STARTTLS, no password in the clear; Python imaplib client on both shapes |
| 3.8 JMAP (Core and Mail: session, Mailbox, Email, Thread, EmailSubmission, push) | Done | ortus-mail 115caf2; ortus-core fdcf607 | Access::Header in core; result references, upload/download, import, push over SSE; both shapes |
| 3.9 Web inbox and reading (threads, folders, search in mail) | Done | ortus-mail 8732228 | Board Main at 1440×900 (folders, labels, Important/Other/Feeds, catch-up, threads, attachments, quick reply, live via SSE); six languages, RTL |
| 3.10 Compose (WebCompose): recipients with suggestions, attachments, drafts, send later, undo send, policy warnings with a reason; Snoozed and Scheduled folders of the Main board | Done | ortus-mail 8cc5507 | Board WebCompose; policy asked without recording, again when sending; undo = 10 s scheduled send; snooze job; six languages |
| 3.11 Deliverability (AdminDeliverability): sent, delivered, bounced, queue; DMARC aggregate reports received and read; S2.9 | Done | ortus-mail 9deafcd; ortus fd2d9b9 (S2.9) | Reports by mail at dmarc-reports@ (gzip/zip/XML, size-capped); by provider and day; who sends as our domains; S2.9 in both shapes |
| 3.12 Mailbox import from an old server over IMAP (Admin › Migrations), failures listed and retried; the web half of S2.4 | Done | ortus-mail f2c71fb; ortus-core 48bc3d8 | Resumable per-account jobs over TLS; retry with a new password or by the owner (reconnect page, note in their inbox); key rotation now re-seals app secrets |
| 3.13 CI: an outside mail server (container) exchanging mail both ways, with test DNS | Next | | |
| 3.14 Slice review by a separate reviewer | | | |

## Slice 4: Calendar and contacts

Done when an invitation makes a round trip with an outside server and a CalDAV app works. The app lives in ortus-calendar; iCalendar and vCard parsing and recurrence use calcard-next (the maintained fork of Stalwart's calcard, on jiff; Apache-2.0 OR MIT); the DAV servers and scheduling are our own.

| Task | State | Commit | Notes |
| --- | --- | --- | --- |
| 4.0 Calendar store: calendars per person, events kept as iCalendar (UID, recurrence, exceptions, attendees, alarms), ETags and sync tokens, expansion of recurring events into a time range; both shapes | Done | ortus-calendar 69ab781 | calcard-next (jiff) for parsing and recurrence; sync changes per calendar; web client and browser tests in the repo |
| 4.1 Contacts store: address books per person (vCard), plus the installation's people as a read-only directory; both shapes | | | |
| 4.2 CalDAV (RFC 4791, 6578): discovery (/.well-known/caldav, principal, home set), PROPFIND, calendar-query and multiget REPORTs, sync-collection, PUT/DELETE with ETags, MKCALENDAR; app passwords; tested with a real CalDAV client | | | |
| 4.3 CardDAV (RFC 6352): discovery, address books, addressbook-query and multiget, sync, PUT/DELETE; tested with a real client | | | |
| 4.4 Scheduling: invitations to colleagues straight into their calendars; to outside people by mail (iTIP/iMIP REQUEST, CANCEL), replies read from incoming mail (REPLY); incoming invitations shown in mail with Accept, Maybe, Decline, Propose; the label policy decides before an invitation leaves | | | |
| 4.5 Free and busy: who is free when, for colleagues (respecting private events), the "Times that work" card in Compose and in the calendar | | | |
| 4.6 Web calendar (WebCalendar): week view, creating and editing events, attendees with their free/busy, recurrence, RSVP; six languages | | | |
| 4.7 Web contacts (WebContacts): the directory and one's own contacts, editing; six languages | | | |
| 4.8 Mail and calendar together: the agenda column of the Main board, the invite card in a thread, the catch-up card counting invites | | | |
| 4.9 CI: an invitation round trip with the outside server (Postfix), and a CalDAV app syncing | | | |
| 4.10 Slice review by a separate reviewer | | | |

## Slices 5 to 13

Not started. Break each into tasks when it begins.
