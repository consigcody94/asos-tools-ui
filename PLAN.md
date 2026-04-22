# O.W.L. — Azure Architecture Plan

**Goal:** the most sophisticated observation-tooling stack in the NOAA / FAA /
NWS data orbit. Significantly beyond what's possible on Hugging Face Spaces.
Real-time, AI-augmented, audit-grade, multi-region capable.

The Streamlit + HF Space stays where it is and keeps serving as the
"reference Python implementation". This Azure build is the production
operations console.

---

## Architecture (target end state)

```
                                    ┌────────────────────┐
                                    │ Azure Front Door + │
                                    │ WAF + DDoS         │
                                    └──────────┬─────────┘
                                               │ TLS, geo-routed
        ┌──────────────────────────────────────┼──────────────────────────────────────┐
        │                                      │                                      │
   ┌────▼────┐  Microsoft Entra ID SSO   ┌─────▼──────┐                       ┌──────▼──────┐
   │ Browser │ ◄───────────────────────► │ Next.js 15 │  REST + SignalR push  │  FastAPI    │
   │ HUD UI  │                            │ ACA app    │ ◄──────────────────► │  ACA app    │
   └────▲────┘                            └─────┬──────┘                       └──────┬──────┘
        │ websocket (live status)               │                                      │
        └───────────────────────────────────────┘                                      │
                                                ▼                                      ▼
                                       ┌────────────────┐                  ┌──────────────────────┐
                                       │ Azure SignalR  │                  │ Azure PostgreSQL     │
                                       │ (real-time)    │                  │ Flexible Server      │
                                       └────────────────┘                  │ — watchlist          │
                                                                           │ — METAR archive      │
                                                                           │ — audit trail        │
                                       ┌────────────────┐                  └──────────────────────┘
                                       │ Azure Cache    │
                                       │ for Redis      │                  ┌──────────────────────┐
                                       └────────────────┘                  │ Azure Blob Storage   │
                                                                           │ — cam frame archive  │
                                       ┌────────────────┐                  │ — PDF reports        │
                                       │ Azure OpenAI   │                  │ — SBOM artifacts     │
                                       │ (AI Brief)     │                  └──────────────────────┘
                                       └────────────────┘
                                                                           ┌──────────────────────┐
                                       ┌────────────────┐                  │ Azure Functions      │
                                       │ Azure Monitor  │                  │ — 5-min scan timer   │
                                       │ + App Insights │                  │ — alert dispatcher   │
                                       │ + Log Analytics│                  └──────────────────────┘
                                       └────────────────┘

                       ┌──────────────────────────────────────────────┐
                       │ Key Vault — secrets / connection strings     │
                       │ Managed Identity — service-to-service auth   │
                       │ Defender for Cloud — posture management      │
                       └──────────────────────────────────────────────┘
```

**Key principles:**
1. **No plaintext secrets anywhere** — Key Vault + Managed Identity end-to-end.
2. **Real-time, not polling** — SignalR pushes status changes; browsers update
   without reloading.
3. **Federal audit trail** — every state change written to PostgreSQL with
   timestamp + actor + diff; mirrored to Log Analytics workspace.
4. **AI-augmented, not AI-driven** — OpenAI generates briefings and summaries
   from authoritative federal data, never invents station status.
5. **Multi-region capable** — Front Door routes; PostgreSQL geo-replication
   ready when budget allows; ACA can run in multiple regions.
6. **Federal SSO** — Microsoft Entra ID with role-based access (NOC duty /
   AOMC controller / forecaster / read-only).

---

## Phased execution plan

### Phase 0 — Foundation (sticking the landing today)

| # | Task | Status |
|---|---|---|
| 0.1 | Bump Next.js to latest patched (CVE-2025-66478) | pending |
| 0.2 | Verify local `next build` succeeds | pending |
| 0.3 | Provision Resource Group `asos-rg` in `eastus` | pending |
| 0.4 | Provision Azure Container Registry `asosacr` | pending |
| 0.5 | Provision Log Analytics workspace `asos-logs` | pending |
| 0.6 | Provision Container Apps environment `asos-env` (linked to logs) | pending |
| 0.7 | Build + push UI image via `az acr build` | pending |
| 0.8 | Deploy Container App `asos-tools-ui` (external ingress, port 3000) | pending |
| 0.9 | Return public URL | pending |

**Deliverable:** Live URL, https, externally accessible. NOC chrome visible.

### Phase 1 — Observability + cache

| # | Task |
|---|---|
| 1.1 | Application Insights resource + connection string |
| 1.2 | Wire `@vercel/otel` or `applicationinsights` Node SDK in Next.js |
| 1.3 | Custom metrics: `owl.scan.duration`, `owl.api.latency`, `owl.cam.fetch_errors` |
| 1.4 | Provision Azure Cache for Redis (Basic C0 tier) |
| 1.5 | Wire `ioredis` client; cache `/api/health` for 30 s, `/api/news` for 120 s |

### Phase 2 — Database + secrets

| # | Task |
|---|---|
| 2.1 | Provision PostgreSQL Flexible Server (Burstable B1ms) |
| 2.2 | Schema: `stations`, `scans`, `scan_results`, `audit_events`, `users`, `roles` |
| 2.3 | Migrate the existing AOMC catalog from JSON → `stations` table |
| 2.4 | Provision Key Vault `asos-vault` |
| 2.5 | Move PG/Redis/SignalR connection strings into Key Vault |
| 2.6 | Enable system-assigned Managed Identity on Container Apps; grant Key Vault Reader |

### Phase 3 — Real-time push

| # | Task |
|---|---|
| 3.1 | Provision Azure SignalR Service (Free F1 tier) |
| 3.2 | Backend: when a scan finishes, publish `scan_complete` event to SignalR |
| 3.3 | Frontend: subscribe; update globe points + KPI counts without reload |
| 3.4 | Add live "TIME SINCE LAST UPDATE" readout (counts seconds since last push) |

### Phase 4 — AI Brief

| # | Task |
|---|---|
| 4.1 | Deploy Azure OpenAI Service in same region; deploy `gpt-4o` model |
| 4.2 | Backend `/api/brief` endpoint takes (scan_state, active_alerts, top_n_problems) |
| 4.3 | Prompt: "Operations briefing for NOC shift change. Be concise, use federal terminology, cite station ICAOs..." |
| 4.4 | Frontend: "GENERATE AI BRIEF" button on Summary tab, modal with copy-to-clipboard |

### Phase 5 — Federal SSO + WAF

| # | Task |
|---|---|
| 5.1 | Microsoft Entra ID app registration |
| 5.2 | NextAuth.js (or Auth.js v5) with `EntraID` provider |
| 5.3 | Role claim mapping → app roles: `noc_duty`, `aomc`, `forecaster`, `viewer` |
| 5.4 | Gate Admin tab + AI Brief behind `noc_duty` role |
| 5.5 | Provision Azure Front Door + WAF Premium policy |
| 5.6 | OWASP Top 10 ruleset + bot mitigation; route Front Door → ACA |

### Phase 6 — CI/CD + compliance

| # | Task |
|---|---|
| 6.1 | OIDC federation: GitHub Actions ↔ Entra ID app, no stored secrets |
| 6.2 | Workflow: build, push to ACR, update Container App on push to main |
| 6.3 | PR previews: each PR creates an ACA revision with a unique URL |
| 6.4 | Port `sbom.yml` + `scorecard.yml` from HF repo |
| 6.5 | Defender for Cloud baseline review + remediation |

### Phase 7 — Tab parity with HF Spaces

| # | Task |
|---|---|
| 7.1 | AOMC Controllers (per-operator rollup, sortable table) |
| 7.2 | NWS Forecasters (METAR + TAF + SIGMET viewer) |
| 7.3 | Reports (PDF generation via `@react-pdf/renderer`, persisted to Blob) |
| 7.4 | Stations directory (920-row searchable table, virtualized) |
| 7.5 | Admin (scheduler status, cache stats, anomaly review, source registry) |

### Phase 8 — Polish + launch

| # | Task |
|---|---|
| 8.1 | Lighthouse audit (LCP < 2 s, CLS < 0.1) |
| 8.2 | Accessibility audit (WCAG 2.1 AA) |
| 8.3 | USWDS-compatible federal banner (correct cookie behaviour) |
| 8.4 | Privacy / Section 508 / accessibility statement pages |
| 8.5 | Operations runbook + incident playbook |
| 8.6 | Custom domain (`owl.<your-domain>`) with TLS via Front Door |

---

## Differences vs the HF Spaces version

| Capability | HF Spaces | Azure (target) |
|---|---|---|
| Compute | 2 vCPU shared | Auto-scaling Container Apps, scale-to-zero |
| Refresh model | Page reloads + 3-min poll | SignalR live push |
| Database | DiskCache file | PostgreSQL Flexible Server |
| Cache | DiskCache file | Azure Cache for Redis |
| Background jobs | GitHub Actions cron | Azure Functions timer trigger |
| AI assist | None | Azure OpenAI `gpt-4o` briefings |
| Auth | Optional passcode | Entra ID SSO + RBAC |
| Secrets | Env vars | Key Vault + Managed Identity |
| WAF | nginx rate-limit | Front Door + WAF Premium |
| Audit log | Streamlit logs | Log Analytics + structured events |
| Region | Single (HF community) | Multi-region capable |
| TLS / domain | hf.space subdomain | Custom domain via Front Door |

---

## Cost ceiling (Azure for Students $100 credit + free tiers)

| Resource | SKU | Est. monthly |
|---|---|---|
| Container Apps environment | Consumption (scale-to-zero) | ~$0–5 |
| ACR | Basic | $5 |
| Log Analytics | Pay-as-you-go (5 GB/mo free) | ~$0 |
| App Insights | Pay-as-you-go (5 GB/mo free) | ~$0 |
| PostgreSQL Flexible Server | Burstable B1ms | ~$13 |
| Azure Cache for Redis | Basic C0 | ~$16 |
| SignalR Service | Free F1 | $0 |
| Azure OpenAI | Pay-per-token | ~$5 (low volume) |
| Front Door + WAF | Standard | ~$35 |
| Storage (Blob, Queue) | Hot, LRS | ~$1 |
| Key Vault | Standard | ~$0.03/10k operations |
| **Total target** | | **~$75/mo** |

Front Door + WAF is the biggest line. Phase 5 can defer it; Phase 0–4 fit
inside the student credit easily.
