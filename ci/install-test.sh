#!/usr/bin/env bash
# Tests the one-machine install with the release program.
#
# With ORTUS_INSTALL_TEST_SYSTEM=1 (set only in CI, on a throwaway runner)
# it installs for real with sudo: install, health,
# backup by the timer's service, upgrade (with the backup before it), and a
# restore into an empty data directory, then removes everything again.
# Otherwise it never uses sudo and checks what it can as this user: the staged install, the
# unit files, and the program under systemd in the user's own manager.
set -euo pipefail
cd "$(dirname "$0")/.."
binary="$(pwd)/target/release/ortus"
[ -x "$binary" ] || { echo "install-test: build the release program first" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A staged install puts every file in place and never overwrites settings.
ORTUS_ROOT="$work/root" install/install.sh "$binary" >/dev/null
for f in usr/local/bin/ortus usr/local/lib/ortus/backup.sh etc/ortus/ortus.toml etc/ortus/ortus.env \
  etc/systemd/system/ortus.service etc/systemd/system/ortus-backup.service etc/systemd/system/ortus-backup.timer; do
  [ -e "$work/root/$f" ] || { echo "install-test: staged install lacks $f" >&2; exit 1; }
done
echo "# changed" >> "$work/root/etc/ortus/ortus.toml"
ORTUS_ROOT="$work/root" install/install.sh "$binary" >/dev/null
grep -q "# changed" "$work/root/etc/ortus/ortus.toml" || { echo "install-test: settings were overwritten" >&2; exit 1; }

# The unit files are valid for systemd.
mkdir -p "$work/units"
for unit in ortus.service ortus-backup.service ortus-backup.timer; do
  sed -e "s#/usr/local/bin/ortus#$binary#; s#/usr/local/lib/ortus/backup.sh#$(pwd)/install/backup.sh#" "install/$unit" > "$work/units/$unit"
done
# Only what systemd says about our files counts; the machine's own units
# may have warnings of their own.
verify="$(systemd-analyze verify --man=no "$work/units/ortus.service" "$work/units/ortus-backup.service" "$work/units/ortus-backup.timer" 2>&1 | grep -F "$work/units/" | grep -v -e "User=ortus" -e "Group=ortus" || true)"
if [ -n "$verify" ]; then echo "install-test: systemd-analyze: $verify" >&2; exit 1; fi

wait_health() {
  local url="$1"
  for _ in $(seq 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "install-test: no answer from $url" >&2
  return 1
}

if [ "${ORTUS_INSTALL_TEST_SYSTEM:-}" = 1 ]; then
  echo "install-test: installing for real"
  sudo install/install.sh "$binary"
  url="http://127.0.0.1:7878/api/v1/health"
  wait_health "$url"
  systemctl show ortus -p Type --value | grep -qx notify
  # The data directory belongs to ortus and nobody else can read it.
  [ "$(sudo stat -c '%U %a' /var/lib/ortus)" = "ortus 750" ]
  # The timer's service takes a backup.
  sudo systemctl start ortus-backup.service
  sudo sh -c 'ls -d /var/lib/ortus/backups/2*' | grep -q .
  # An upgrade: a different program file, a backup before it, health after.
  cp "$binary" "$work/ortus-next"
  printf '\n' >> "$work/ortus-next"
  sudo install/install.sh "$work/ortus-next"
  wait_health "$url"
  sudo test -x /usr/local/bin/ortus.previous
  sudo sh -c 'ls -d /var/lib/ortus/backups/before-upgrade-*' | grep -q .
  # Some data, then a restore into an empty data directory.
  sudo -u ortus sh -c 'mkdir -p /var/lib/ortus/files/drive && echo "flood report" > /var/lib/ortus/files/drive/report.txt'
  sudo -u ortus env ORTUS_CONFIG=/etc/ortus/ortus.toml sh -c 'cd / && /usr/local/bin/ortus backup /var/lib/ortus/backups/test'
  sudo mv /var/lib/ortus/backups/test "$work/backup"
  sudo systemctl stop ortus
  sudo mv /var/lib/ortus "$work/old-data"
  sudo install -d -o ortus -g ortus -m 0750 /var/lib/ortus
  sudo chown -R ortus:ortus "$work/backup"
  sudo chmod 0755 "$work"
  sudo -u ortus env ORTUS_CONFIG=/etc/ortus/ortus.toml sh -c "cd / && /usr/local/bin/ortus restore $work/backup"
  sudo systemctl start ortus
  wait_health "$url"
  [ "$(sudo cat /var/lib/ortus/files/drive/report.txt)" = "flood report" ]
  # A clean stop.
  sudo systemctl stop ortus
  [ "$(systemctl show ortus -p Result --value)" = success ]
  sudo systemctl disable --now ortus-backup.timer
  sudo systemctl disable ortus
  sudo rm -rf /var/lib/ortus /etc/ortus /usr/local/bin/ortus /usr/local/bin/ortus.previous /usr/local/lib/ortus \
    /etc/systemd/system/ortus.service /etc/systemd/system/ortus-backup.service /etc/systemd/system/ortus-backup.timer
  sudo userdel ortus
  sudo systemctl daemon-reload
  sudo rm -rf "$work/old-data" "$work/backup"
elif systemctl --user show-environment >/dev/null 2>&1; then
  echo "install-test: running the program under the user's own systemd (no sudo)"
  unit="ortus-install-test-$$"
  port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
  mkdir -p "$work/data"
  systemd-run --user --quiet --unit="$unit" -p Type=notify -p NotifyAccess=main \
    --setenv=ORTUS_DATA_DIR="$work/data" --setenv=ORTUS_WEB_PORT="$port" -p WorkingDirectory="$work" \
    "$binary" serve
  trap 'systemctl --user stop "$unit" 2>/dev/null || true; rm -rf "$work"' EXIT
  [ "$(systemctl --user show "$unit" -p ActiveState --value)" = active ]
  wait_health "http://127.0.0.1:$port/api/v1/health"
  ORTUS_DATA_DIR="$work/data" ORTUS_BIN="$binary" ORTUS_BACKUP_KEEP=2 install/backup.sh "$work/backups" >/dev/null
  ORTUS_DATA_DIR="$work/data" ORTUS_BIN="$binary" ORTUS_BACKUP_KEEP=2 install/backup.sh "$work/backups" >/dev/null
  sleep 1
  ORTUS_DATA_DIR="$work/data" ORTUS_BIN="$binary" ORTUS_BACKUP_KEEP=2 install/backup.sh "$work/backups" >/dev/null
  [ "$(find "$work/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)" = 2 ] || { echo "install-test: backup.sh kept the wrong number" >&2; exit 1; }
  systemctl --user stop "$unit"
  result="$(systemctl --user show "$unit" -p Result --value 2>/dev/null || echo success)"
  [ -z "$result" ] || [ "$result" = success ] || { echo "install-test: stop result $result" >&2; exit 1; }
else
  echo "install-test: no user systemd; only the staged install was tested"
fi
echo "install-test: passed"
