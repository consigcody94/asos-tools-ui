#!/usr/bin/env bash
set -euo pipefail

# Deploy OWL to a Docker-capable Proxmox VM over SSH.
#
# Required:
#   PROXMOX_HOST=owl-vm-or-ip
#
# Optional:
#   PROXMOX_USER=owl
#   PROXMOX_PATH=/opt/owl
#   OWL_IMAGE=ghcr.io/consigcody94/asos-tools-ui:latest
#   BUILD_LOCAL=1

PROXMOX_HOST="${PROXMOX_HOST:?Set PROXMOX_HOST to the Proxmox VM hostname or IP}"
PROXMOX_USER="${PROXMOX_USER:-owl}"
PROXMOX_PATH="${PROXMOX_PATH:-/opt/owl}"
OWL_IMAGE="${OWL_IMAGE:-ghcr.io/consigcody94/asos-tools-ui:latest}"

if [[ "${BUILD_LOCAL:-0}" == "1" ]]; then
  docker build -t "$OWL_IMAGE" .
fi

ssh "${PROXMOX_USER}@${PROXMOX_HOST}" "mkdir -p '${PROXMOX_PATH}/backups'"

scp docker-compose.proxmox.yml "${PROXMOX_USER}@${PROXMOX_HOST}:${PROXMOX_PATH}/docker-compose.yml"
scp Caddyfile.proxmox "${PROXMOX_USER}@${PROXMOX_HOST}:${PROXMOX_PATH}/Caddyfile"

if ! ssh "${PROXMOX_USER}@${PROXMOX_HOST}" "test -f '${PROXMOX_PATH}/.env'"; then
  scp .env.proxmox.example "${PROXMOX_USER}@${PROXMOX_HOST}:${PROXMOX_PATH}/.env"
  echo "Created ${PROXMOX_PATH}/.env on ${PROXMOX_HOST}."
  echo "Edit it before the first production start, especially POSTGRES_PASSWORD and NEXT_PUBLIC_SITE_URL."
fi

ssh "${PROXMOX_USER}@${PROXMOX_HOST}" "
  set -euo pipefail
  cd '${PROXMOX_PATH}'
  sed -i.bak 's#^OWL_IMAGE=.*#OWL_IMAGE=${OWL_IMAGE}#' .env
  docker compose pull
  docker compose up -d
  docker compose ps
"
