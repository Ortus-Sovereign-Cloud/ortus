# Decisions taken by the build agent

Choices the owner had not made, taken so work could continue. Each is reversible unless it says otherwise. Newest last.

| Date | Decision | Why | How to undo |
| --- | --- | --- | --- |
| 2026-11-20 | Backups are a logical, engine-independent directory (manifest with checksums, one JSONL file per table, the files), not a copy of the SQLite file or a pg_dump | One format for both shapes, and it moves an installation from one machine to the chart and back | Add an engine-native backup beside it; the command line stays |
| 2026-11-20 | The command line (`serve`, `backup`, `check-backup`, `restore`, `version`) lives in `ortus_core::cli`; each program is a thin `main` | The four programs must behave the same | Move it into the `ortus` repository |
| 2026-11-20 | The one-machine install files (systemd units, `install.sh`, backup script) live in the `ortus` repository under `install/`; the chart goes to `ortus-deploy` | The install ships with the program it installs | Move the folder |
| 2026-11-20 | The `ortus` repository builds from `pins.toml` (commit per repository) checked out under `.deps/` by `ci/fetch.sh`, as path dependencies | Built web clients are not in git, so a plain git dependency cannot build; a pin file is plain to read and change | Commit the built clients and use git dependencies |
| 2026-11-20 | The program listens on 127.0.0.1:7878 by default; a TLS reverse proxy goes in front | Safe default; rws in front on the demo | Set `[web]` in ortus.toml |
| 2026-11-20 | Release binaries and the image are static musl builds; the image is `FROM scratch` with the program only | No GPL/LGPL base system ships; one binary runs on any Linux | Use a distroless base |
| 2026-11-20 | S3 trusts the webpki root list built into the program, not the system store | The scratch image has no store; the Mozilla bundle file is MPL | Add a setting for an extra CA file |
| 2026-11-20 | The chart needs the CloudNativePG operator installed beforehand (one helm command); RustFS is a plain StatefulSet in the chart; a hook Job makes the bucket | Installing the operator and its Cluster in one release fails on missing CRDs | Make the operator a subchart with a two-step install |
| 2026-11-20 | Story steps S1.1 (workstation QR sign-in) and S3.3–4 (laptop first boot) stay in V1 as web stand-ins: passkey sign-in, and language choice plus phone enrolment | Their boards are Ortus OS (V2) but GOAL.md does not list them as out of V1 | Mark them out in stories/tools/import-steps.py |
| 2026-11-20 | App repos: ortus-calendar holds calendar and people; ortus-tasks holds tasks and approvals | Matches the bundles in GOAL.md (ortus-mail = mail, calendar, contacts) | Split a repo |
| 2026-11-20 | App crates depend on ortus-core by git URL, patched to the pinned checkout in .deps/ | One copy of the core in every build; the pin decides the commit | Publish crates to a registry |
| 2026-11-20 | Admin and Settings are core screens (/admin, /settings), not apps; the page is also served under every known app path so the client can say "not installed" | They exist in every installation | Make them apps |
