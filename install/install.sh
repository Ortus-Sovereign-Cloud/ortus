#!/bin/sh
# Installs or upgrades Ortus on one machine (Linux with systemd), as root:
#
#   sudo ./install.sh ./ortus
#
# - creates the system user `ortus` and /var/lib/ortus (the data directory)
# - writes /etc/ortus/ortus.toml the first time only (never overwrites it)
# - puts the program at /usr/local/bin/ortus, keeping the one it replaces as
#   /usr/local/bin/ortus.previous
# - installs and starts ortus.service and the daily ortus-backup.timer
# - before an upgrade, takes a backup with the running program (the backup
#   service) into /var/lib/ortus/backups, before changing anything
# - waits for the health check; when an upgrade does not come up, puts the
#   previous program back and starts that again
#
# Running it again with a new program is the upgrade. The program upgrades
# its own database when it starts.
#
# ORTUS_ROOT=<dir> installs into <dir> instead of / and starts nothing, for
# tests and packaging.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
root="${ORTUS_ROOT:-}"
binary="${1:-}"

fail() {
  echo "install: $*" >&2
  exit 1
}

[ -n "$binary" ] || fail "usage: install.sh <path to the ortus program>"
[ -f "$binary" ] && [ -x "$binary" ] || fail "$binary is not an executable file"
"$binary" version >/dev/null 2>&1 || fail "$binary does not run on this machine"
if [ -z "$root" ]; then
  [ "$(id -u)" = 0 ] || fail "run as root (sudo), or set ORTUS_ROOT for a staged install"
  command -v systemctl >/dev/null || fail "systemd is needed"
fi

bin="$root/usr/local/bin"
etc="$root/etc/ortus"
data="$root/var/lib/ortus"
units="$root/etc/systemd/system"

if [ -z "$root" ] && ! getent passwd ortus >/dev/null; then
  nologin="$(command -v nologin || echo /usr/sbin/nologin)"
  useradd --system --user-group --home-dir /var/lib/ortus --no-create-home --shell "$nologin" ortus
  echo "install: created the system user ortus"
fi
owner() {
  # Changes ownership on a real install only.
  if [ -z "$root" ]; then chown "$@"; fi
}

install -d -m 0755 "$bin" "$etc" "$units"
install -d -m 0750 "$data" "$data/backups"
owner ortus:ortus "$data" "$data/backups"

if [ ! -e "$etc/ortus.toml" ]; then
  install -m 0640 "$here/ortus.toml" "$etc/ortus.toml"
  owner root:ortus "$etc/ortus.toml"
  echo "install: wrote $etc/ortus.toml"
fi
if [ ! -e "$etc/ortus.env" ]; then
  install -m 0640 /dev/null "$etc/ortus.env"
fi
# The program reads its settings as the user ortus, however they were made.
owner root:ortus "$etc/ortus.toml" "$etc/ortus.env"
chmod 0640 "$etc/ortus.toml" "$etc/ortus.env"

upgrade=no
if [ -e "$bin/ortus" ]; then
  if cmp -s "$binary" "$bin/ortus"; then
    echo "install: $bin/ortus is already this program"
  else
    upgrade=yes
  fi
fi
# Before anything changes: a backup taken by the program that is running,
# through the backup service, which reads the settings as the program does.
before=""
if [ -z "$root" ] && [ "$upgrade" = yes ] && systemctl is-active --quiet ortus; then
  systemctl start ortus-backup.service || fail "the backup before the upgrade failed; nothing was changed (see journalctl -u ortus-backup)"
  before="$(find /var/lib/ortus/backups -mindepth 1 -maxdepth 1 -type d -name '2*Z' | sort | tail -n 1)"
  echo "install: backup before the upgrade: $before"
fi
[ "$upgrade" = yes ] && cp -p "$bin/ortus" "$bin/ortus.previous"
install -m 0755 "$binary" "$bin/ortus.new"
mv -f "$bin/ortus.new" "$bin/ortus"
for unit in ortus.service ortus-backup.service ortus-backup.timer; do
  install -m 0644 "$here/$unit" "$units/$unit"
done
echo "install: installed $("$bin/ortus" version)"

[ -z "$root" ] || exit 0

health_url() {
  port="$(sed -n '/^\[web\]/,/^\[/s/^port *= *\([0-9][0-9]*\).*/\1/p' /etc/ortus/ortus.toml | head -n 1)"
  env_port="$(sed -n 's/^ORTUS_WEB_PORT=\([0-9][0-9]*\).*/\1/p' /etc/ortus/ortus.env | tail -n 1)"
  echo "http://127.0.0.1:${env_port:-${port:-7878}}/api/v1/health"
}

healthy() {
  url="$(health_url)"
  i=0
  while [ "$i" -lt 60 ]; do
    if systemctl is-active --quiet ortus && curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

systemctl daemon-reload
systemctl enable --quiet ortus.service ortus-backup.timer
systemctl start ortus-backup.timer
if [ "$upgrade" = yes ]; then
  systemctl restart ortus.service || true
else
  systemctl start ortus.service || true
fi

if healthy; then
  echo "install: Ortus is running: $(health_url)"
  exit 0
fi
echo "install: Ortus did not come up; the last lines of its log:" >&2
journalctl -u ortus -n 20 --no-pager >&2 || true
if [ "$upgrade" = yes ]; then
  echo "install: putting the previous program back" >&2
  mv -f "$bin/ortus.previous" "$bin/ortus"
  systemctl restart ortus.service || true
  if healthy; then
    fail "the upgrade failed; the previous program is running again"
  fi
  [ -z "$before" ] || fail "the previous program does not start either (the upgrade may have changed the database); restore $before into an empty data directory"
fi
fail "Ortus is not running; see journalctl -u ortus"
