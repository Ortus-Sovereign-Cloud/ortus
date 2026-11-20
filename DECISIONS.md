# Decisions taken by the build agent

Choices the owner had not made, taken so work could continue. Each is reversible unless it says otherwise. Newest last.

| Date | Decision | Why | How to undo |
| --- | --- | --- | --- |
| 2026-11-20 | Backups are a logical, engine-independent directory (manifest with checksums, one JSONL file per table, the files), not a copy of the SQLite file or a pg_dump | One format for both shapes, and it moves an installation from one machine to the chart and back | Add an engine-native backup beside it; the command line stays |
| 2026-11-20 | The command line (`serve`, `backup`, `check-backup`, `restore`, `version`) lives in `ortus_core::cli`; each program is a thin `main` | The four programs must behave the same | Move it into the `ortus` repository |
| 2026-11-20 | The one-machine install files (systemd units, `install.sh`, backup script) live in the `ortus` repository under `install/`; the chart goes to `ortus-deploy` | The install ships with the program it installs | Move the folder |
| 2026-11-20 | The `ortus` repository builds from `pins.toml` (commit per repository) checked out under `.deps/` by `ci/fetch.sh`, as path dependencies | Built web clients are not in git, so a plain git dependency cannot build; a pin file is plain to read and change | Commit the built clients and use git dependencies |
| 2026-11-20 | The program listens on 127.0.0.1:7878 by default; a TLS reverse proxy goes in front | Safe default; rws in front on the demo | Set `[web]` in ortus.toml |
