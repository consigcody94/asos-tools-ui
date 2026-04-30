# NOAA Technical Note

**OWL Status — Unified Single-File Apps Script for ASOS Network Monitoring**

| Field | Value |
|---|---|
| **Document Title** | OWL × NWS Systems Status — Unified Apps Script Technical Note |
| **Document Version** | 1.1 |
| **Effective Date** | 30 April 2026 |
| **Author** | Cody Churchwell |
| **Author Email** | cody.churchwell@noaa.gov |
| **Affiliation** | NOAA / National Weather Service |
| **Subject Repository** | https://github.com/consigcody94/owl-status-apps-script |
| **Document Status** | Initial Release |
| **Distribution** | Internal — SUAD / ASOS Operations |

---

## Executive Summary

This document describes a single-file Google Apps Script implementation
of the NWS Systems Status Map (informal name: "OWL Status"). The
implementation supersedes the legacy multi-file Apps Script project
that read Automated Surface Observing System (ASOS) Manually-Edited
Terminal Aerodrome Routine Reports (METARs) from a manually-maintained
Google Sheet. The new implementation pulls METARs and other
operational data directly from NOAA, FAA, and partner Application
Programming Interfaces (APIs); applies a Surface Observation Audit and
Diagnostics (SUAD)-specification classifier; aggregates eleven hazard
sources; and exposes a public dashboard plus a JavaScript Object
Notation (JSON) API surface.

The script consists of approximately 2,569 lines of JavaScript in a
single `Code.gs` file plus a fourteen-line `appsscript.json` manifest.
Deployment is documented as a five-minute procedure requiring no
external dependencies, no Google Cloud Platform (GCP) project, and a
single required script property.

---

## 1.0 Purpose and Scope

### 1.1 Purpose

This Technical Note (TN) documents the design, deployment, operation,
and configuration of the OWL Status Apps Script. The script provides
real-time visibility into ASOS network health, supporting NWS Systems
Operations Center (SOC) decision-making, field maintenance dispatch,
and shift-change handover.

### 1.2 Scope

This TN covers:

- The replacement of legacy spreadsheet-driven METAR data with live
  API pulls.
- The Surface Observation Audit and Diagnostics (SUAD)-specified
  classification rules for ASOS station status.
- Aggregation of eleven concurrent hazard data sources.
- Web Application (Web app) deployment via Google Apps Script, with
  HyperText Markup Language (HTML) presentation and a JSON
  Application Programming Interface (API) surface.
- Operational procedures, monitoring, and maintenance.
- Configuration parameters and access controls.

This TN does NOT cover:

- The OWL Next.js implementation (`asos-tools-ui` repository), which
  is a separate deployment target.
- Detailed third-party API documentation (links provided to upstream
  sources).
- Training material for end users (covered separately by the
  HOWTO.md included in the deployment package).

### 1.3 Authority

This document is published as an unofficial technical reference. It
does not constitute official NWS, NOAA, or U.S. Department of Commerce
direction. Operational use by NOAA personnel is at the discretion of
the SUAD program office.

---

## 2.0 Background

### 2.1 The Legacy Implementation

A predecessor "System Outage Map" Google Apps Script project,
authored externally, was operated by the SUAD/ASOS team for several
years. The legacy implementation comprised nine separate files:
`Code.gs` (~71 KB), `Index.html`, `Admin.html`, `About.html`,
`JavaScript.html` (~195 KB), `Css.html`, and four feature-specific
HTML overlays.

### 2.2 Limitations of the Legacy Implementation

The legacy implementation read ASOS "Last Observation" data from a
specific column (Personnel Identification (PID) Column AX) of a
manually-maintained Google Sheet workbook. This produced three
operational deficiencies:

1. **Data Latency.** METAR information presented on the Status Map
   was current only as of the most recent manual or scheduled
   refresh of the source spreadsheet. In typical operation this
   latency was minutes to hours, with no system-level guarantee of
   freshness.

2. **Manual Maintenance Burden.** The data pipeline required
   continuous human or scheduled-export upkeep of the source
   spreadsheet. Failure of the upstream refresh process produced
   stale-data conditions that were not visibly distinguished from
   real network outages.

3. **Single-Source Dependency.** The legacy system read from a
   single spreadsheet and had no second-source validation. Mirror
   artifacts from the upstream Iowa Environmental Mesonet (IEM)
   feed were silently propagated into operator-visible
   classifications.

### 2.3 Replacement Rationale

This Apps Script implementation eliminates the spreadsheet
intermediary. METARs are pulled directly from the IEM Comma-Separated
Value (CSV) Common Gateway Interface (CGI) endpoint with Aviation
Weather Center (AWC) METAR API as fallback, and validated against the
National Centers for Environmental Information (NCEI) Access Services
authoritative archive. Maintenance windows on NCEI are respected
automatically.

---

## 3.0 System Description

### 3.1 Architecture Overview

The script is deployed as a Google Apps Script Web app. The single
`Code.gs` file contains:

- All backend logic (data fetch, classification, hazard aggregation).
- All HyperText Markup Language (HTML) templates as in-script string
  constants.
- All Cascading Style Sheets (CSS) and client-side JavaScript as
  in-script string constants.
- All Web app routes (`doGet`, `doPost`).
- All trigger entry points.

This single-file architecture deliberately avoids the multi-file
template system used by the legacy implementation, simplifying
deployment to a single paste operation.

### 3.2 Functional Sections

The `Code.gs` file is organized into fourteen numbered sections:

| § | Section | Purpose |
|---|---|---|
| 1 | Configuration | Script Property accessors, User-Agent (UA), NCEI maintenance window |
| 2 | Station Catalog | Built-in 30-station shortlist; override via `ASOS_STATIONS` Script Property or `Catalog` sheet |
| 3 | HyperText Transfer Protocol (HTTP) Utilities | UrlFetchApp wrapper with retries and User-Agent injection |
| 4 | METAR Fetch | IEM batch CGI calls with AWC orphan-station fallback |
| 5 | Classifier | SUAD-specified status classification with decoded NO-codes |
| 6 | State Log Persistence | Per-station six-hour rolling state history (single-cell JSON in StateLog sheet) |
| 7 | NCEI Cross-Check | Maintenance-aware second-source validation against authoritative archive |
| 8 | Hazard Sources | Eleven concurrent hazard feed integrations |
| 9 | Active-Users Heartbeat | Concurrent-user tracking and historical activity log |
| 10 | Scan Orchestration | Trigger-driven `runScan`, `runHazards`, `runDigest` |
| 11 | Web App Routes | `doGet`/`doPost` with path-style routing |
| 12 | HTML Templates | Inline Index (Map View), Admin, About, Access-Denied templates |
| 13 | Triggers | Install/remove/rotate trigger management |
| 14 | Entry Points | Spreadsheet menu binding and test helpers |

---

## 4.0 Data Sources

The script aggregates data from fourteen distinct upstream sources. All
are public, no-cost, and require no key or authentication except where
noted. Every fetch is wrapped in error-handling so that an upstream
outage of any single source does not block the others.

### 4.1 Primary METAR Sources

| Source | Endpoint | Authority | Rate Envelope |
|---|---|---|---|
| Iowa Environmental Mesonet (IEM) | `mesonet.agron.iastate.edu/cgi-bin/request/asos.py` | Iowa State University; mirror of NCEI archives | Internet Protocol (IP)-based abuse limit; OWL paces ≤1 request per 5 seconds |
| Aviation Weather Center (AWC) METAR | `aviationweather.gov/api/data/metar` | FAA-supported NWS service | ≤2 requests per second; informal |
| National Centers for Environmental Information (NCEI) Access Services | `ncei.noaa.gov/access/services/data/v1` | NOAA NCEI authoritative archive | ≤5 requests per second per IP (documented); maintenance windows announced |

### 4.2 Hazard Sources

| Source | Endpoint | Coverage |
|---|---|---|
| NWS Common Alerting Protocol (CAP) | `api.weather.gov/alerts/active` | Active warnings, watches, advisories |
| NCEP Senior Duty Meteorologist (SDM) | `api.weather.gov/products/types/ADASDM/locations/KWNO` | Network-wide outage administrative bulletins (WMO ID NOUS42 KWNO) |
| AWC Significant Meteorological Information (SIGMETs) | `aviationweather.gov/api/data/airsigmet` | SIGMETs and Alaska AIRMETs |
| AWC Graphical AIRMETs (G-AIRMETs) | `aviationweather.gov/api/data/gairmet` | Contiguous United States (CONUS); replaces text AIRMETs since January 2025 |
| AWC Center Weather Advisories (CWAs) | `aviationweather.gov/api/data/cwa` | Air Route Traffic Control Center (ARTCC) regional aviation advisories |
| National Hurricane Center (NHC) | `nhc.noaa.gov/CurrentStorms.json` | Active tropical cyclones, Atlantic and East/Central Pacific |
| NWS Tsunami Warning Center | `tsunami.gov/events/xml/PAAQAtomAll.xml` (NTWC), `PHEBAtomAll.xml` (PTWC) | National Tsunami Warning Center, Pacific Tsunami Warning Center |
| National Interagency Fire Center (NIFC) | `services3.arcgis.com/T4QMspbfLg3qTGWY/.../WFIGS_Incident_Locations_Current` | Wildland Fire Interagency Geospatial Services (WFIGS) active US wildfires |
| United States Drought Monitor (USDM) | `droughtmonitor.unl.edu/data/json/usdm_current.json` | Weekly drought severity polygons (D0–D4) |
| Environmental Protection Agency (EPA) AirNow | `airnowapi.org/aq/observation/latLong/current/` | Air Quality Index (AQI) by coordinate. **Requires free API key** (`AIRNOW_API_KEY` Script Property) |
| NOAA National Water Prediction Service (NWPS) | `api.water.noaa.gov/nwps/v1/gauges` | River gauge observations, official forecasts, flood-stage thresholds |

### 4.3 Source Stewardship Notes

- The User-Agent (UA) header sent on every NWS request is constructed
  per NWS API documentation requirement; it includes a contact email
  taken from the `OWL_CONTACT` Script Property.
- IEM is an academic mirror of NCEI archives operated by Iowa State
  University. It has historically been more queryable than NCEI's
  direct API and is operational regardless of NCEI's scheduled
  maintenance windows.
- AWC explicitly recommends use of cache files for bulk queries.
  This implementation uses targeted per-station calls only as a
  fallback to IEM, which fits within AWC's published guidance.
- The NCEP Senior Duty Meteorologist's ADASDM product is the formal
  channel for network-wide outage announcements per NWS API
  documentation.

---

## 5.0 Status Taxonomy

The script classifies each ASOS station into one of seven status
categories. The classification logic implements the SUAD-specified
rule set.

### 5.1 Status Definitions

| Status | Definition |
|---|---|
| **CLEAN** | Latest METAR present, no `$` maintenance flag, ≤ 1 missing hourly bucket in the four-hour scan window. No operator action required. |
| **FLAGGED** | Latest METAR carries the `$` maintenance flag. Decoded NO-codes (PWINO — Precipitation Identifier; FZRANO — Freezing-rain Sensor; RVRNO — Runway Visual Range; TSNO — Thunderstorm/Lightning Sensor; PNO — Tipping-Bucket Precip Gauge; VISNO — Visibility Sensor; CHINO — Cloud-Height Ceilometer; SLPNO — Sea-Level Pressure) are surfaced for field-maintenance routing. |
| **MISSING** | Station has been silent ≥ 75 minutes (one nominal hourly cycle plus a 15-minute filing grace) OR no METARs returned by upstream in the four-hour scan window. |
| **OFFLINE** | Station catalog records `archive_end` more than 14 days in the past, OR station has been silent for more than 14 days. Treated as decommissioned. |
| **INTERMITTENT** | *SUAD-specific definition.* Per-station six-hour state log shows a run of ≥ 3 consecutive MISSING entries followed by ≥ 1 OK entry. **FLAGGED-then-recovered transitions do NOT trigger this label.** Continuously-clean stations cannot enter INTERMITTENT regardless of bucket-count noise. |
| **RECOVERED** | Station was FLAGGED earlier in the scan window; the most recent two reports are clean and no buckets are missing. |
| **NO DATA** | Pre-first-scan placeholder; never persists beyond one scan cycle. |

### 5.2 INTERMITTENT — Detailed Rule Statement

The SUAD-specified INTERMITTENT classification requires both:

1. The persistent state log contains a substring of at least three
   consecutive `MISSING` entries (i.e., the station failed to file a
   METAR in three consecutive scheduled hourly cycles), AND
2. The next entry following that run is `OK` (the station has
   resumed reporting).

The state log is bounded to six hours. State transitions involving
`FLAGGED` are treated as "OK with sensor anomaly" for the purposes of
INTERMITTENT detection — they do not constitute MISSING entries and
do not contribute to the run.

### 5.3 Long-Missing Alert Tier

Stations with `minutes_since_last_report > 14 days` are surfaced in
a separate, unbounded "Long-Missing Alert" list. Per SUAD requirement,
this list is not slice-truncated; every entry must be visible in the
Admin tab and surfaced in operational summaries.

---

## 6.0 Operational Procedures

### 6.1 Initial Deployment

Five-minute procedure documented in `HOWTO.md` § 1–6. Summary:

1. Create Google Sheet (any name).
2. **Extensions → Apps Script**; replace `Code.gs` and
   `appsscript.json`.
3. Set required Script Property `OWL_CONTACT` to a contact email.
4. Run `installTriggers` from the function dropdown; complete
   Google authentication.
5. **Deploy → New deployment → Web app**. Recommended access
   scope: **Anyone in your Workspace** (enables `ADMIN_EMAILS`
   gating); fallback: **Anyone with the link**.

### 6.2 Trigger Schedule

`installTriggers` registers four time-based triggers:

| Trigger | Cadence | Purpose |
|---|---|---|
| `runScan` | Every 5 minutes | METAR fetch + classification + state log update |
| `runHazards` | Every 10 minutes | Hazard cache refresh |
| `runDigest` | Every 4 hours | Plain-text status email (gated on `DIGEST_RECIPIENTS` Script Property) |
| `rotateLogs` | Daily, 03:00 local | Trim History and UserHistory sheets to 502 rows each |

### 6.3 Monitoring

Operators should periodically review:

- **Apps Script Executions tab** — verifies trigger execution and
  surfaces any error stack traces.
- **`?api=health` endpoint** — returns current configuration state
  and NCEI maintenance status.
- **`?path=admin` Sources Health section** — shows per-source stale
  flag based on the most recent `runHazards` execution.
- **`?path=admin` Active Users section** — shows concurrent and
  total unique users for the past 24 hours.

### 6.4 Maintenance Procedures

#### 6.4.1 Adjusting Classifier Thresholds

The four classifier thresholds are exposed as constants near the top
of `Code.gs`:

```
var MISSING_SILENCE_MIN      = 75;
var INTERMITTENT_MISSING_RUN = 3;
var STATE_LOG_HOURS          = 6;
var OFFLINE_GRACE_DAYS       = 14;
```

Modify, save, and the next scheduled trigger picks up the new value.
Web app deployments require redeployment per § 6.4.3.

#### 6.4.2 Expanding the Station Catalog

The default 30-station shortlist is suitable for SUAD test deployments.
For full ASOS network coverage:

- **Option A.** Set the `ASOS_STATIONS` Script Property to a
  comma-separated International Civil Aviation Organization (ICAO)
  identifier list.
- **Option B.** Upload a `Catalog` sheet with ICAO codes in column A
  (and optional latitude/longitude in columns B/C for map display).

A 920-station scan completes in approximately 60 seconds, within the
six-minute Apps Script execution cap.

#### 6.4.3 Web App Redeployment

Code changes take effect immediately for trigger executions. The
public Web app URL serves a pinned version until manually redeployed:

1. **Deploy → Manage deployments**.
2. Click the pencil (edit) icon on the active deployment.
3. **Version → New version → Deploy**.

The same `/exec` URL now serves the updated code.

---

## 7.0 Configuration Reference

All configuration is via Apps Script Script Properties. No editing of
`Code.gs` is required for typical deployments.

### 7.1 Required Script Properties

| Property | Purpose |
|---|---|
| `OWL_CONTACT` | Contact email embedded in the User-Agent header sent to NWS. NWS API rejects requests without a contact-bearing UA. |

### 7.2 Optional Script Properties

| Property | Purpose |
|---|---|
| `DIGEST_RECIPIENTS` | Comma-separated email list. When set, `runDigest` (4-hourly) sends a plain-text status summary. |
| `AIRNOW_API_KEY` | Free key from <https://docs.airnowapi.org/>. When set, `?api=airnow` returns AQI for any latitude/longitude. |
| `ASOS_STATIONS` | Comma-separated ICAO list overriding the built-in 30-station shortlist. |
| `ADMIN_EMAILS` | Comma-separated email allow-list. When set, gates `?path=admin`. Requires deployment configured as **Execute as: User accessing the web app** AND access scope **Anyone in your Workspace** for viewer email to be exposed. |
| `NCEI_MAINT_START`, `NCEI_MAINT_END` | International Organization for Standardization 8601 (ISO 8601) timestamps overriding the built-in NCEI maintenance window. Format: `YYYY-MM-DDTHH:mm:ssZ`. |

### 7.3 Sheet Tabs (Auto-Created)

| Tab | Purpose |
|---|---|
| `Health` | Latest scan snapshot for warm-restore |
| `History` | Audit log (bounded 502 rows) |
| `StateLog` | Single-cell JSON of per-station rolling state |
| `ActiveUsers` | Latest heartbeat per user (concurrent-user calculation) |
| `UserHistory` | Append-only heartbeat log (bounded 502 rows) |
| `Banners` | Operator-editable sticky messages (Active / Severity / Message / Created UTC) |

---

## 8.0 Web App Routes

### 8.1 HTML Routes

| Route | Renders |
|---|---|
| `/exec` | Map dashboard (status counters, MapLibre map, top problems, INTERMITTENT, long-missing, hazards) |
| `/exec?path=admin` | Admin dashboard (full-detail status lists, sources health, active users) |
| `/exec?path=about` | Status definitions and data-source listing |

### 8.2 JSON API Routes

| Route | Returns |
|---|---|
| `/exec?api=health` | Configuration state, NCEI maintenance status |
| `/exec?api=scan` | Per-station status rows with state log, flag codes, classification reason |
| `/exec?api=hazards` | Aggregated multi-source hazard context |
| `/exec?api=missing` | Missing-station tiered buckets (3 days / 1 week / 2 weeks / all) |
| `/exec?api=intermittent` | SUAD-specified INTERMITTENT list with state-log patterns |
| `/exec?api=users` | Concurrent and unique active-user counts |
| `/exec?api=usdm` | USDM weekly drought summary |
| `/exec?api=airnow&lat=&lon=` | AirNow AQI at coordinate (requires `AIRNOW_API_KEY`) |
| `/exec?api=nwps&lat=&lon=` | Nearest NWPS river gauge with flood-stage forecast |
| `/exec?api=sources` | Full source registry with per-source stale flags |
| `/exec?api=banners` | Operator-editable sticky messages |
| `/exec?api=heartbeat` (POST) | Logs an active-user heartbeat |

---

## 9.0 Security and Access Controls

### 9.1 Authentication

Authentication is delegated to Google Apps Script's deployment scope:

- **Anyone with the link** — public access; viewer identity not
  exposed; admin gate cannot be enforced.
- **Anyone in your Workspace** — restricted to the deploying
  account's Google Workspace domain; viewer email exposed to the
  script; admin gate enforceable.
- **Only myself** — restricted to the deploying account.

### 9.2 Admin Page Gating

When `ADMIN_EMAILS` is set, requests to `?path=admin` are gated. The
gate is enforced via `Session.getActiveUser().getEmail()`. Requests
from viewers not on the allow-list, or from deployments where viewer
email is unavailable, render an access-denied page documenting both
failure modes.

### 9.3 Data Persistence

All persistent data (scan snapshots, state logs, history, banners,
active users) resides in the bound Google Sheet under the deploying
account's Google Drive. No external database, no third-party storage.

### 9.4 External Communications

The script issues outbound HTTPS requests only to the listed data
sources in § 4. No data leaves Google's infrastructure except via
those documented public APIs. The optional digest email is sent via
Google's `MailApp` service to operator-specified recipients.

---

## 10.0 Known Limitations

### 10.1 Apps Script Quotas

Google Apps Script imposes the following relevant quotas (consumer
account; Workspace tier doubles or triples most):

- 6-minute maximum execution time per trigger
- 1,000,000 spreadsheet cell writes per day
- 20,000 UrlFetchApp calls per day
- 50 MB total Apps Script project size

The single-cell JSON state log persistence (§ 6.0 of `Code.gs`)
ensures the cell-write quota is not the binding constraint at any
practical station count. The 30-station default shortlist consumes
approximately 4,000 UrlFetchApp calls per day; full 920-station
deployments consume approximately 16,000 — within consumer quota
but with limited headroom for additional integrations.

### 10.2 Map View

The MapLibre map view loads its bundle from `unpkg.com` via Content
Delivery Network (CDN). Corporate firewalls that block external CDNs
will cause the map to fail to render. The fallback is to self-host
the MapLibre bundle and modify the `renderShell_` template.

### 10.3 Feature Parity with the Next.js Implementation

This Apps Script does not include several features present in the
parallel OWL Next.js implementation (`asos-tools-ui` repository):

- Per-station drill-down panel with cameras, NEXRAD imagery, and
  satellite loops.
- Watches/Warnings/Advisories (WWA) full geometry overlay.
- Full 159-site WSR-88D radar catalog.

These omissions are intentional scope decisions based on the
single-file Apps Script size budget and the dashboard-focused use
case.

---

## 11.0 Acronyms

| Acronym | Definition |
|---|---|
| API | Application Programming Interface |
| AQI | Air Quality Index |
| ARTCC | Air Route Traffic Control Center |
| ASOS | Automated Surface Observing System |
| AWC | Aviation Weather Center |
| CAP | Common Alerting Protocol |
| CDN | Content Delivery Network |
| CGI | Common Gateway Interface |
| CONUS | Contiguous United States |
| CSS | Cascading Style Sheets |
| CSV | Comma-Separated Value |
| CWA | Center Weather Advisory |
| EPA | Environmental Protection Agency |
| FAA | Federal Aviation Administration |
| GCP | Google Cloud Platform |
| HTML | HyperText Markup Language |
| HTTP | HyperText Transfer Protocol |
| HTTPS | HyperText Transfer Protocol Secure |
| ICAO | International Civil Aviation Organization |
| IEM | Iowa Environmental Mesonet |
| IP | Internet Protocol |
| ISO | International Organization for Standardization |
| JSON | JavaScript Object Notation |
| METAR | Manually-Edited Terminal Aerodrome Routine Report |
| NCEI | National Centers for Environmental Information |
| NCEP | National Centers for Environmental Prediction |
| NHC | National Hurricane Center |
| NIFC | National Interagency Fire Center |
| NOAA | National Oceanic and Atmospheric Administration |
| NTWC | National Tsunami Warning Center |
| NWS | National Weather Service |
| NWPS | National Water Prediction Service |
| PID | Personnel Identification |
| PTWC | Pacific Tsunami Warning Center |
| SDM | Senior Duty Meteorologist |
| SIGMET | Significant Meteorological Information |
| SOC | Systems Operations Center |
| SUAD | Surface Observation Audit and Diagnostics |
| TN | Technical Note |
| UA | User-Agent |
| URL | Uniform Resource Locator |
| USDM | United States Drought Monitor |
| WFIGS | Wildland Fire Interagency Geospatial Services |
| WMO | World Meteorological Organization |
| WWA | Watches/Warnings/Advisories |

---

## 12.0 References

| Ref | Source |
|---|---|
| 1 | NWS API documentation, https://www.weather.gov/documentation/services-web-api |
| 2 | AWC Data API, https://aviationweather.gov/data/api |
| 3 | IEM ASOS request CGI, https://mesonet.agron.iastate.edu/request/download.phtml |
| 4 | NCEI Access Services, https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation |
| 5 | NCEI Alerts (maintenance windows), https://www.ncei.noaa.gov/news/alerts |
| 6 | NHC active storms, https://www.nhc.noaa.gov/data/ |
| 7 | NWS Tsunami feeds, https://www.tsunami.gov/?page=apipage |
| 8 | NIFC WFIGS, https://data-nifc.opendata.arcgis.com/ |
| 9 | USDM, https://droughtmonitor.unl.edu/About/AboutTheData/DataDownload.aspx |
| 10 | EPA AirNow API, https://docs.airnowapi.org/ |
| 11 | NOAA NWPS, https://water.noaa.gov/about |
| 12 | Google Apps Script quotas, https://developers.google.com/apps-script/guides/services/quotas |
| 13 | MapLibre GL, https://maplibre.org/ |
| 14 | Federal Meteorological Handbook 1 (FMH-1), Surface Observations and Reports, https://www.ofcm.gov/publications/fmh/fmh1.htm |

---

## 13.0 Document Change Log

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 30 April 2026 | Cody Churchwell | Initial release. Single-file Apps Script implementation with eleven hazard sources, SUAD-specified classifier, MapLibre map view, active-users tracking, plain-text status digest. |
| 1.1 | 30 April 2026 | Cody Churchwell | Audit fixes: state log scaling (single-cell JSON), `ADMIN_EMAILS` gating, banner system, sources registry endpoint, doc URL typo. |

---

*Document Number*: NWS-SUAD-OWL-TN-2026-001
*Distribution*: Internal — SUAD / ASOS Operations
*Author*: Cody Churchwell · cody.churchwell@noaa.gov
