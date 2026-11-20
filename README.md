# ortus

Ortus programs: the all-in-one build, the single-app bundles and the story tests.

Part of Ortus, a sovereign workspace for organisations and governments: mail, calendar, files, documents, chat, calls, tasks and approvals that an organisation runs itself.

Status: early development, not ready for use.

## Building

```sh
ci/fetch.sh               # the pinned parts (pins.toml) under .deps/, with their web clients
cargo build --release     # target/release/ortus
```

`ci/check.sh` runs every check CI runs.

## Installing on one machine

On Linux with systemd, as root:

```sh
sudo install/install.sh target/release/ortus
```

This creates the system user `ortus`, keeps all data in `/var/lib/ortus` (SQLite and a files directory), writes the settings to `/etc/ortus/ortus.toml` (only the first time) and starts `ortus.service`, listening on 127.0.0.1:7878. Put a TLS reverse proxy in front of it. Secrets such as a database password go in `/etc/ortus/ortus.env`.

- **Upgrade:** run `install.sh` again with the new program. It takes a backup first, keeps the old program as `/usr/local/bin/ortus.previous`, and puts it back when the new one does not come up.
- **Backups:** `ortus-backup.timer` writes one every night to `/var/lib/ortus/backups` and keeps seven. Copy them off the machine. By hand: `sudo -u ortus ORTUS_CONFIG=/etc/ortus/ortus.toml ortus backup <new directory>`.
- **Restore:** stop Ortus, move `/var/lib/ortus` aside, create it again empty (owned by `ortus`, mode 0750), then `sudo -u ortus ORTUS_CONFIG=/etc/ortus/ortus.toml ortus restore <backup>` and start Ortus. `ortus check-backup <backup>` checks a backup without restoring it. A backup restores into either shape: one machine or the Kubernetes chart.

## Story tests

`stories/` holds the user stories of the design as browser tests against the release program. `steps.json` lists every step (`stories/tools/import-steps.py` copies them from the design); a spec proves a step with `step("S2.1", async ({ page, ortus }) => ...)` inside `story(...)`, and each story runs its steps in order on one fresh installation.

```sh
cd stories && npm ci
ORTUS_STORY_SHAPE=one-machine npx playwright test   # SQLite and a directory
ORTUS_STORY_SHAPE=cluster npx playwright test       # PostgreSQL and S3 (ORTUS_TEST_POSTGRES, ORTUS_TEST_S3_*)
node tools/coverage.mjs                             # which V1 steps pass; --strict fails unless all do
```

CI runs everything in both shapes.

## Licence

Licensed under either of the Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE)) or the MIT license ([LICENSE-MIT](LICENSE-MIT)), at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this work, as defined in the Apache-2.0 licence, shall be dual licensed as above, without any additional terms or conditions.
