#!/usr/bin/env bash
# A new version of the site onto a server that setup.sh prepared, run as root from the uploaded Website folder:
#   sudo bash Website/deploy/update.sh
# The database, the uploaded files and the game's archives are left alone; site.config.json is replaced by the
# uploaded one (keep your settings in it on your computer).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/school-riot
[ "$(id -u)" = 0 ] || { echo "Run it with sudo (as root)."; exit 1; }
[ -f /etc/systemd/system/school-riot.service ] || { echo "Not set up yet: run setup.sh first."; exit 1; }

# a backup first, in case the new version is not right
bash "$APP/deploy/backup.sh" || echo "(backup failed - going on)"

rsync -a --delete --exclude 'data/' --exclude 'downloads/*.zip' "$SRC/" "$APP/"
chown -R root:root "$APP"
chmod -R u=rwX,go=rX "$APP"
install -m 0755 "$APP/deploy/backup.sh" /etc/cron.daily/school-riot-backup
systemctl restart school-riot
sleep 1
if curl -fsS http://127.0.0.1:8080/api/site >/dev/null; then echo "Updated: the site answers."; else echo "The site does not answer: journalctl -u school-riot -n 50"; exit 1; fi
