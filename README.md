---
title: OWL — Observation Watch Log
emoji: 🦉
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 3000
pinned: true
license: mit
short_description: ASOS network NOC console — Next.js / 32 public feeds
---

# O.W.L. — Observation Watch Log

**Author:** Cody Churchwell — CTO, Sentinel OWL — [`cto@sentinelowl.org`](mailto:cto@sentinelowl.org)

Professional NOC console for the **Automated Surface Observing System
(ASOS)** network. 920 NWS / FAA / DOD / Navy stations tracked live;
32 authoritative public data feeds and expansion sources wired into a single Next.js
app. No external backend — every data source is consumed directly by
`lib/server/*` and served through this app's own `/api/*` routes.

## Stack

- **Next.js 16** — App Router, React Server Components, Turbopack dev
- **React 19** — Client components only where interactivity is required
- **TypeScript** (strict)
- **Tailwind 4** — token-based theme via `@theme` directive
- **Globe.gl + Three.js** — 3D station globe
- **lucide-react** — icons
- **Azure Container Apps** — deployment target

No Python backend. No HuggingFace dependency. No scraping.

## Architecture

```
  ┌──────────────────────────────────────────────────────────────┐
  │  Browser (NOC UI)                                            │
  └──────────────────────────────┬───────────────────────────────┘
                                 │ HTTPS
  ┌──────────────────────────────▼───────────────────────────────┐
  │  Next.js 16 on Azure Container Apps (this repo)              │
  │                                                              │
  │  app/                                                        │
  │    /                     Network summary (globe + KPIs)      │
  │    /aomc                 Watchlist + per-station drill       │
  │    /forecasters          SIGMET/AIRMET/PIREP/TAF/AFD         │
  │    /stations             920-station directory               │
  │    /noaa                 NOAA/API atlas + modernization map  │
  │    /reports              CSV exports + evidence packages     │
  │    /admin                Sources + scheduler + cache         │
  │    /about                Architecture + author + licence     │
  │    /api/eonet/events     NASA EONET natural event feed       │
  │    /api/satellites/live  CelesTrak + SGP4 orbital feed       │
  │    /api/health           Network scan summary                │
  │    /api/scan-results     Per-station status rows             │
  │    /api/webcams/near     FAA WeatherCam proximity search     │
  │    /api/station/[id]/hazards  quakes + tropical + buoy +     │
  │                               CO-OPS + NOTAMs for station    │
  │    /api/usgs/quakes      USGS GeoJSON + proximity filter     │
  │    /api/nhc/storms       NHC active tropical cyclones        │
  │    /api/awc/afd          WFO Area Forecast Discussion        │
  │    /api/space-weather    NOAA SWPC Kp / X-ray / alerts       │
  │    /api/news             RSS ticker (NOAA/FAA/NTSB/NWS/SWPC) │
  │    /api/sources          Source-of-truth registry            │
  │    /api/noaa-atlas       NOAA/API atlas JSON                 │
  │    /api/stations/search  Fuzzy search (for the ⌘K palette)   │
  │    /api/ai-brief         Azure OpenAI NOC briefing           │
  │                                                              │
  │  lib/server/  — IEM, AWC, NWS, USGS, NHC, NDBC, CO-OPS,      │
  │                 RIDGE, GOES, SWPC, WeatherCams, NOTAMs,      │
  │                 Satellite, News, Sources, NOAA Atlas         │
  └───────────────┬──────────────────┬───────────────┬───────────┘
                  │     (all zero-auth public APIs)              │
                  ▼                  ▼               ▼
              IEM / NCEI          AWC / NWS       USGS / NHC / NDBC / ...
```

## Data sources (32)

| Source | Module | Used for | Auth |
|---|---|---|---|
| IEM | `server/iem.ts` | Primary METAR fetch + 4h network scan | none |
| NCEI | (indirect via IEM) | Authoritative archive | none |
| NCEI CDO | `/noaa` atlas | Normals, daily/monthly summaries, climatology | free token |
| NWS api.weather.gov | `server/nws.ts` | Current conditions + CAP alerts | UA |
| AWC | `server/awc.ts` | METAR / TAF / SIGMET / AIRMET / PIREP / **AFD** | none |
| NWS RIDGE NEXRAD | `server/radar.ts` | Per-station WSR-88D loops (159 sites) | none |
| NESDIS GOES-19 East | `server/radar.ts` | CONUS + NE/SE/UMV/SMV/NR/SR/PR sectors | none |
| NESDIS GOES-18 West | `server/radar.ts` | AK / HI / PNW / PSW (Pacific) | none |
| USGS | `server/usgs.ts` | Real-time quakes + per-station proximity | none |
| NHC | `server/nhc.ts` | Active tropical cyclones | none |
| NDBC | `server/ndbc.ts` | 402 met-enabled buoys, realtime2 feed | none |
| NOAA CO-OPS | `server/coops.ts` | Coastal water level, wind, pressure, temperature | none |
| FAA WeatherCams | `server/webcams.ts` | Nearest-cam lookup + loops | browser UA |
| NOAA SWPC | `server/swpc.ts` | Kp / X-ray / geomagnetic alerts | none |
| FAA NOTAM | `server/notams.ts` | Planned-outage correlation | client_id + secret |
| NOAA NWPS | `/noaa` atlas | River forecasts, National Water Model, flood categories | none |
| NOAA NOMADS | `/noaa` atlas | GFS / HRRR / RAP / NAM / GEFS model slices | none |
| NOAA MRMS | `/noaa` atlas | Multi-radar/multi-sensor GRIB2 products | none |
| NEXRAD NODD | `/noaa` atlas | Level II/III object manifests | none |
| GOES-R NODD | `/noaa` atlas | GOES-18/19 ABI + GLM raw product manifests | none |
| NWS Map Services | `/noaa` atlas | Time-enabled radar, LSR, warning, QPE overlays | none |
| NOAA nowCOAST | `/noaa` atlas | Coastal observations, warnings, radar, satellite, ocean model maps | none |
| NOAA MADIS | `/noaa` atlas | QC surface/mesonet/aircraft observation context | public + restricted tiers |
| NASA GIBS / Worldview | `server/satellite.ts` | MODIS / VIIRS true-color, fire/smoke, snow, SST snapshots | none |
| NASA EONET | `server/eonet.ts` | Near-real-time global natural-event feed | none |
| CelesTrak GP | `server/orbits.ts` | Live satellite positions via SGP4 propagation | none |
| Element84 Earth-Search STAC | `server/satellite.ts` | Sentinel-2 + Landsat latest cloud-filtered scenes | none |
| Copernicus Data Space | `server/satellite.ts` | Sentinel-1/2 viewer deep links | none for browser |
| USGS Landsat Look | `server/satellite.ts` | Landsat archive viewer deep links | none for browser |
| Sentinel Hub EO Browser | `server/satellite.ts` | Sentinel/Landsat viewer deep links | free account |
| Zoom Earth | `server/satellite.ts` | Live satellite mosaic deep links | none |
| EOSDA LandViewer | `server/satellite.ts` | Multi-source imagery viewer deep links | free account |

## Features

- **Live network globe** — 918 stations, colour-coded by live scan status
- **Per-station drill panel** — FAA WeatherCam + NEXRAD + GOES satellite
  triple, plus **Site Hazards** (quakes + tropical + nearest buoy +
  CO-OPS coastal context + NOTAMs)
- **NOAA Source Atlas** — live, ready-next, keyed, and research feeds across
  NOAA/NWS/NESDIS/NOS/NCEP/NCEI plus GitHub modernization targets
- **Live global event feed** — NASA EONET v3 open wildfires, severe storms,
  volcanoes, ice, floods, dust, and related hazards on the Summary screen
- **Live orbital assets** — CelesTrak GP/TLE + SGP4 propagated ISS, NOAA,
  NASA, USGS, Copernicus, and GOES positions with public imagery links
- **Evidence packages** — station CSV, Markdown brief, and JSON manifest
  builders for reporting and incident handoff
- **Command palette** — press `⌘K` / `Ctrl+K` (or `/`) to search stations
  and jump to tabs
- **AI NOC briefing** — Azure OpenAI generates a 3-paragraph shift-change
  brief from live scan + active SIGMETs
- **Professional dark theme** — no neon, no scanlines, no gimmicks;
  WCAG AA contrast throughout

## Local dev

```bash
npm install
npm run dev           # http://localhost:3000
npm run typecheck     # strict TS check
npm run build         # production bundle
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
  --target-port 3000
```

Returns a public URL like
`https://asos-tools-ui.<random>.eastus.azurecontainerapps.io`.

No `OWL_API_BASE` env var is required anymore — the backend is built in.

## Env vars

| Name | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | no | Absolute origin for server-component fetches (defaults to `http://localhost:3000`). Set to your public URL in production. |
| `AZURE_OPENAI_*`       | only for AI Brief | Azure OpenAI connection for the `/api/ai-brief` endpoint |
| `FAA_NOTAM_CLIENT_ID`  | no | Enables per-station NOTAM correlation |
| `FAA_NOTAM_CLIENT_SECRET` | no | Paired with the above |
| `IEM_API_BASE`         | no | Testing override for the IEM endpoint |
| `AWC_API_BASE`         | no | Testing override for the AWC endpoint |

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open command palette |
| `/`             | Open command palette |
| `↑` / `↓`       | Navigate results |
| `Enter`         | Jump to result |
| `Esc`           | Close palette |

## Licence

MIT.
