# OWL × NWS Systems Status — Unified Single-File Apps Script

A single self-contained Google Apps Script (`Code.gs` + `appsscript.json`)
that replaces James Glenn's multi-file System Outage Map project with
**live API data sources, the SUAD-spec INTERMITTENT classifier, full
OWL hazard aggregation, and a 12-section AI brief generator**.

> **TL;DR**: paste two files into a fresh Apps Script project, set 4
> Script Properties, run `installTriggers()` once, deploy as a Web app.
> Total time: 5 minutes.

## What this replaces

The legacy project read METAR data from a manually-maintained Google
Sheet column (PIDS Col AX). That data was minutes-to-hours stale and
required constant human upkeep. There was no $-flag decoding, no
INTERMITTENT detection beyond a sheet column, no comprehensive
hazard aggregation, no AI brief.

## What this fixes

| Legacy approach | Unified Apps Script |
|---|---|
| `Last Ob` from sheet Col AX | **Live IEM batch CGI**, 60-second cycle |
| (none) | **AWC METAR fallback** for IEM-orphaned stations |
| (none) | **NCEI cross-check** with maintenance-window awareness |
| `STATUS` from sheet Col AP | **SUAD-spec classifier** with 6-hour state log |
| Generic "$ flag" | **Decoded NO-codes** (PWINO, FZRANO, RVRNO, …) |
| (none) | **Long-missing alert** for stations silent > 14 days |
| 9 separate `.html` files | **Inline HTML templates** in one Code.gs |
| Local SIGMETs only | **CAP + SIGMET + G-AIRMET + CWA + NHC + Tsunami + NIFC + NCEP SDM** |
| (none) | **AI Brief generator** (12-section, audience-tunable) |

## Files

```
gas-unified/
├── Code.gs              ~2 100 lines, all backend + inline HTML/CSS/JS
├── appsscript.json      manifest (V8, web-app config, OAuth scopes)
└── README.md            this file
```

## Deploy in 5 minutes

### 1. Create a Google Sheet

Visit <https://sheets.new>, rename it (e.g. **OWL Status**). The
script auto-creates the tabs it needs (`Health`, `History`, `Briefs`,
`StateLog`, `ActiveUsers`, etc.). You can also pre-create a `Catalog`
tab with ICAO codes in column A to override the built-in 30-station
shortlist.

### 2. Open the bound Apps Script

Sheet → **Extensions → Apps Script**. Replace the default `Code.gs`
content with the entire contents of `gas-unified/Code.gs`.

### 3. Add the manifest

Project Settings (gear icon) → toggle **"Show appsscript.json
manifest file in editor"**. Open `appsscript.json` and replace its
contents with `gas-unified/appsscript.json`.

### 4. Set Script Properties

Project Settings → **Script Properties** → **Add script property**:

| Key | Required? | Example |
|---|---|---|
| `OPENAI_API_KEY` | yes (for AI brief) | `ollama_xxxxx…` |
| `OPENAI_BASE_URL` | yes | `https://ollama.com/v1` |
| `AI_BRIEF_MODEL` | yes | `glm-5.1` |
| `OWL_CONTACT` | yes | `you@noaa.gov` (used in NWS UA) |
| `BRIEF_RECIPIENTS` | optional | `you@noaa.gov,ops@noaa.gov` |
| `AIRNOW_API_KEY` | optional | free key from airnowapi.org |
| `ASOS_STATIONS` | optional | `KJFK,KLGA,KEWR,KBOS,…` (overrides shortlist) |
| `ADMIN_EMAILS` | optional | `you@noaa.gov` (whoever can hit /admin) |
| `NCEI_MAINT_START` | optional | ISO timestamp; defaults to today's published window |
| `NCEI_MAINT_END` | optional | ISO timestamp |

### 5. Authorize + install triggers

In the Apps Script editor:

1. Pick the **`installTriggers`** function from the dropdown next to **Run**
2. Click **Run**
3. Google's OAuth flow will fire — click **Review permissions** →
   pick your account → **Advanced → Go to OWL (unsafe)** → **Allow**.
   (The "unsafe" warning is the standard message for any non-Google-
   verified script. Inspect the scopes in `appsscript.json` first if
   you want to verify.)
4. After auth, `installTriggers()` runs — it removes any prior
   triggers and installs the standard schedule:
   - `runScan` every 5 minutes
   - `runHazards` every 10 minutes
   - `runDigest` every 4 hours (only sends mail if `BRIEF_RECIPIENTS` is set)
   - `rotateLogs` daily at 03:00

### 6. Deploy as Web app

**Deploy → New deployment** → click the gear → **Web app**:

- Description: `OWL Status v1`
- Execute as: **Me**
- Who has access: **Anyone** (or **Anyone with Google account** /
  **Anyone in your Workspace** to scope tighter)

Click **Deploy**, copy the `/exec` URL. That's your status page.

### 7. Verify

Open the `/exec` URL — within ~5 minutes the counter strip populates
and the lists fill in. Direct API checks:

```bash
URL="https://script.google.com/macros/s/AKfycb…/exec"

curl -s "$URL?api=health"        | jq .
curl -s "$URL?api=scan"          | jq '.counts, .total'
curl -s "$URL?api=missing"       | jq '.counts'
curl -s "$URL?api=intermittent"  | jq '.count, .definition'
curl -s "$URL?api=hazards"       | jq '{cap:.cap_alerts.total, sigmet:.aviation.sigmet_count, gairmet:.aviation.gairmet_count, fires:.wildfires|length}'

# AI brief — POST with audience/horizon/length
curl -s -X POST "$URL?api=brief" \
  -H 'content-type: application/json' \
  -d '{"audience":"noc","horizon":"now","length":"standard"}' | jq -r .text
```

## Web-app routes

The web app serves HTML at the root and JSON when `?api=` is set.

| URL | Renders |
|---|---|
| `/exec` | Main map UI: counters + top problems + INTERMITTENT + long-missing + hazards + AI brief |
| `/exec?path=admin` | Admin dashboard: every count, every long-missing alert, every cross-check disagreement |
| `/exec?path=about` | Status definitions + data sources |
| `/exec?api=health` | JSON health check |
| `/exec?api=scan` | JSON scan results (920 stations + state_log + flag_codes) |
| `/exec?api=hazards` | JSON aggregated hazards |
| `/exec?api=missing` | JSON missing-stations buckets (3d / 1wk / 2wk / all) |
| `/exec?api=intermittent` | JSON SUAD-spec intermittent list |
| `/exec?api=brief` (POST) | AI brief — body params: focus, audience, horizon, length |

## Status definitions (built into `/about` page)

| Status | Definition | Triage |
|---|---|---|
| **CLEAN** | Latest METAR present, no $ flag, ≤ 1 missing hourly bucket | No action |
| **FLAGGED** | Latest METAR carries $ flag — decoded NO-codes (PWINO, FZRANO, RVRNO …) tell field techs which sensor | Open ticket per NO-code |
| **MISSING** | Silent ≥ 75 minutes (one hourly cycle + 15-min grace) | Watch next scheduled report; escalate at 2 h |
| **OFFLINE** | Decommissioned per catalog (`archive_end` > 14 days past) | Confirm decommission with maintenance |
| **INTERMITTENT** | *SUAD-spec*: log shows ≥ 3 consecutive MISSING hours then recovery. **FLAGGED→OK does NOT count** | Open comm ticket — likely modem / satellite path |
| **RECOVERED** | Was FLAGGED earlier, last 2 reports clean | Note recovery; treat as chronic if it re-flags within 24 h |
| **NO DATA** | Pre-first-scan placeholder | Wait one scan cycle |

## Hazard sources

Every source catches its own errors. Stale/failed sources surface in
`stale_sources` so the AI brief and the admin tab can caveat data
freshness rather than confidently hallucinate.

| Source | Endpoint | Used for |
|---|---|---|
| NWS api.weather.gov | `/alerts/active` | Active CAP alerts |
| NWS api.weather.gov | `/products/types/ADASDM/locations/KWNO` | NCEP Senior Duty Meteorologist admin bulletins |
| AWC | `/api/data/airsigmet` | SIGMETs + AK AIRMETs |
| AWC | `/api/data/gairmet` | CONUS G-AIRMETs (replaces text AIRMETs since Jan 2025) |
| AWC | `/api/data/cwa` | Center Weather Advisories |
| AWC | `/api/data/metar` | Per-station fallback for IEM orphans |
| NHC | `/CurrentStorms.json` | Active tropical cyclones |
| Tsunami.gov | NTWC + PTWC Atom feeds | Active tsunami bulletins |
| NIFC | WFIGS ArcGIS FeatureServer | Active US wildfires |
| IEM | `/cgi-bin/request/asos.py` | Primary METAR batch |
| NCEI | `/access/services/data/v1` | Cross-check (maintenance-aware) |

## Operating

### Run something on demand

In the Apps Script editor, pick the function from the dropdown and
click **Run**:

- `runScan` — force a fresh scan
- `runHazards` — refresh the hazard cache
- `runDigest` — send the AI brief email immediately
- `testHealth` / `testScan` / `testHazards` / `testBrief` — debug helpers (output to View → Logs)
- `showWebAppUrl` — print the deployed URL to logs

### Adjust thresholds

Edit the constants at the top of `Code.gs`:

```js
var MISSING_SILENCE_MIN      = 75;   // minutes silent before MISSING
var INTERMITTENT_MISSING_RUN = 3;    // consecutive MISSING hours for INTERMITTENT
var STATE_LOG_HOURS          = 6;    // state log depth per station
var OFFLINE_GRACE_DAYS       = 14;   // catalog archive_end → OFFLINE
```

Save → re-run `installTriggers()` if you also changed cadences.

### Switch the AI model

Change `AI_BRIEF_MODEL` in Script Properties. The script speaks the
OpenAI-compatible chat-completions API — Ollama Cloud, OpenAI direct,
Anthropic-via-OpenAI-shim, or any local Ollama all work.

### Use the full ASOS network instead of the 30-station shortlist

Add a Script Property `ASOS_STATIONS` with a comma-separated ICAO
list (or upload a `Catalog` sheet with ICAO codes in column A). At
920 stations the scan takes ~60 s per cycle (12 IEM batches × 5 s
spacing).

## Architecture (file layout inside `Code.gs`)

```
1.  CONFIG               PROP/PROPN/PROPB accessors, UA, NCEI window
2.  STATION CATALOG      30-station shortlist + override mechanisms
3.  HTTP UTILITIES       fetchJson_/fetchText_ with retries + UA
4.  METAR FETCH          IEM batch + AWC orphan rescue
5.  CLASSIFIER           SUAD-spec rules + decoded NO-codes
6.  STATE LOG PERSIST    per-station 6-hour rolling log in Sheet
7.  NCEI CROSS-CHECK     maintenance-aware second-source validation
8.  HAZARD SOURCES       CAP / SIGMET / G-AIRMET / CWA / NHC /
                         Tsunami / NIFC / NCEP SDM
9.  AI BRIEF             context aggregator + 12-section prompt
10. SCAN ORCHESTRATION   runScan / runHazards / runDigest
11. WEB APP ROUTES       doGet / doPost + path-style API
12. HTML TEMPLATES       inline Index / Admin / About + CSS + JS
13. TRIGGERS             install / remove / rotate
14. ENTRY POINTS         onOpen menu + test helpers
```

## Troubleshooting

**Authorization is required to perform that action.**
You skipped step 5. Run `installTriggers` from the editor and
complete the OAuth flow.

**`runScan` runs but the counter strip stays empty.**
Open Executions (left rail clock icon), click the failed run, read
the logged HTTP status. Most common: `OPENAI_API_KEY` not set OR
`OWL_CONTACT` missing (NWS rejects requests without a contact-
bearing User-Agent).

**`/exec?api=brief` returns "[AI Brief unavailable …]"**
`OPENAI_API_KEY` isn't set in Script Properties. The brief endpoint
catches the missing-key case and returns a clear message rather than
500'ing.

**6-minute timeout on `runScan`.**
The 920-station full network is at the edge of Apps Script's per-run
budget (12 IEM batches × 5 s spacing = 60 s; classifier overhead +
sheet writes ≈ another 30 s). The 30-station shortlist runs in ~6 s.
Split the catalog if you need >900 stations.

**The state log doesn't seem to be persisting INTERMITTENT
classifications.**
Check the `StateLog` sheet — every scan should rewrite it. If the
sheet has fewer rows than expected, run `runScan` from the editor
and check Executions for write errors.

## What's NOT in this script (yet)

- USDM drought, AirNow AQI, NWPS flood gauges (wired in OWL but not
  yet ported here — they would each be ~50-line additions to
  section 8). Add them with the existing pattern: `fetchUsdm_()`,
  `fetchAirNow_(lat, lon)`, `fetchNwps_(lat, lon)`, then include in
  `buildHazardContext_()`.
- WWA polygon overlay (the legacy project loaded a 45-MB ArcGIS
  feature service into a separate iframe). The unified script
  exposes `?api=hazards.cap_alerts.sample` which is the same data
  in a much smaller form.
- MapLibre/ArcGIS map. The unified UI is dashboard-focused — for a
  full map view, embed an `<iframe>` to your existing OWL deployment
  in the Index template, or extend section 12 with a MapLibre
  `<div>` and a tile source.
- Active-Users tracking (legacy had a heartbeat sheet). Easy add:
  one `appendActiveUser_()` call from `boot()` POSTing to
  `?api=heartbeat`.

If you want any of these wired in, the patterns are documented inline
in `Code.gs` — most additions are 50-100 lines.
