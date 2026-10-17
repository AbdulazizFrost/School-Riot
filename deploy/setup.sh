#!/usr/bin/env bash
# The first setup of a fresh Ubuntu 22.04 / 24.04 server (a VPS) for the site, run as root from the uploaded
# Website folder:
#   sudo bash Website/deploy/setup.sh [domain] [email]
#     domain - e.g. schoolriot.duckdns.org or schoolriot.uz: with it the site gets free HTTPS (Let's Encrypt);
#              without it the site runs on plain HTTP by the server's IP (for a first look only: passwords would
#              travel unencrypted - get a domain before letting players register)
#     email  - for Let's Encrypt's expiry notices (optional)
# What it does: Node.js 24 (NodeSource's signed repository), nginx, a firewall (SSH, HTTP, HTTPS only), a
# system user for the site, the site as a service, HTTPS, automatic security updates, a daily backup.
# Safe to run again (it updates what is there).
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/school-riot
DATA=/var/lib/school-riot

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run it with sudo (as root)."; exit 1; }
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) echo "Made for Ubuntu / Debian (this is ${ID:-unknown})."; exit 1 ;; esac
if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then echo "Not a domain: $DOMAIN"; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

say "System packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg nginx ufw rsync unattended-upgrades

say "Node.js"
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  minor="$(node -p 'process.versions.node.split(".")[1]')"
  if [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; }; then need_node=0; fi
fi
if [ "$need_node" = 1 ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
fi
node -e 'require("node:sqlite")' || { echo "This Node.js has no built-in SQLite (needs 22.13+)."; exit 1; }
echo "node $(node -v)"

say "The site's files"
id schoolriot >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin schoolriot
install -d -o schoolriot -g schoolriot -m 0700 "$DATA"
install -d -m 0755 "$APP" "$APP/downloads"
# the program is root's and read-only to the service; the game's archives in downloads/ are kept
rsync -a --delete --exclude 'data/' --exclude 'downloads/*.zip' "$SRC/" "$APP/"
chown -R root:root "$APP"
chmod -R u=rwX,go=rX "$APP"

# the administration's console command: school-riot-admin make-admin <nick> (and the others)
cat > /usr/local/bin/school-riot-admin <<'EOF'
#!/bin/sh
cd /opt/school-riot && exec sudo -u schoolriot env DATA_DIR=/var/lib/school-riot node --disable-warning=ExperimentalWarning scripts/admin.js "$@"
EOF
chmod 0755 /usr/local/bin/school-riot-admin

if [ -n "$DOMAIN" ]; then URL="http://$DOMAIN"; NAME="$DOMAIN"; else URL=""; NAME="_"; fi

say "The service"
sed "s|__PUBLIC_URL__|$URL|" "$APP/deploy/school-riot.service" > /etc/systemd/system/school-riot.service
systemctl daemon-reload
systemctl enable school-riot >/dev/null
systemctl restart school-riot

say "nginx"
sed "s|__SERVER_NAME__|$NAME|" "$APP/deploy/nginx-site.conf" > /etc/nginx/sites-available/school-riot
ln -sf /etc/nginx/sites-available/school-riot /etc/nginx/sites-enabled/school-riot
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

say "Firewall: SSH, HTTP, HTTPS"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
# (the game's own server, later: ufw allow 7777/udp)
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

if [ -n "$DOMAIN" ]; then
  say "HTTPS (Let's Encrypt)"
  apt-get install -y -q certbot python3-certbot-nginx
  echo "Let's Encrypt issues the certificate under its terms: https://letsencrypt.org/repository/"
  read -r -p "Agree to Let's Encrypt's terms and get the certificate for $DOMAIN? [y/N] " ok
  if [ "${ok,,}" = "y" ]; then
    if [ -n "$EMAIL" ]; then mail=(-m "$EMAIL"); else mail=(--register-unsafely-without-email); fi
    if certbot --nginx -d "$DOMAIN" --redirect --agree-tos --non-interactive "${mail[@]}"; then
      sed -i "s|^Environment=PUBLIC_URL=.*|Environment=PUBLIC_URL=https://$DOMAIN|" /etc/systemd/system/school-riot.service
      systemctl daemon-reload
      systemctl restart school-riot
      URL="https://$DOMAIN"
    else
      echo "The certificate did not come through: does $DOMAIN point to this server's IP yet? Run setup.sh again once it does."
    fi
  else
    echo "Skipped: the site stays on plain HTTP."
  fi
fi

say "Automatic security updates and a daily backup"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
install -m 0755 "$APP/deploy/backup.sh" /etc/cron.daily/school-riot-backup

say "Check"
sleep 1
if curl -fsS http://127.0.0.1:8080/api/site >/dev/null; then echo "the site answers"; else echo "the site does not answer: journalctl -u school-riot -n 50"; exit 1; fi
IP="$(hostname -I | awk '{print $1}')"
echo
echo "Done. Open: ${URL:-http://$IP}"
echo "The first administrator: register on the site, then   school-riot-admin make-admin <nick>"
echo "The game's archive goes to $APP/downloads/ (deploy.ps1 -Game uploads it)."
