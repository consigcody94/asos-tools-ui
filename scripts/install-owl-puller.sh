#!/usr/bin/env bash
# Install a systemd timer that polls origin/main every 60s and rebuilds
# OWL when there are new commits. Eliminates the need for SSH-from-Mac
# to deploy — Claude (or anyone) just pushes to GitHub and the LXC
# pulls itself up within a minute.
set -euo pipefail

# 1) The puller script.
install -m 0755 /dev/stdin /usr/local/bin/owl-puller.sh <<'SH'
#!/usr/bin/env bash
# Pull latest /opt/owl from origin/main and rebuild on change.
set -euo pipefail
cd /opt/owl
export NEXT_TELEMETRY_DISABLED=1
export npm_config_cache=/opt/owl/.npm
export PATH=/usr/local/bin:/usr/bin:/bin

# Be a good neighbor: only one puller at a time.
exec 9>/var/run/owl-puller.lock
flock -n 9 || { echo "[puller] another run in progress"; exit 0; }

# Initialize as a git repo on first run.
if [ ! -d .git ]; then
  git init -q
  git remote add origin https://github.com/consigcody94/asos-tools-ui.git || true
  git fetch -q origin main
  git reset -q --hard origin/main
  CHANGED=1
else
  git fetch -q origin main
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/main)
  if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0
  fi
  CHANGED=1
  git reset -q --hard origin/main
fi

if [ "${CHANGED:-0}" = "1" ]; then
  echo "[puller] $(date -u +%FT%TZ) building $(git rev-parse --short HEAD)"
  chown -R owl:owl /opt/owl
  runuser -u owl -- npm ci --no-audit --no-fund >/var/log/owl-puller-npm.log 2>&1
  runuser -u owl -- npm run build  >>/var/log/owl-puller-npm.log 2>&1
  rm -rf .next/standalone/.next/static .next/standalone/public
  mkdir -p .next/standalone/.next
  cp -a .next/static .next/standalone/.next/static
  cp -a public .next/standalone/public
  chown -R owl:owl .next/standalone
  systemctl restart owl
  echo "[puller] $(date -u +%FT%TZ) deploy complete"
fi
SH

# 2) The service unit.
cat > /etc/systemd/system/owl-puller.service <<'EOF'
[Unit]
Description=OWL — pull latest main and rebuild on change
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/owl-puller.sh
StandardOutput=append:/var/log/owl-puller.log
StandardError=append:/var/log/owl-puller.log
EOF

# 3) The timer.
cat > /etc/systemd/system/owl-puller.timer <<'EOF'
[Unit]
Description=Run owl-puller every 60 seconds

[Timer]
OnBootSec=60s
OnUnitActiveSec=60s
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

# Make sure git is installed (required for the pull).
DEBIAN_FRONTEND=noninteractive apt-get install -y -q git >/dev/null

# /opt/owl is owned by user `owl` but the puller runs as root via
# systemd. Without this entry git refuses to operate on the tree with
# "dubious ownership". --system writes /etc/gitconfig so the policy
# applies regardless of which HOME the systemd unit gets.
git config --system --add safe.directory /opt/owl 2>/dev/null || true

systemctl daemon-reload
systemctl enable --now owl-puller.timer
echo "--- timer status ---"
systemctl status --no-pager owl-puller.timer | head -10
echo
echo "--- first run log (after a beat) ---"
sleep 3
tail -n 5 /var/log/owl-puller.log 2>/dev/null || echo "(no log yet — first cycle still pending)"
