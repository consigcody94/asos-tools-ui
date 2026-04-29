# Proxmox Target Profile

This repo cannot create the Proxmox guest until the node IP, storage names, bridge
name, and credentials are available. Use this as the target profile when creating
the VM in the Proxmox UI.

## Recommended "power" VM

Use a VM instead of an LXC for the public command-center deployment.

- Name: `owl-command-center`
- OS: Debian 12 or Ubuntu 24.04 LTS
- CPU: host type, 12 to 16 vCPU if available
- Memory: 32 GB RAM
- Disk: 250 GB NVMe-backed storage, discard/TRIM enabled
- Network: virtio NIC on the LAN bridge, static DHCP lease
- Agent: QEMU guest agent enabled
- Runtime: Docker Engine + Docker Compose plugin
- Firewall: allow SSH from admin LAN, allow 80/443 only to the reverse proxy

## Container resource plan

The Compose profile allocates the app stack this way:

- `owl-ui`: up to 8 CPU / 16 GB
- `owl-postgres`: up to 4 CPU / 8 GB
- `owl-redis`: up to 2 CPU / 3 GB
- `owl-caddy`: up to 2 CPU / 1 GB

Those limits assume the VM has at least 16 vCPU and 32 GB RAM. If the Proxmox
host has less capacity, reduce the `cpus` and `mem_limit` values in
`docker-compose.proxmox.yml`.

## First boot setup

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg |
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in after adding the user to the `docker` group.

## Deploy from this repo

```bash
export PROXMOX_HOST=192.168.1.50
export PROXMOX_USER=owl
export OWL_IMAGE=ghcr.io/consigcody94/asos-tools-ui:latest
./scripts/deploy-proxmox.sh
```

Then SSH to the VM and edit `/opt/owl/.env` before exposing it publicly:

```bash
cd /opt/owl
nano .env
docker compose up -d
docker compose logs -f owl
```

## Public access

Preferred:

- Cloudflare Tunnel to `http://127.0.0.1:3000`, or
- Caddy with router port-forwarding 80/443 to this VM.

Do not expose port `3000` directly to the internet.
