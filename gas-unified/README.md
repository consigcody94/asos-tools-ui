# OWL × NWS Systems Status — Unified Single-File Apps Script

> 📦 **Standalone repo**: this same code is mirrored at
> [`consigcody94/owl-status-apps-script`](https://github.com/consigcody94/owl-status-apps-script)
> if you want to clone just the Apps Script piece without the rest of
> the OWL Next.js codebase.

A single self-contained Google Apps Script (`Code.gs` +
`appsscript.json`) that replaces James Glenn's multi-file System
Outage Map project with **live API data sources, the SUAD-spec
INTERMITTENT classifier, full OWL hazard aggregation, an embedded
MapLibre map view, and active-user heartbeat tracking**.

> **TL;DR**: paste two files into a fresh Apps Script project, set
> one required Script Property (`OWL_CONTACT`), run
> `installTriggers()` once, deploy as a Web app. Total time:
> 5 minutes.

> 📖 **Step-by-step walkthrough + local-testing-via-clasp:** see
> [HOWTO.md](./HOWTO.md).

## What this replaces

The legacy project read METAR data from a manually-maintained Google
Sheet column (PIDS Col AX). That data was minutes-to-hours stale and
required constant human upkeep. There was no $-flag decoding, no
INTERMITTENT detection beyond a sheet column, no comprehensive
hazard aggregation.

## What this fixes

| Legacy approach | Unified Apps Script |
|---|---|
| `Last Ob` from sheet Col AX | **Live IEM batch CGI**, 5-min cycle |
| (none) | **AWC METAR fallback** for IEM-orphaned stations |
| (none) | **NCEI cross-check** with maintenance-window awareness |
| `STATUS` from sheet Col AP | **SUAD-spec classifier** with 6-hour state log persisted in a Sheet |
| Generic "$ flag" | **Decoded NO-codes** (PWINO, FZRANO, RVRNO, TSNO, PNO, VISNO, CHINO, SLPNO) |
| (none) | **Long-missing alert** for stations silent > 14 days, unbounded list |
| 9 separate `.html` files | **Inline HTML/CSS/JS templates** in one Code.gs |
| Local SIGMETs only | **11-source hazard aggregation** (see below) |
| (none) | **MapLibre map** with click-to-drill popups + satellite basemap toggle |
| (none) | **Active-Users heartbeat** tracking (concurrent + history) |
| (none) | **Plain-text status digest email** every 4 h (no LLM) |

## Files

```
gas-unified/
├── Code.gs              2 328 lines · 145 KB · all logic + inline templates
├── appsscript.json      manifest (V8, web-app config, OAuth scopes)
├── README.md            this file (architecture overview)
└── HOWTO.md             5-min step-by-step deploy + local-testing-via-clasp
```

## Hazard sources

Every fetch is wrapped in catch — one stale source never blocks the
whole context. Stale sources surface in the response's
`stale_sources` array.

| Source | Endpoint | Used for |
|---|---|---|
| NWS api.weather.gov | `/alerts/active` | Active CAP alerts grouped by event/severity |
| NWS api.weather.gov | `/products/types/ADASDM/locations/KWNO` | NCEP SDM administrative bulletins (network-wide outages) |
| AWC | `/api/data/airsigmet` | SIGMETs + Alaska text AIRMETs |
| AWC | `/api/data/gairmet` | CONUS G-AIRMETs (replaces text AIRMETs since Jan 2025) |
| AWC | `/api/data/cwa` | Center Weather Advisories |
| AWC | `/api/data/metar` | Per-station fallback for IEM orphans |
| NHC | `/CurrentStorms.json` | Active tropical cyclones |
| Tsunami.gov | NTWC + PTWC Atom feeds | Active tsunami bulletins |
| NIFC | WFIGS ArcGIS FeatureServer | Active US wildfires |
| **USDM** | `droughtmonitor.unl.edu/data/json/usdm_current.json` | Weekly drought severity |
| **EPA AirNow** | `/aq/observation/latLong/current/` | Per-coordinate AQI + dominant pollutant |
| **NWPS** | `api.water.noaa.gov/nwps/v1/...` | Nearest river gauge + flood-stage forecast |
| IEM | `/cgi-bin/request/asos.py` | Primary METAR batch |
| NCEI | `/access/services/data/v1` | Cross-check (maintenance-aware) |

## Web-app routes

| URL | Returns |
|---|---|
| `/exec` | **Map dashboard**: counters + MapLibre map + top problems + INTERMITTENT + long-missing + hazards summary |
| `/exec?path=admin` | Admin dashboard: every long-missing alert, every flagged station with NO-codes, drought summary, active users |
| `/exec?path=about` | Status definitions + data source list |
| `/exec?api=health` | JSON health |
| `/exec?api=scan` | JSON scan results (state_log, flag_codes, evidence) |
| `/exec?api=missing` | JSON missing buckets (3d / 1wk / 2wk / all) |
| `/exec?api=intermittent` | JSON SUAD-spec list with state-log patterns |
| `/exec?api=hazards` | JSON aggregated 11-source hazards |
| `/exec?api=users` | JSON active/unique user counts |
| `/exec?api=usdm` | JSON USDM drought summary |
| `/exec?api=airnow&lat=&lon=` | JSON AirNow AQI (needs `AIRNOW_API_KEY`) |
| `/exec?api=nwps&lat=&lon=` | JSON nearest river gauge + flood stages |
| `/exec?api=heartbeat` (POST) | Logs an active-user heartbeat |

## Status definitions

| Status | Definition | Triage |
|---|---|---|
| **CLEAN** | Latest METAR present, no $ flag, ≤ 1 missing hourly bucket | No action |
| **FLAGGED** | Latest METAR carries $ flag — decoded NO-codes (PWINO, FZRANO, RVRNO …) tell field techs which sensor | Open ticket per NO-code |
| **MISSING** | Silent ≥ 75 minutes (one hourly cycle + 15-min grace) | Watch next scheduled report; escalate at 2 h |
| **OFFLINE** | Decommissioned per catalog (`archive_end` > 14 days past) | Confirm decommission with maintenance |
| **INTERMITTENT** | *SUAD-spec*: log shows ≥ 3 consecutive MISSING hours then recovery. **FLAGGED→OK does NOT count** | Open comm ticket — likely modem / satellite path |
| **RECOVERED** | Was FLAGGED earlier, last 2 reports clean | Note recovery; treat as chronic if it re-flags within 24 h |
| **NO DATA** | Pre-first-scan placeholder | Wait one scan cycle |

## Architecture (sections inside `Code.gs`)

```
1.  CONFIG               PROP/PROPN/PROPB accessors, UA, NCEI window
2.  STATION CATALOG      30-station shortlist + lat/lon table
3.  HTTP UTILITIES       fetchJson_/fetchText_ with retries + UA
4.  METAR FETCH          IEM batch + AWC orphan rescue
5.  CLASSIFIER           SUAD-spec rules + decoded NO-codes
6.  STATE LOG PERSIST    per-station 6-hour rolling log in Sheet
7.  NCEI CROSS-CHECK     maintenance-aware second-source validation
8.  HAZARD SOURCES       CAP / SIGMET / G-AIRMET / CWA / NHC /
                         Tsunami / NIFC / USDM / AirNow / NWPS /
                         NCEP SDM
9.  ACTIVE-USERS         Heartbeat tracking + concurrent count
10. SCAN ORCHESTRATION   runScan / runHazards / runDigest (status email)
11. WEB APP ROUTES       doGet / doPost + path-style API
12. HTML TEMPLATES       inline Index (with MapLibre) / Admin / About
13. TRIGGERS             install / remove / rotate
14. ENTRY POINTS         onOpen menu + test helpers
```

## Quick deploy

Full guide in [HOWTO.md](./HOWTO.md). Short version:

1. Create a Google Sheet (any name).
2. **Extensions → Apps Script** → paste `Code.gs` + `appsscript.json`.
3. **Project Settings → Script Properties** → add `OWL_CONTACT`
   (your email).
4. Run `installTriggers` from the function dropdown — authorize.
5. **Deploy → New deployment** → Web app, Execute as Me, Anyone.

## Local development with clasp

```bash
npm install -g @google/clasp
clasp login
cd gas-unified
clasp clone <your-script-id>
# edit Code.gs locally
clasp push                    # ship to Google
clasp run testScan            # test from CLI
clasp logs --watch            # tail logs
```

Full clasp instructions in [HOWTO.md § 9](./HOWTO.md#9-local-testing-via-clasp).

## Optional Script Properties

Beyond the required `OWL_CONTACT`:

| Property | What it enables |
|---|---|
| `DIGEST_RECIPIENTS` | 4-hourly status digest email (plain text, no LLM) |
| `AIRNOW_API_KEY` | AQI lookups via `?api=airnow` |
| `ASOS_STATIONS` | Override the built-in 30-station shortlist |
| `ADMIN_EMAILS` | Reserved for admin-route gating (not enforced today) |
| `NCEI_MAINT_START` / `NCEI_MAINT_END` | Override the published maintenance window |

## What's NOT in this script

By deliberate scope choices:

- **AI Brief / LLM integration** — removed in v3.36. The 4-hourly
  status email is now plain-text data only.
- **Full WWA polygon overlay** — the legacy 45-MB ArcGIS feature
  service was a memory hog. We expose the same alerts as
  `?api=hazards.cap_alerts.sample` in much smaller form.
- **Drill panel for individual stations** — clicking a station in
  the map opens a popup with status + reason; full per-station
  drill is out of scope here. (OWL's TypeScript build at
  `app/summary-client.tsx` has the full drill panel.)
- **Auth-gated admin** — `ADMIN_EMAILS` is reserved but not enforced.
  If you need real auth, deploy with **Anyone in your Workspace** and
  rely on Google's domain check.
