# OWL Deployment Runbook

This app is container-ready. The preferred target is now Proxmox/home lab with
safe public access through a tunnel or reverse proxy.

## Current Local Blocker

This workstation does not currently have the Azure CLI installed:

```bash
az account show
# zsh: command not found: az
```

Install it before pushing to Azure:

```bash
brew update
brew install azure-cli
az login
```

## Proxmox Phase Plan

| Phase | Azure item replaced | Proxmox/home-lab implementation |
|---|---|---|
| Phase 1 | Application Insights | Prometheus + Grafana + OpenTelemetry collector; app metrics for `owl.scan.duration`, `owl.api.latency`, `owl.cam.fetch_errors` |
| Phase 1 | Azure Cache for Redis | Redis container on the same Docker network; 30s hot METAR + scan cache TTL |
| Phase 2 | PostgreSQL Flexible Server | PostgreSQL container or dedicated Proxmox VM; nightly `pg_dump`, WAL/archive backup if needed |
| Phase 2 | Key Vault + Managed Identity | SOPS + age, Docker secrets, or host-mounted `/run/secrets/*`; no plaintext committed env files |
| Phase 3 | Azure SignalR Service | Server-Sent Events or Socket.IO container/service for real-time globe pushes |
| Phase 4 | Azure OpenAI GPT-4o | OpenAI-compatible endpoint: Ollama/vLLM locally or hosted OpenAI/Azure OpenAI by env var |
| Phase 5 | Microsoft Entra ID SSO | Authentik or Authelia in front of the app; RBAC via headers/session claims |
| Phase 5 | Azure Front Door + WAF | Caddy or Traefik + Cloudflare Tunnel/WAF; no direct Node exposure |
| Phase 6 | GitHub Actions OIDC | GitHub Actions builds image to GHCR; deploy over SSH to Proxmox with scoped deploy key |
| Follow-on | Anomaly review queue | Postgres-backed queue with Matrix Profile/STUMPY worker container |
| Follow-on | Manual cache flush + audit | Admin action writes to `audit_events`; Redis key deletion through server route |
 
## Proxmox / Home Network

Use this path when you want to host it yourself. Do not expose the Node server directly to the internet.

### 1. Recommended VM size

Create a dedicated Proxmox VM for the public command center:

- 12-16 vCPU, CPU type `host`
- 32 GB RAM
- 250 GB NVMe-backed disk
- Debian 12 or Ubuntu 24.04 LTS
- Docker Engine + Docker Compose plugin
- QEMU guest agent enabled

The checked-in high-resource profile is:

- `docker-compose.proxmox.yml`
- `.env.proxmox.example`
- `Caddyfile.proxmox`
- `scripts/deploy-proxmox.sh`
- `infra/proxmox/README.md`

### 2. Docker Compose baseline

Create `/opt/owl/docker-compose.yml` on a Proxmox VM:

```yaml
services:
  owl:
    image: ghcr.io/consigcody94/asos-tools-ui:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      NEXT_PUBLIC_SITE_URL: https://owl.yourdomain.com
      REDIS_URL: redis://redis:6379
      DATABASE_URL: postgres://owl:change-me@postgres:5432/owl
    depends_on:
      - redis
      - postgres

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis-data:/data

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: owl
      POSTGRES_USER: owl
      POSTGRES_PASSWORD: change-me
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  redis-data:
  postgres-data:
```

Then:

```bash
docker compose pull
docker compose up -d
```

Or deploy the checked-in profile from this workstation:

```bash
export PROXMOX_HOST=192.168.1.50
export PROXMOX_USER=owl
export OWL_IMAGE=ghcr.io/consigcody94/asos-tools-ui:latest
./scripts/deploy-proxmox.sh
```

### 3. Local image build option

If you are not using GHCR yet:

```bash
docker build -t asos-tools-ui:latest .
docker run -d \
  --name asos-tools-ui \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e NEXT_PUBLIC_SITE_URL=https://owl.yourdomain.com \
  asos-tools-ui:latest
```

### 4. Publish it safely

Preferred options:

- Cloudflare Tunnel: no inbound router port required.
- Tailscale Funnel: simple public access if your account supports it.
- Caddy or Nginx reverse proxy: requires port-forwarding 443 to the proxy host.

Cloudflare Tunnel example:

```bash
cloudflared tunnel create owl
cloudflared tunnel route dns owl owl.yourdomain.com
cloudflared tunnel run owl
```

Tunnel config:

```yaml
tunnel: owl
credentials-file: /etc/cloudflared/owl.json

ingress:
  - hostname: owl.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

Caddy example:

```caddyfile
owl.yourdomain.com {
  reverse_proxy 127.0.0.1:3000
}
```

### 5. Operational requirements

- Keep the VM patched.
- Put the app behind HTTPS.
- Add Authentik/Authelia before public launch if admin actions become write-capable.
- Avoid opening random high ports on the router; terminate at 443 through a proxy or tunnel.
- Add external uptime monitoring.
- Back up Postgres and any report archive volume.

## Azure Container Apps Legacy Option

Use this path when you want public HTTPS, managed scaling, and fewer home-network risks.

```bash
az group create \
  --name asos-rg \
  --location eastus

az acr create \
  --resource-group asos-rg \
  --name asosowlacr \
  --sku Basic

az acr build \
  --registry asosowlacr \
  --image asos-tools-ui:latest \
  .

az containerapp env create \
  --name asos-env \
  --resource-group asos-rg \
  --location eastus

az containerapp create \
  --name asos-tools-ui \
  --resource-group asos-rg \
  --environment asos-env \
  --image asosowlacr.azurecr.io/asos-tools-ui:latest \
  --target-port 3000 \
  --ingress external \
  --registry-server asosowlacr.azurecr.io \
  --min-replicas 0 \
  --max-replicas 2 \
  --env-vars NEXT_PUBLIC_SITE_URL=https://REPLACE_WITH_CONTAINERAPP_URL
```

After the app URL is assigned, update `NEXT_PUBLIC_SITE_URL`:

```bash
az containerapp update \
  --name asos-tools-ui \
  --resource-group asos-rg \
  --set-env-vars NEXT_PUBLIC_SITE_URL=https://YOUR_APP_URL
```

Optional secrets:

```bash
az containerapp secret set \
  --name asos-tools-ui \
  --resource-group asos-rg \
  --secrets faa-notam-client-id=VALUE faa-notam-client-secret=VALUE

az containerapp update \
  --name asos-tools-ui \
  --resource-group asos-rg \
  --set-env-vars FAA_NOTAM_CLIENT_ID=secretref:faa-notam-client-id FAA_NOTAM_CLIENT_SECRET=secretref:faa-notam-client-secret
```

## Recommendation

For your stated preference, use Proxmox plus Cloudflare Tunnel first. It is cost-effective, avoids router exposure, and keeps the deployment under your control. Move to a managed host only if uptime, scaling, or compliance requirements exceed what the home lab can support.
