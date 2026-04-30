# OWL Status — Fidelity Build

> A drop-in replacement for James Glenn's NWS Systems Status Map
> Apps Script. **Identical front-end** (his exact HTML/CSS/JS, byte-
> for-byte), with a **rebuilt back-end** that pulls METAR data from
> live NOAA APIs instead of a manually-curated Google Sheet column.

## ⚠ The single most important change

**This build no longer reads METAR data from a Google Sheet.**

The legacy app's primary failure mode was that ASOS "Last Observation"
data was sourced from a sheet column (PIDS Col AX) that humans or a
separate export job had to keep refreshed. METARs were minutes-to-hours
stale by design.

In this build:

| Data | Legacy source | This build |
|---|---|---|
| ASOS METAR ("Last Ob") | PIDS Col AX (sheet) | **Live IEM batch CGI**, 5-min refresh |
| Status classification | PIDS Col AP (sheet, hand-edited) | **Computed live** from the METAR + 6-hour state log |
| Outage cause / `$` flag detail | PIDS Col AS (sheet free-text) | **Decoded from the METAR's NO-codes** (PWINO, FZRANO, RVRNO, etc.) |
| Service backup, patching, backup-target | PIDS Cols AT/AU/AV (sheet) | Not populated *(those PIDS fields don't have an API equivalent)* |
| WWA list popup | NWS Active WWA (by Site) sheet | **Live NWS CAP alerts** |
| Banners | Banner workbook | Optional `Banners` tab (operator-editable) |
| Long-missing site list | Not in legacy | **New** — auto-detected from the live scan, every station silent > 14 days |

If a sheet column was the source of truth in the legacy app, **this
build does not read it**. The only sheets we touch are the ones the
script writes to itself for state persistence (`Health`, `History`,
`StateLog`, `ActiveUsers`, `UserHistory`, `Banners`) — all auto-
created on first run, all internal to this script.

> **Operator UX is unchanged.** Every map, popup, filter, button, and
> overlay looks the same as before. The data behind them is just live
> now.

## What's new in the back-end

(See the table above for the full sheet → API mapping.)

- **Live IEM batch CGI** for METAR fetch (5-min refresh)
- **AWC fallback** for any station IEM didn't return in a batch
- **NCEI cross-check** validates against the authoritative archive
  (maintenance-window aware)
- **SUAD-spec INTERMITTENT classifier** with persistent 6-hour state
  log — flapping/recovery patterns surface correctly
- **Decoded $-flag NO-codes** (PWINO / FZRANO / RVRNO / TSNO / PNO /
  VISNO / CHINO / SLPNO) — feeds into the existing popup
- **Long-missing alert tier** for stations silent > 14 days
- **WWA list** populated from live NWS CAP alerts (no sheet upkeep)

The legacy enum (`Up` / `Down` / `Degraded` / `Patching`) renders
exactly as before. Internally we use the SUAD-spec enum
(`CLEAN` / `FLAGGED` / `MISSING` / `INTERMITTENT` / etc.) and
translate via `ourEnumToLegacy_()` before returning to his client.

## File layout

This is a **multi-file Apps Script project** — same structure as
the legacy app. All 13 of his HTML files are unmodified. Only
`Code.gs` and `appsscript.json` differ.

```
gas-fidelity/
├── Code.gs              ~2,200 lines · backend + bridge functions
├── appsscript.json      manifest
│
├── Index.html           his exact file (unmodified)
├── JavaScript.html      his exact file (unmodified)
├── Css.html             his exact file (unmodified)
├── Admin.html           his exact file (unmodified)
├── About.html           his exact file (unmodified)
├── RFC.html             his exact file (unmodified)
├── CWSU.html            his exact file (unmodified)
├── WFO.html             his exact file (unmodified)
├── MCC.html             his exact file (unmodified)
├── Region.html          his exact file (unmodified)
├── Radar.html           his exact file (unmodified)
├── WWA.html             his exact file (unmodified)
└── Timezones.html       his exact file (unmodified)
```

## Deploy procedure

You'll be pasting 15 files into an Apps Script project. ~5 minutes.

### 1. Create the Sheet

Go to <https://sheets.new>, name it "NWS Systems Status" or similar.
The script auto-creates the tabs it needs (`Health`, `History`,
`StateLog`, `ActiveUsers`, `UserHistory`, `Banners`).

Optional: pre-create a `Catalog` sheet with three columns —
`A=ICAO`, `B=lat`, `C=lon` — to override the built-in 30-station
shortlist. Otherwise we ship with 30 majors covering CONUS+AK+HI.

### 2. Open the bound Apps Script

**Extensions → Apps Script**. The editor opens with an empty
`Code.gs`.

### 3. Paste `Code.gs`

- Click the existing `Code.gs` file in the left rail.
- Select all (`⌘A` / `Ctrl+A`), delete.
- Open this folder's `Code.gs`, copy its contents.
- Paste into the editor.
- Save (`⌘S` / `Ctrl+S`).

### 4. Paste `appsscript.json`

- Project Settings (gear ⚙ icon, left rail) → enable
  *"Show 'appsscript.json' manifest file in editor"*.
- Back to the Editor (`< >` icon).
- Click `appsscript.json` in the file list.
- Replace contents with this folder's `appsscript.json`. Save.

### 5. Add each HTML file

For each of the 13 HTML files (Index, JavaScript, Css, Admin,
About, RFC, CWSU, WFO, MCC, Region, Radar, WWA, Timezones):

1. In the Apps Script file list, click the **`+`** next to "Files"
   → **HTML**.
2. Name it exactly the file's base name (no `.html` extension —
   Apps Script adds it automatically). E.g. `Index`, `JavaScript`,
   `Css`, etc. **Case matters** — match exactly.
3. Open the corresponding file from this folder, copy its full
   contents.
4. Paste into the new Apps Script HTML file. Save.

When done, your file list should look like:

```
Files
├── Code.gs
├── appsscript.json
├── Index.html
├── JavaScript.html
├── Css.html
├── Admin.html
├── About.html
├── RFC.html
├── CWSU.html
├── WFO.html
├── MCC.html
├── Region.html
├── Radar.html
├── WWA.html
└── Timezones.html
```

### 6. Set Script Properties

Project Settings → Script Properties → **Add script property**:

| Required | Property | Value |
|---|---|---|
| ✅ | `OWL_CONTACT` | your email (e.g. `cody.churchwell@noaa.gov`) — embedded in the User-Agent NWS APIs require |

Optional:

| Property | Value |
|---|---|
| `DIGEST_RECIPIENTS` | comma-separated emails for 4-hourly status digest |
| `AIRNOW_API_KEY` | free key from <https://docs.airnowapi.org/> |
| `ASOS_STATIONS` | comma-separated ICAO list to override the built-in 30-station shortlist |
| `ADMIN_EMAILS` | comma-separated allow-list for `/exec?path=admin` |
| `NCEI_MAINT_START`, `NCEI_MAINT_END` | ISO timestamps to override the built-in maintenance window |

### 7. Authorize + install triggers

- Function dropdown (top toolbar, next to ▶ Run) → pick
  **`installTriggers`** → click **Run**.
- Google asks to **Review permissions**. Pick your account.
- "Google hasn't verified this app" → **Advanced → Go to (unsafe)**
  → **Allow**.
- Execution log shows `Installed: runScan/5min, runHazards/10min,
  runDigest/4h, rotateLogs/daily`.

### 8. Force the first scan

- Function dropdown → **`runScan`** → **Run**.
- Wait ~30 seconds — Execution log says `completed`.
- Open another tab and visit
  `https://script.google.com/d/<SCRIPT_ID>/exec?api=health` — should
  return JSON with `status: "ok"`.

### 9. Deploy as Web app

- **Deploy → New deployment**.
- Gear icon next to "Select type" → **Web app**.
- Description: `OWL Status — Fidelity Build`.
- Execute as: **Me**.
- Who has access: **Anyone with Google account** (or **Anyone in
  your Workspace** for tighter scope).
- Click **Deploy**, copy the `/exec` URL.

That URL serves James Glenn's exact map UI, populated with live API
data from our backend.

## Server functions the front-end expects

His JavaScript.html and overlay HTML files call these via
`google.script.run` / `callServer_`. All are defined in `Code.gs` §12:

| Function | What it returns | Source in our backend |
|---|---|---|
| `getPointsPayload(pass, force)` | GeoJSON FeatureCollection wrapped in his expected shape with `ok`, `features`, `banners`, `wwaWfos`, `expirationTimestamp`, etc. | `readScanCache_()` — live IEM/AWC METAR scan |
| `getWfoGeojsonText()` | WFO footprint GeoJSON | Drive file lookup; empty FeatureCollection if absent |
| `getRfcGeojsonText()` | RFC footprint GeoJSON | Drive file lookup; empty FeatureCollection if absent |
| `getCwsuGeojsonText()` | CWSU footprint GeoJSON | Drive file lookup; empty FeatureCollection if absent |
| `getMccGeojsonText()` | MCC footprint GeoJSON | Drive file lookup; empty FeatureCollection if absent |
| `getRegGeojsonText()` | NWS Region GeoJSON | Drive file lookup; empty FeatureCollection if absent |
| `getWwaListChunk(offset, limit)` | Paginated WWA list rows | Live NWS CAP alerts |
| `getWwaListTablePage(offset, limit)` | Same, alternate signature his older client uses | Same as above |

If you want the polygon overlays (RFC / CWSU / WFO / MCC / Region)
to render: drop the GeoJSON files in your Google Drive root with the
filenames `rfc.geojson`, `cwsu.geojson`, `wfo.geojson`, `mcc.geojson`,
`region.geojson`. The script's Drive lookup picks them up
automatically. Without those files the overlay toggles still work
but render no geometry.

## Status enum mapping

His client renders four colors for the legacy enum. Our backend
internally uses the SUAD-spec enum and translates before returning:

| Our enum (internal) | Legacy enum (rendered) | Color |
|---|---|---|
| `CLEAN` | `Up` | green |
| `RECOVERED` | `Up` | green |
| `FLAGGED` | `Degraded` | yellow |
| `INTERMITTENT` | `Degraded` | yellow |
| `MISSING` | `Down` | red |
| `OFFLINE` | `Down` | red |
| `NO DATA` | `Down` | red |

The internal SUAD-spec enum is also exposed on each feature's
properties as `owl_status` (string), `owl_state_log` (array),
`owl_flag_codes` (array), and `owl_evidence` (object) — his client
ignores these but they're there for any future popup enhancements.

## Iterating

Code edits in the editor take effect for the next trigger run
immediately. The Web app URL is pinned to a deployment version —
to update the public URL, **Deploy → Manage deployments → ✎ →
Version: New version → Deploy**.

For local development with `clasp`:

```bash
npm install -g @google/clasp
clasp login
clasp clone <SCRIPT_ID>
clasp push --watch       # auto-push on save
clasp logs --watch       # tail logs in real time
```

## What's NOT changed from his original

- Visual layout
- Sidebar (filters, regions, programs, overlays, search)
- Map (Esri ArcGIS JavaScript API, his exact basemap, his exact
  popup template)
- Admin page (counters, active users, history table)
- About page
- WFO/RFC/CWSU/MCC/Region/Radar/WWA/Timezones overlay templates
- Header (current time, last updated, refresh timer)
- Banner area
- Down sites table
- Type breakdown
- Right sidebar
- All keyboard shortcuts

Operators trained on the legacy app will see no functional
difference except: data is fresh, and the cause of any anomaly
shows up in the popup with decoded NO-codes.

## Author

Cody Churchwell — `cody.churchwell@noaa.gov`
NOAA / National Weather Service — SUAD / ASOS Operations
