# O.W.L. UI — Observation Watch Log (Next.js + Azure)

Modern Next.js 15 / React 19 / Tailwind 4 frontend for the ASOS network
observation & maintenance monitor.  Talks to the existing FastAPI
backend deployed on Hugging Face Spaces.

## Stack

- **Next.js 15** (App Router, React Server Components, Turbopack dev)
- **React 19**
- **TypeScript** (strict)
- **Tailwind 4** (token-based theme via `@theme` directive)
- **Globe.gl + Three.js** for the 3D NOC globe
- **lucide-react** for icons
- Backend: existing **OWL FastAPI** on Hugging Face Spaces
  (`https://consgicody-asos-tools.hf.space/api/*`)

## Local dev

```bash
npm install
npm run dev          # http://localhost:3000
```

## Deploy to Azure Container Apps

```bash
az containerapp up \
  --name asos-tools-ui \
  --resource-group asos-rg \
  --location eastus \
  --environment asos-env \
  --source . \
  --ingress external \
  --target-port 3000 \
  --env-vars OWL_API_BASE=https://consgicody-asos-tools.hf.space
```

Returns a public URL like
`https://asos-tools-ui.<random>.eastus.azurecontainerapps.io`.

## Env vars

| Name | Default | Purpose |
|---|---|---|
| `OWL_API_BASE` | `https://consgicody-asos-tools.hf.space` | FastAPI backend root |
| `NEXT_PUBLIC_OWL_API_BASE` | (same) | Client-side override |

## Architecture

```
                ┌─────────────────────────────┐
                │  Browser  (NOC HUD chrome)  │
                └──────────────┬──────────────┘
                               │  HTTPS
                ┌──────────────▼──────────────┐
                │ Next.js 15 on Azure Container│  ← this repo
                │  Apps (server components,    │
                │  RSC streaming, edge cache)  │
                └──────────────┬──────────────┘
                               │  REST /api/*
                ┌──────────────▼──────────────┐
                │  FastAPI on Hugging Face    │  ← asos-tools repo
                │  Space (Python data work):  │
                │  · IEM / AWC / NCEI scrape  │
                │  · avwx-engine METAR parse  │
                │  · stumpy anomaly detection │
                │  · FAA WeatherCams client   │
                └─────────────────────────────┘
```

The Streamlit app on HF Spaces continues to run unchanged — this is a
separate frontend that consumes the same backend.

## Project layout

```
app/
  layout.tsx           Root shell (sidebar + main)
  page.tsx             Summary tab (server component, KPIs)
  summary-client.tsx   Globe + drill panel (client component)
  globals.css          Tailwind + NOC theme tokens + chrome utilities
components/
  ops-banner.tsx       Mission-control bar with live UTC clock
  sidebar.tsx          Left rail with brand, pulse, nav
  kpi-strip.tsx        6-up KPI cards
  globe.tsx            Globe.gl wrapper
  drill-panel.tsx      Per-station deep-dive panel
lib/
  api.ts               Typed client for OWL FastAPI
  utils.ts             cn() + small format helpers
Dockerfile             Multi-stage build for Azure Container Apps
```
