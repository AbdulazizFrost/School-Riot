#!/usr/bin/env bash
# The daily backup on the server (setup.sh puts it in /etc/cron.daily): the database (a consistent online
# copy) and the uploaded files into /var/backups/school-riot, the last 14 days kept. Copy that folder off the
# server now and then (a backup on the same machine does not survive the machine).
set -euo pipefail
DIR=/var/backups/school-riot
install -d -m 0700 "$DIR"
cd /opt/school-riot
DATA_DIR=/var/lib/school-riot node --disable-warning=ExperimentalWarning scripts/backup.js "$DIR" >/dev/null
tar -czf "$DIR/uploads-$(date +%F).tgz" -C /var/lib/school-riot uploads 2>/dev/null || true
find "$DIR" -type f -mtime +14 -delete
