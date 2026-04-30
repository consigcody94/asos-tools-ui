# OWL × NWS Systems Status — Step-by-Step HOW-TO

Walks you through deploying the unified Apps Script from zero, then
testing it both inside Apps Script's UI **and** locally via `clasp`.

> If you've already deployed once and just need the quick redeploy
> commands, jump to **§ 8 Iteration loop**.

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Create the Apps Script project](#2-create-the-apps-script-project)
3. [Paste the code](#3-paste-the-code)
4. [Set Script Properties](#4-set-script-properties)
5. [Authorize + install triggers](#5-authorize-install-triggers)
6. [Deploy as a Web app](#6-deploy-as-a-web-app)
7. [Test from Apps Script's UI](#7-test-from-apps-scripts-ui)
8. [Iteration loop](#8-iteration-loop)
9. [Local testing via clasp](#9-local-testing-via-clasp)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

You need:

- A Google account (the one that will own the Apps Script project + receive triggers)
- A web browser
- *Optional but recommended for iteration:* Node.js ≥ 16 + `npm` for the `clasp` workflow in § 9

That's it. No GCP project, no service accounts, no third-party SaaS
account, no `gcloud` CLI.

## 2. Create the Apps Script project

You have two options. Pick A unless you have a strong reason for B.

### A. Sheet-bound (recommended)

A bound Apps Script lives "inside" a Google Sheet — that sheet
becomes the data store for the State Log, History, ActiveUsers,
Health snapshots, and (optionally) the station catalog.

1. Visit <https://sheets.new> — gives you a fresh Google Sheet.
2. Rename the sheet (e.g. **OWL Status**). The script auto-creates
   the tabs it needs (`Health`, `History`, `StateLog`, `ActiveUsers`,
   `UserHistory`).
3. **Extensions → Apps Script** to open the bound editor.

### B. Standalone

Use this only if you want the script independent of any sheet (e.g.
multi-team deploys with separate sheets per team).

1. Visit <https://script.google.com/home/projects/create>.
2. The script will auto-create its own Spreadsheet on first run and
   stash the ID in a Script Property (`OWL_SHEET_ID`). You'll see it
   in your Drive after the first scan.

## 3. Paste the code

In the Apps Script editor:

1. **Code.gs** is open by default. Select all (`⌘A` / `Ctrl-A`),
   delete it, paste the contents of `gas-unified/Code.gs`.
2. **Show the manifest**: gear icon (Project Settings) → toggle
   *"Show 'appsscript.json' manifest file in editor"*. Open
   `appsscript.json` in the file list, replace its contents with
   `gas-unified/appsscript.json`.
3. Save (`⌘S` / `Ctrl-S`).

The file list should show exactly two files: `Code.gs` and
`appsscript.json`. No other `.html` files needed — every template
is inline in `Code.gs`.

## 4. Set Script Properties

**Project Settings** (gear icon) → scroll to **Script Properties** →
**Add script property**.

### Required

| Key | Example value | Why |
|---|---|---|
| `OWL_CONTACT` | `you@noaa.gov` | NWS api.weather.gov rejects requests without a contact-bearing User-Agent. Set this to the email NOAA admins should reach if the script behaves badly. |

### Optional

| Key | Example | Effect when set |
|---|---|---|
| `DIGEST_RECIPIENTS` | `you@noaa.gov,team@noaa.gov` | `runDigest` (every 4 h) emails a plain-text status summary |
| `AIRNOW_API_KEY` | from <https://docs.airnowapi.org> | enables `?api=airnow&lat=…&lon=…` AQI lookups |
| `ASOS_STATIONS` | `KJFK,KLGA,KEWR,…` | overrides the built-in 30-station shortlist |
| `ADMIN_EMAILS` | `you@noaa.gov` | will gate `?path=admin` (gating not enforced today; reserved for §10) |
| `NCEI_MAINT_START` | `2026-04-30T10:00:00Z` | force the maintenance window to a custom range |
| `NCEI_MAINT_END` | `2026-04-30T16:00:00Z` | force the maintenance window to a custom range |

> **Heads up — no AI keys**. The earlier version had AI Brief
> generation requiring `OPENAI_API_KEY`. That's been removed. The
> periodic email is now a structured plain-text status digest with
> no LLM round-trip.

## 5. Authorize + install triggers

In the Apps Script editor:

1. Function dropdown (next to **Run**) → pick **`installTriggers`**.
2. Click **Run**.
3. Google prompts you to **Review permissions**. Pick your account.
4. The "Google hasn't verified this app" page appears — that's
   normal for any non-Google-verified Apps Script. Click **Advanced
   → Go to OWL Status (unsafe)**. (You can verify the requested
   scopes against `appsscript.json` first if you want.)
5. Click **Allow**.

`installTriggers` removes any prior triggers, then installs four:

| Trigger | Cadence | What it does |
|---|---|---|
| `runScan` | every 5 min | Pulls IEM METARs + AWC fallback, classifies, refines, persists |
| `runHazards` | every 10 min | Refreshes the cached hazard payload (CAP/SIGMET/G-AIRMET/CWA/NHC/Tsunami/NIFC/USDM/NCEP-SDM) |
| `runDigest` | every 4 h | Emails the status digest (no-op if `DIGEST_RECIPIENTS` unset) |
| `rotateLogs` | daily at 03:00 | Trims History and UserHistory sheets to ~500 rows |

**Verify** in **Triggers** (clock icon, left rail). You should see
all four listed.

## 6. Deploy as a Web app

1. **Deploy → New deployment**
2. Click the gear next to **Select type** → **Web app**
3. Description: `OWL Status v1`
4. Execute as: **Me**
5. Who has access: **Anyone** *(everyone with the URL)* — or
   **Anyone in your Workspace** if you want it scoped to your
   org's Google domain.
6. Click **Deploy**.
7. Copy the **Web app URL** (ends in `/exec`). That's your
   public dashboard.

> ⚠ **If you change the code later** you must redeploy with a new
> version OR use **Manage deployments → Edit (pencil) → New version**
> to update the same URL. Otherwise the public `/exec` URL keeps
> serving the old code. (See § 8 below.)

## 7. Test from Apps Script's UI

You can run any function directly from the editor and watch the log.
The included `test*` helpers are designed for exactly this.

1. Function dropdown → pick the test you want, click **Run**.

| Test | What it checks |
|---|---|
| `testHealth` | Prints config: station count, NCEI maintenance state, UA, key presence. Verifies your Script Properties are correct. |
| `testScan` | Forces a fresh scan and prints `{ counts, total, duration_ms }`. Should show real numbers across the status enum after one cycle. |
| `testHazards` | Prints counts for every hazard source. `stale_sources` should be `[]` on a healthy day. |

2. Open **Executions** (clock icon → "Executions") to see history,
   logs, and any errors.

You can also exercise the API in the browser without deploying — open
the Web app URL with `?api=health`, `?api=scan`, etc.

```bash
URL="https://script.google.com/macros/s/AKfyc…/exec"
curl -s "$URL?api=health"        | jq .
curl -s "$URL?api=scan"          | jq '.counts'
curl -s "$URL?api=missing"       | jq '.counts'
curl -s "$URL?api=intermittent"  | jq '.count'
curl -s "$URL?api=hazards"       | jq '{cap:.cap_alerts.total, sigmet:.aviation.sigmet_count, fires:.wildfires|length, drought:.drought.counts}'
curl -s "$URL?api=users"         | jq '{active, unique}'
curl -s "$URL?api=usdm"          | jq .counts
# AirNow needs AIRNOW_API_KEY:
curl -s "$URL?api=airnow&lat=40.7&lon=-74.0" | jq .
# NWPS:
curl -s "$URL?api=nwps&lat=38.85&lon=-77.04" | jq .gauge
```

## 8. Iteration loop

When you change `Code.gs`, your *deployed Web app* keeps serving the
**previous** version until you push a new deployment. Cycle:

1. Edit `Code.gs` in the editor (or push from local — see § 9).
2. **Deploy → Manage deployments**.
3. Click the pencil (✎) next to the deployment.
4. **Version** dropdown → **New version** → **Deploy**.
5. The same `/exec` URL now serves the new code.

If you want a fresh URL for testing without disturbing the existing
one (e.g., staging vs prod), use **Deploy → New deployment** instead
of editing the existing one.

> The triggers (`runScan` etc.) always run the latest saved code —
> they don't care about deployment versions. So edits take effect
> immediately for the periodic triggers, but the Web app URL
> requires a redeploy.

## 9. Local testing via clasp

`clasp` is Google's official CLI for Apps Script. It lets you keep
the project in git locally and push/pull/run from your terminal.

### Install

```bash
npm install -g @google/clasp
clasp login                    # opens a browser, authenticates
```

### Link to your existing project

```bash
cd gas-unified
# Get your script ID:
#   in Apps Script editor → Project Settings → "Script ID"
clasp clone <SCRIPT_ID>
# Or if starting fresh:
# clasp create --type webapp --title "OWL Status"
```

This creates a `.clasp.json` (don't commit it — it's user-specific)
linking the local folder to the remote Apps Script project.

### Push, run, tail logs

```bash
# Push local Code.gs + appsscript.json to the remote project:
clasp push

# Run a server-side function and stream the result:
clasp run testHealth
clasp run testScan
clasp run runScan      # full scan, returns the ScanState

# Tail logs (Ctrl-C to stop):
clasp logs --watch
```

### Auto-redeploy on save

```bash
clasp push --watch
```

The `--watch` flag pushes on every save. Combined with `clasp logs
--watch` in another terminal, you get a tight inner loop.

### Pull remote changes

```bash
clasp pull
```

Useful when you've edited in the Apps Script web editor and want to
sync those changes back to your local checkout.

### What clasp can't do

- **Run client-side HTML/JS in the templates** — those execute in
  the browser, not Node. To test the Map / Admin / About pages,
  open the deployed `/exec` URL in a browser.
- **Test triggers locally** — triggers fire only inside Google's
  runtime. Use `clasp run runScan` to manually invoke the same
  function the trigger would.
- **Use Google APIs from raw Node** — the script's `UrlFetchApp`,
  `SpreadsheetApp`, etc. only exist when running inside Apps Script.

For pure-JS testing of the classifier, parser, and formatters, copy
those functions into a Node test file and shim the few `Logger.log`
calls. We may ship a `tests/` folder with that rig in a future
iteration if it's useful.

## 10. Troubleshooting

### "Authorization is required to perform that action."

You skipped § 5. Pick `installTriggers` in the function dropdown,
click Run, and complete the OAuth flow.

### "Exception: You do not have permission to call SpreadsheetApp.getActiveSpreadsheet."

The script ran outside a sheet binding (e.g., a trigger fired before
any sheet was attached). On standalone deploys it auto-creates a
Spreadsheet on first need and stores the ID in `OWL_SHEET_ID` Script
Property. Look for that — there's now a Spreadsheet in your Drive.

### `runScan` runs but the dashboard counters stay empty.

1. Open Executions, click the failed run, check the log.
2. Most common: missing `OWL_CONTACT` → NWS rejects the request as
   "no UA". Set it in Script Properties.
3. Second most common: 6-min execution timeout on a >900-station
   `ASOS_STATIONS` override. The 30-station shortlist runs in ~6 s;
   shorten your override or split it across multiple triggers.

### IEM stops returning data partway through a scan

IEM responds to abuse with a `slow down` text body (HTTP 200, not
429). The script detects this and aborts the affected batch. The AWC
orphan rescue in `fetchAllMetars_` covers the gap automatically. If
it persists, IEM may have rate-limited your IP — wait 10 minutes.

### Map view shows blank

The MapLibre library loads from `unpkg.com` via CDN. Some corporate
firewalls block CDNs; check your browser's Network tab for failed
`maplibre-gl.js` requests. If blocked, edit `renderShell_` to point
at an internal mirror or self-host the bundle.

### Web app `/exec` returns "Authorization required" even though you set Anyone access

Apps Script silently restricts new deployments to "Only me" if you
click through the deploy dialog too fast. **Manage deployments →
Edit → re-confirm "Who has access: Anyone" → Deploy**.

### "Service Spreadsheets failed while accessing document" intermittently

Apps Script's Spreadsheets service has soft quotas — too many writes
in a short window will throttle. The script writes to:
- `Health` (every scan)
- `History` (every scan)
- `StateLog` (every scan, ~30-920 rows)
- `ActiveUsers` (every page-view heartbeat)

If you see this on a high-traffic deploy, drop the heartbeat
frequency in `boot()` (currently 4 min) or move ActiveUsers to
`PropertiesService` instead of a sheet.

### The deployed Web app keeps showing old code after I edited

You forgot to redeploy. See § 8 — edit-the-deployment, pick "New
version", click Deploy. The triggers run latest code immediately,
but the public URL is pinned to the deployment version.

---

## Quick reference

```
gas-unified/
├── Code.gs            (single file, all logic + inline HTML/CSS/JS)
├── appsscript.json    (manifest)
├── README.md          (architecture overview)
└── HOWTO.md           (this file)
```

### Built-in functions you can run

| Function | What it does |
|---|---|
| `runScan` | Force-fetch METARs, classify, persist |
| `runHazards` | Refresh hazard cache |
| `runDigest` | Send the status email |
| `installTriggers` | Install/replace the 4 default triggers |
| `removeTriggers` | Remove all project triggers |
| `rotateLogs` | Trim history sheets |
| `testHealth`, `testScan`, `testHazards` | Debug helpers |
| `showWebAppUrl` | Print the current `/exec` URL to the log |

### Web-app routes

| Path | Returns |
|---|---|
| `/exec` | Main HTML dashboard with map + counters + lists |
| `/exec?path=admin` | Admin dashboard (every list, no slicing) |
| `/exec?path=about` | Status definitions + data sources |
| `/exec?api=health` | JSON health |
| `/exec?api=scan` | JSON scan results |
| `/exec?api=hazards` | JSON aggregated hazards |
| `/exec?api=missing` | JSON missing-stations buckets (3d/1wk/2wk/all) |
| `/exec?api=intermittent` | JSON SUAD-spec intermittent list |
| `/exec?api=users` | JSON active/unique user counts |
| `/exec?api=usdm` | JSON USDM drought summary |
| `/exec?api=airnow&lat=&lon=` | JSON AirNow AQI for coordinate (needs key) |
| `/exec?api=nwps&lat=&lon=` | JSON nearest river gauge + flood stage |
| `/exec?api=heartbeat` (POST) | Logs an active-user heartbeat |

### Status definitions

| Status | Means | Color |
|---|---|---|
| **CLEAN** | Reporting normally, no $ flag | green |
| **FLAGGED** | $ flag set, decoded NO-codes (PWINO, FZRANO, …) | amber |
| **MISSING** | Silent ≥ 75 min (1h cycle + 15m grace) | red |
| **OFFLINE** | Catalog says decommissioned (>14d archive_end) | grey |
| **INTERMITTENT** | *SUAD-spec*: 3+ MISSING hours then recovery | orange |
| **RECOVERED** | Was FLAGGED, last 2 reports clean | blue |
