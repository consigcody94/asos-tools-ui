#!/usr/bin/env bash
# One-shot: diagnose why the puller is stuck and force-deploy the
# latest origin/main. Safe to run repeatedly.
#
#   Usage (from your Mac on the LAN):
#     ssh -i ~/.ssh/asos_proxmox_ed25519 -o IdentitiesOnly=yes \
#       root@192.168.1.10 'pct exec 102 -- bash' < scripts/diagnose-and-deploy.sh

set -euo pipefail

echo "=== current LXC HEAD ==="
cd /opt/owl
git rev-parse --short HEAD || echo "no git"

echo
echo "=== puller log tail ==="
tail -25 /var/log/owl-puller.log 2>/dev/null || echo "no puller log"

echo
echo "=== npm log tail ==="
tail -25 /var/log/owl-puller-npm.log 2>/dev/null || echo "no npm log"

echo
echo "=== stuck npm/build processes ==="
ps -eo pid,etime,cmd | grep -E "npm|next-build|node " | grep -v grep | head -10

echo
echo "=== forcing puller run (lock-aware) ==="
# Clear stale lock if no process holds it.
exec 9>/var/run/owl-puller.lock
if flock -n 9; then
  echo "no other puller in flight — running now"
else
  echo "another puller is in flight; aborting forced run"
  exit 0
fi
flock -u 9
exec 9>&-

# Kick the systemd unit (single-shot).
systemctl start owl-puller.service
sleep 4
systemctl status --no-pager owl-puller.service | head -15

echo
echo "=== post-run HEAD ==="
git rev-parse --short HEAD

echo
echo "=== owl service health ==="
systemctl is-active owl
curl -fsS -o /dev/null -w "home=%{http_code}\n" http://127.0.0.1:3000/

echo
echo "=== earth-blue-marble.jpg should now 404 (v3.14 deleted it) ==="
curl -sI http://127.0.0.1:80/globe/earth-blue-marble.jpg | head -2
