#!/bin/sh
# Writes a backup into a new, dated directory under $1 and removes all but
# the newest $ORTUS_BACKUP_KEEP (default 7). Run by ortus-backup.service.
set -eu
dest="$1"
keep="${ORTUS_BACKUP_KEEP:-7}"
ortus="${ORTUS_BIN:-/usr/local/bin/ortus}"
mkdir -p "$dest"
name="$(date -u +%Y%m%dT%H%M%SZ)"
"$ortus" backup "$dest/$name.partial"
mv "$dest/$name.partial" "$dest/$name"
# Interrupted backups end in .partial and never count as kept.
find "$dest" -mindepth 1 -maxdepth 1 -type d -name '*.partial' ! -name "$name.partial" -exec rm -rf {} +
find "$dest" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' | sort | head -n "-$keep" | while read -r old; do
  rm -rf "$old"
done
echo "ortus-backup: $dest/$name"
