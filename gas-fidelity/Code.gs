/********************************************************************
 * OWL × NWS Systems Status — Unified Single-File Apps Script
 *
 *  Replaces James Glenn's multi-file System Outage Map project with
 *  a single self-contained Code.gs. Folds in OWL's data-layer
 *  improvements:
 *
 *    - METAR data comes from LIVE APIS (IEM batch CGI) instead of a
 *      manually-maintained Google Sheet column. AWC fallback for any
 *      station IEM doesn't return; NCEI cross-check validates
 *      classifications against the authoritative archive.
 *
 *    - SUAD-spec INTERMITTENT classifier: only stations with the
 *      specific MISSING-run-then-recovery pattern get the label.
 *      FLAGGED→OK transitions are NOT INTERMITTENT (they're just
 *      "flag cleared"). Per-station 6-hour rolling state log
 *      persisted in a Sheet so the refiner survives across runs.
 *
 *    - Decoded $-flag reasons (PWINO / FZRANO / RVRNO etc.) instead
 *      of a generic "$ flag set" string.
 *
 *    - Long-missing alert tier: every station silent > 14 days
 *      surfaces in the Admin tab. Unbounded list per SUAD spec.
 *
 *    - All OWL hazard sources: NWS CAP alerts, AWC SIGMETs +
 *      G-AIRMETs + CWAs, NHC tropical, Tsunami (NTWC + PTWC), NIFC
 *      wildfires, USDM drought, EPA AirNow AQI, NWPS flood gauges,
 *      NCEP SDM admin bulletins, NCEI maintenance window awareness.
 *
 *    - MapLibre map view embedded in the Index template — CDN-loaded
 *      MapLibre GL with Esri World Imagery satellite basemap, station
 *      markers colored by status, click-to-drill popups.
 *
 *    - Active-Users heartbeat tracking: every page load logs to a
 *      sheet so the Admin tab can show concurrent user counts +
 *      historical activity.
 *
 *  ====================================================================
 *  ZERO-DEPENDENCY DESIGN
 *  ====================================================================
 *  Everything is inline: this Code.gs is the entire deployable unit
 *  plus appsscript.json. No add-ons, no libraries, no external HTML
 *  files, no GCP project. Paste this into a fresh Apps Script project,
 *  set 4 Script Properties, run installTriggers() once, deploy as a
 *  web app — done.
 *
 *  ====================================================================
 *  DEPLOY CHECKLIST (5 minutes)
 *  ====================================================================
 *    1. Create a Google Sheet titled "OWL Status" (any name works).
 *    2. Extensions → Apps Script. Replace Code.gs with this file.
 *    3. Show appsscript.json (Project Settings → toggle), replace its
 *       contents with the appsscript.json that ships with this file.
 *    4. Project Settings → Script Properties. Add:
 *         OWL_CONTACT        (email for the NWS UA, e.g. you@noaa.gov)
 *       Optional:
 *         DIGEST_RECIPIENTS  (comma-sep emails for periodic status email)
 *         AIRNOW_API_KEY     (free key from airnowapi.org — for AQI)
 *         ASOS_STATIONS      (comma-sep ICAO list; defaults to 30 sites)
 *         ADMIN_EMAILS       (comma-sep emails allowed on /admin)
 *    5. Run installTriggers() once → authorize → done.
 *    6. Deploy → New deployment → Web app, Execute as Me, access
 *       Anyone with link (or your domain). Copy the /exec URL.
 *
 *  ====================================================================
 *  FILE LAYOUT (sections)
 *  ====================================================================
 *    1. CONFIG               — Script Property accessors + constants
 *    2. STATION CATALOG      — 920-station ASOS shortlist (built in)
 *    3. HTTP UTILITIES       — UrlFetchApp wrapper with retries
 *    4. METAR FETCH          — IEM batch + AWC orphan fallback
 *    5. CLASSIFIER           — SUAD-spec rules + state-log refiner
 *    6. STATE LOG PERSIST    — Per-station 6-hour rolling state log
 *    7. NCEI CROSS-CHECK     — Maintenance-aware second-source
 *    8. HAZARD SOURCES       — CAP / SIGMET / G-AIRMET / CWA / NHC /
 *                                Tsunami / NIFC / USDM / AirNow / NWPS /
 *                                NCEP SDM admin bulletins
 *    9. SCAN ORCHESTRATION   — runScan, runHazards, runDigest (status email)
 *   10. ACTIVE-USERS         — Heartbeat tracking + concurrent count
 *   11. WEB APP ROUTES       — doGet / doPost + path-style API
 *   12. HTML TEMPLATES       — Index (with MapLibre) / Admin / About
 *   13. TRIGGERS             — install / remove
 *   14. ENTRY POINTS         — onOpen, helper utilities
 ********************************************************************/


// =====================================================================
// 1. CONFIG
// =====================================================================
//
// Every runtime knob lives in Script Properties — no edits to this file
// needed for a typical deployment. PROP() / PROPN() / PROPB() coerce
// the always-string properties into the right type with safe defaults.

function PROP(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v == null || v === '') ? (fallback == null ? '' : fallback) : String(v);
}
function PROPN(key, fallback) {
  var n = Number(PROP(key, ''));
  return isFinite(n) ? n : fallback;
}
function PROPB(key, fallback) {
  var v = PROP(key, '').toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return !!fallback;
}

/** Single User-Agent for every NWS / NOAA fetch. NWS api.weather.gov
 *  REQUIRES a contact-bearing UA. Using a known string also makes
 *  rate-limit debugging easier when NOAA admins inspect logs. */
function userAgent_() {
  var contact = PROP('OWL_CONTACT', 'owl-monitor@example.com');
  return 'OWL-AppsScript/1.0 (' + contact + '; +https://github.com/consigcody94/asos-tools-ui)';
}

/** NWS feature flags — comma-separated. forecast_temperature_qv has
 *  been stable for 18 months and gives quantitative variables. */
var NWS_FEATURE_FLAGS = 'forecast_temperature_qv';

/** NCEI maintenance window — defaults to today's published Apr 30
 *  06:00–12:00 ET window. Override via Script Properties to disable
 *  or move the window. */
var NCEI_MAINT_START = '2026-04-30T10:00:00Z';
var NCEI_MAINT_END   = '2026-04-30T16:00:00Z';
function nceiMaintActive_() {
  var s = PROP('NCEI_MAINT_START', NCEI_MAINT_START);
  var e = PROP('NCEI_MAINT_END',   NCEI_MAINT_END);
  if (!s || !e) return false;
  var t = Date.now();
  return t >= Date.parse(s) && t <= Date.parse(e);
}

/** Cache TTLs (seconds). All read by section 11 (web routes). */
var CACHE_SCAN_TTL_S    = 300;    // 5 min
var CACHE_HAZARD_TTL_S  = 300;

/** Sheet tab names — auto-created on first run. */
var TAB_HISTORY      = 'History';
var TAB_HEALTH       = 'Health';
var TAB_STATE_LOG    = 'StateLog';      // per-station rolling state
var TAB_ACTIVE_USERS = 'ActiveUsers';
var TAB_USER_HIST    = 'UserHistory';
/** Banner workbook tab — sticky operator messages (legacy parity). */
var TAB_BANNERS      = 'Banners';

/** SUAD-spec classifier thresholds. */
var MISSING_SILENCE_MIN     = 75;       // 1h cycle + 15m grace
var INTERMITTENT_MISSING_RUN = 3;        // ≥3 MISSING then OK
var STATE_LOG_HOURS          = 6;        // log depth
var OFFLINE_GRACE_DAYS       = 14;       // catalog archive_end


// =====================================================================
// 2. STATION CATALOG
// =====================================================================
//
// 30-station shortlist used by default. The full 920-site catalog
// is too big to inline — operators who need everything set the
// ASOS_STATIONS Script Property to a comma-separated full list, OR
// upload a "Catalog" sheet (Col A = ICAO) which we read on first run.

var DEFAULT_ASOS_SHORTLIST = [
  // Major airports across CONUS + Alaska + Hawaii
  'KJFK','KLGA','KEWR','KBOS','KDCA','KIAD','KBWI','KPHL','KORD','KMDW',
  'KATL','KMIA','KMCO','KFLL','KCLT','KIAH','KDFW','KLAX','KSFO','KSEA',
  'KPDX','KDEN','KLAS','KPHX','KSAN','KMSP','KDTW','KCLE','KSTL',
  'PANC','PHNL'
];

/** Lat/lon for the built-in shortlist. Used by the MapLibre map view
 *  to plot points without round-tripping each station's coordinates.
 *  When operators override ASOS_STATIONS with a custom list, they
 *  also need to provide a Catalog sheet (Col A=ICAO, B=lat, C=lon)
 *  for the map to render those points. */
var STATION_COORDS = {
  KJFK: [40.6398, -73.7787], KLGA: [40.7772, -73.8726], KEWR: [40.6925, -74.1687],
  KBOS: [42.3656, -71.0096], KDCA: [38.8521, -77.0377], KIAD: [38.9445, -77.4558],
  KBWI: [39.1754, -76.6683], KPHL: [39.8744, -75.2424], KORD: [41.9786, -87.9048],
  KMDW: [41.7868, -87.7522], KATL: [33.6407, -84.4277], KMIA: [25.7959, -80.2870],
  KMCO: [28.4294, -81.3089], KFLL: [26.0726, -80.1527], KCLT: [35.2140, -80.9431],
  KIAH: [29.9844, -95.3414], KDFW: [32.8998, -97.0403], KLAX: [33.9416, -118.4085],
  KSFO: [37.6213, -122.3790], KSEA: [47.4502, -122.3088], KPDX: [45.5887, -122.5975],
  KDEN: [39.8561, -104.6737], KLAS: [36.0840, -115.1537], KPHX: [33.4373, -112.0078],
  KSAN: [32.7338, -117.1933], KMSP: [44.8848, -93.2223], KDTW: [42.2124, -83.3534],
  KCLE: [41.4124, -81.8498], KSTL: [38.7487, -90.3700],
  PANC: [61.1741, -149.9961], PHNL: [21.3187, -157.9224],
};

function getStationList_() {
  // 1. Explicit Script Property override.
  var override = PROP('ASOS_STATIONS', '');
  if (override) {
    return override.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
  }
  // 2. Catalog sheet override.
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Catalog');
    if (sh && sh.getLastRow() > 1) {
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
      var ids = vals.map(function (r) { return String(r[0] || '').trim().toUpperCase(); }).filter(Boolean);
      if (ids.length > 0) return ids;
    }
  } catch (_) { /* no active spreadsheet — happens when triggered standalone */ }
  // 3. Built-in shortlist.
  return DEFAULT_ASOS_SHORTLIST.slice();
}


// =====================================================================
// 3. HTTP UTILITIES
// =====================================================================
//
// UrlFetchApp wrapper with: retries on 5xx, exponential backoff,
// muteHttpExceptions for graceful 4xx handling, and a default UA.
// Every NOAA/external call goes through fetchJson_ or fetchText_ so
// rate-limit + UA policies are uniform.

function fetchText_(url, options) {
  options = options || {};
  var headers = options.headers || {};
  if (!headers['User-Agent']) headers['User-Agent'] = userAgent_();
  var attempts = options.retries == null ? 2 : options.retries;
  var timeoutMs = options.timeoutMs || 25000;   // Apps Script caps at 60s

  var lastErr = null;
  for (var i = 0; i <= attempts; i++) {
    try {
      var resp = UrlFetchApp.fetch(url, {
        method: options.method || 'get',
        payload: options.payload,
        contentType: options.contentType,
        headers: headers,
        muteHttpExceptions: true,
        followRedirects: true,
        validateHttpsCertificates: true,
      });
      var code = resp.getResponseCode();
      if (code >= 200 && code < 300) return resp.getContentText();
      if (code >= 500 && i < attempts) {
        Utilities.sleep(500 * Math.pow(2, i));
        continue;
      }
      // 4xx — give up; let caller handle.
      Logger.log('[fetchText] ' + code + ' ' + url);
      return null;
    } catch (e) {
      lastErr = e;
      if (i < attempts) { Utilities.sleep(500 * Math.pow(2, i)); continue; }
    }
  }
  Logger.log('[fetchText] failed ' + url + ' — ' + (lastErr && lastErr.message || 'unknown'));
  return null;
}

function fetchJson_(url, options) {
  var text = fetchText_(url, options);
  if (!text) return null;
  try { return JSON.parse(text); }
  catch (e) {
    Logger.log('[fetchJson] parse failed ' + url + ' — ' + e.message);
    return null;
  }
}


// =====================================================================
// 4. METAR FETCH
// =====================================================================
//
// IEM batch CGI is the primary source. AWC's per-station METAR API
// is the fallback for stations IEM didn't return (mirror artifact —
// IEM occasionally drops IDs from chunk responses). NCEI Access
// Services validates classifications in section 7.
//
// IEM's documented IP-based rate limit isn't a numeric quota; we
// pace at ≤ 1 request per 5 seconds and use 80-station batches so
// 920 stations = 12 calls × 5s = ~60s minimum scan time.

// Batch size for IEM CGI requests. 200 stations per request keeps the
// URL at ~2.6 KB (well below any plausible server limit) and cuts a
// 920-station scan from ~96s to ~60s vs. the previous 80-batch tuning.
// Bumped from 80 in v2.1 — see options analysis in the README.
var IEM_BATCH = 200;
var IEM_BASE  = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';
var AWC_METAR = 'https://aviationweather.gov/api/data/metar';

/** Build the IEM batch URL for a list of station IDs. IEM accepts
 *  repeated `station=` parameters; we URL-encode and join. */
function iemUrl_(stations, hoursBack) {
  var qs = stations.map(function (s) { return 'station=' + encodeURIComponent(s); }).join('&');
  qs += '&data=metar&format=onlycomma&latlon=no&missing=M&trace=T&direct=no';
  qs += '&report_type=3&report_type=4&hours=' + (hoursBack || 4) + '&year1=';
  return IEM_BASE + '?' + qs;
}

/** IEM responds to rate-limit abuse with HTTP 200 + a text body
 *  containing "slow down" — NOT a 429. Detect early and treat as
 *  a failed batch so the next attempt waits. */
function isIemRateLimit_(text) {
  if (!text) return false;
  var first = text.slice(0, 300).toLowerCase();
  return first.indexOf('too many') >= 0 || first.indexOf('slow down') >= 0;
}

/** Parse IEM's `onlycomma` CSV output. Header row + data rows. */
function parseIemCsv_(text) {
  if (!text || isIemRateLimit_(text)) return [];
  var lines = text.split('\n');
  if (lines.length < 2) return [];
  var header = lines[0].split(',').map(function (s) { return s.trim(); });
  var stIdx = header.indexOf('station');
  var vIdx  = header.indexOf('valid');
  var mIdx  = header.indexOf('metar');
  if (mIdx < 0) mIdx = header.indexOf('report');
  if (stIdx < 0 || vIdx < 0 || mIdx < 0) return [];
  var out = [];
  for (var i = 1; i < lines.length; i++) {
    var row = lines[i];
    if (!row) continue;
    var parts = row.split(',');
    if (parts.length < header.length) continue;
    out.push({
      station: parts[stIdx].trim(),
      valid:   parts[vIdx].trim(),     // "YYYY-MM-DD HH:MM" UTC
      metar:   parts[mIdx].trim(),
    });
  }
  return out;
}

function fetchIemBatch_(stations, hoursBack) {
  var url = iemUrl_(stations, hoursBack);
  var text = fetchText_(url, { timeoutMs: 55000, retries: 1 });
  return parseIemCsv_(text);
}

/** AWC METAR fallback. AWC accepts comma-separated ICAO list and
 *  returns JSON. Used for the orphan-station fallback. */
function fetchAwcMetars_(stations) {
  if (!stations.length) return [];
  var ids = stations.join(',');
  var url = AWC_METAR + '?ids=' + encodeURIComponent(ids) + '&format=json&hours=4';
  var data = fetchJson_(url, { timeoutMs: 30000, retries: 1 });
  if (!data || !data.length) return [];
  // Normalize to the same shape IEM returns.
  return data.map(function (r) {
    var d = r.reportTime ? new Date(r.reportTime) : null;
    var valid = '';
    if (d && !isNaN(d)) {
      valid = d.getUTCFullYear() + '-' +
              String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
              String(d.getUTCDate()).padStart(2, '0') + ' ' +
              String(d.getUTCHours()).padStart(2, '0') + ':' +
              String(d.getUTCMinutes()).padStart(2, '0');
    }
    return {
      station: String(r.icaoId || ''),
      valid:   valid,
      metar:   String(r.rawOb || ''),
    };
  }).filter(function (r) { return r.station && r.metar; });
}

/** Run a full network scan: IEM batches + AWC orphan rescue. Returns
 *  an array of normalized {station, valid, metar} rows. */
function fetchAllMetars_(stations, hoursBack) {
  var batches = [];
  for (var i = 0; i < stations.length; i += IEM_BATCH) {
    batches.push(stations.slice(i, i + IEM_BATCH));
  }
  var rows = [];
  for (var b = 0; b < batches.length; b++) {
    var got = fetchIemBatch_(batches[b], hoursBack || 4);
    rows = rows.concat(got);
    // Pace ourselves — IEM enforces a ~5s spacing on batch CGI.
    if (b < batches.length - 1) Utilities.sleep(5000);
  }
  // Orphan rescue: any station with zero IEM rows gets a single AWC
  // probe. Cap at 100 to stay inside the AWC rate envelope.
  var seen = {};
  for (var r = 0; r < rows.length; r++) {
    var k = normKey_(rows[r].station);
    seen[k] = true;
  }
  var orphans = [];
  for (var s = 0; s < stations.length; s++) {
    if (!seen[normKey_(stations[s])]) orphans.push(stations[s]);
  }
  if (orphans.length > 0) {
    var rescued = fetchAwcMetars_(orphans.slice(0, 100));
    if (rescued.length > 0) {
      Logger.log('[scan] AWC rescued ' + rescued.length + '/' + orphans.length + ' orphans');
      rows = rows.concat(rescued);
    }
  }
  return rows;
}

/** Normalize ICAO keys: strip K/P/T leading prefix so "KJFK" and
 *  "JFK" are the same key. Used for grouping IEM rows by station. */
function normKey_(id) {
  var s = String(id || '').trim().toUpperCase();
  if (s.length === 4 && (s[0] === 'K' || s[0] === 'P' || s[0] === 'T')) {
    return s.substring(1);
  }
  return s;
}


// =====================================================================
// 5. CLASSIFIER (SUAD-spec)
// =====================================================================
//
// Per-station METAR rows → status + metadata. Rules mirror OWL's
// final classifier:
//
//   1. Catalog says decommissioned (>14d archive_end)  → OFFLINE
//   2. No METAR in window OR silent ≥ 75 min            → MISSING
//   3. Latest METAR has $ flag                          → FLAGGED
//   4. ≤ 1 missing hourly bucket + no flags             → CLEAN
//   5. Last 2 reports clean + no gaps + previously $    → RECOVERED
//   6. Else                                              → INTERMITTENT
//
// History-aware refinement (using state log, see section 6):
//   - INTERMITTENT only fires if log shows ≥ 3 consecutive MISSING
//     entries followed by recovery. FLAGGED→OK does NOT trigger.
//   - Continuously-OK log overrides bucket-noise INTERMITTENT.

/** Parse the DDHHmmZ token out of a METAR body into a UTC Date. */
function parseMetarTime_(metar, refDate) {
  if (!metar) return null;
  var m = metar.match(/(\d{2})(\d{2})(\d{2})Z/);
  if (!m) return null;
  var d  = parseInt(m[1], 10);
  var hh = parseInt(m[2], 10);
  var mm = parseInt(m[3], 10);
  var ref = refDate || new Date();
  var t = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), d, hh, mm, 0));
  // If the parsed timestamp ends up > 12 h in the future, assume it's
  // last month (the report rolled over month boundary).
  if (t.getTime() - ref.getTime() > 12 * 3600 * 1000) {
    t = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, d, hh, mm, 0));
  }
  return t;
}

/** Strip any trailing `=` before checking for the maintenance flag. */
function hasMaintenanceFlag_(metar) {
  if (!metar) return false;
  var s = metar.replace(/=+\s*$/, '').trim();
  return s.charAt(s.length - 1) === '$';
}

/** Decode specific NO-codes into operator-actionable reasons. */
var SENSOR_REASONS = {
  PWINO:   'Precipitation identifier offline',
  FZRANO:  'Freezing-rain sensor offline',
  RVRNO:   'Runway visual range offline',
  TSNO:    'Thunderstorm/lightning sensor offline',
  PNO:     'Tipping-bucket precip gauge offline',
  VISNO:   'Visibility sensor (default location) offline',
  CHINO:   'Cloud-height (ceilometer) offline',
  SLPNO:   'Sea-level pressure not available',
};
function decodeReasons_(metar) {
  if (!metar) return [];
  var u = metar.toUpperCase();
  var hits = [];
  for (var code in SENSOR_REASONS) {
    if (u.indexOf(code) >= 0) hits.push({ code: code, text: SENSOR_REASONS[code] });
  }
  return hits;
}

function expectedHourlyBuckets_(start, end) {
  var graceMin = 15;
  var now = Date.now();
  var effEnd = Math.min(end.getTime(), now - graceMin * 60000);
  if (effEnd <= start.getTime()) return [];
  var first = Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), start.getUTCHours()
  );
  if (first < start.getTime()) first += 3600000;
  var out = [];
  for (var h = first; h + 3600000 <= effEnd + graceMin * 60000; h += 3600000) {
    out.push(h);
  }
  return out;
}

function fmtSilence_(min) {
  if (min == null) return '?';
  if (min < 60) return min + 'm';
  if (min < 1440) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
  var d = Math.floor(min / 1440);
  var h = Math.floor((min % 1440) / 60);
  return d + 'd ' + h + 'h';
}

/** Pure single-window classifier — operates on this scan's data only.
 *  History-aware refinement is applied separately in classifyAll_. */
function classifyOne_(metars, now, expectedBuckets, archiveEnd) {
  // OFFLINE — catalog said decommissioned.
  if (archiveEnd) {
    var archT = Date.parse(archiveEnd);
    if (isFinite(archT) && now.getTime() - archT > OFFLINE_GRACE_DAYS * 86400000) {
      return {
        status: 'OFFLINE',
        minutes_since_last_report: null,
        last_metar: null, last_valid: null,
        probable_reason: 'decommissioned — archive_end ' + archiveEnd,
        flag_codes: [],
      };
    }
  }
  // No data at all.
  if (!metars || metars.length === 0) {
    return {
      status: 'MISSING',
      minutes_since_last_report: null,
      last_metar: null, last_valid: null,
      probable_reason: 'no METAR received in scan window',
      flag_codes: [],
    };
  }
  // Sort newest-first.
  var rows = metars.slice().sort(function (a, b) { return a.valid < b.valid ? 1 : -1; });
  var latest = rows[0];
  var latestTime = parseMetarTime_(latest.metar, now);
  var minsSince = latestTime
    ? Math.max(0, Math.round((now.getTime() - latestTime.getTime()) / 60000))
    : null;
  var flagged = hasMaintenanceFlag_(latest.metar);
  var flaggedInWindow = rows.filter(function (r) { return hasMaintenanceFlag_(r.metar); }).length;

  // Count covered hourly buckets.
  var coveredKeys = {};
  for (var i = 0; i < rows.length; i++) {
    var t = parseMetarTime_(rows[i].metar, now);
    if (!t) continue;
    var bucket = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours());
    coveredKeys[bucket] = true;
    if (t.getUTCMinutes() >= 45) coveredKeys[bucket + 3600000] = true;
  }
  var missingBuckets = 0;
  for (var b = 0; b < expectedBuckets.length; b++) {
    if (!coveredKeys[expectedBuckets[b]]) missingBuckets++;
  }

  // Priority ladder — same as OWL.
  if (minsSince === null || minsSince >= MISSING_SILENCE_MIN) {
    return {
      status: 'MISSING',
      minutes_since_last_report: minsSince,
      last_metar: latest.metar, last_valid: latest.valid,
      probable_reason: 'silent ' + fmtSilence_(minsSince) + ' (≥' + MISSING_SILENCE_MIN + 'm threshold)',
      flag_codes: [],
    };
  }
  if (flagged) {
    var reasons = decodeReasons_(latest.metar);
    var reasonText = reasons.length > 0
      ? reasons.map(function (r) { return r.code + ' (' + r.text + ')'; }).join(', ')
      : 'internal-check (no specific NO-code)';
    return {
      status: 'FLAGGED',
      minutes_since_last_report: minsSince,
      last_metar: latest.metar, last_valid: latest.valid,
      probable_reason: '$-flag set: ' + reasonText,
      flag_codes: reasons.map(function (r) { return r.code; }),
    };
  }
  if (flaggedInWindow === 0 && missingBuckets <= 1) {
    return {
      status: 'CLEAN',
      minutes_since_last_report: minsSince,
      last_metar: latest.metar, last_valid: latest.valid,
      probable_reason: null,
      flag_codes: [],
    };
  }
  if (flaggedInWindow === 0) {
    return {
      status: 'INTERMITTENT',
      minutes_since_last_report: minsSince,
      last_metar: latest.metar, last_valid: latest.valid,
      probable_reason: missingBuckets + ' hour(s) missing in scan window',
      flag_codes: [],
    };
  }
  // Was flagged earlier — RECOVERED if last 2 are clean + no gaps.
  if (rows.length >= 2 && !hasMaintenanceFlag_(rows[0].metar) && !hasMaintenanceFlag_(rows[1].metar) && missingBuckets === 0) {
    return {
      status: 'RECOVERED',
      minutes_since_last_report: minsSince,
      last_metar: latest.metar, last_valid: latest.valid,
      probable_reason: 'recent $-flag cleared; last two reports clean',
      flag_codes: [],
    };
  }
  return {
    status: 'INTERMITTENT',
    minutes_since_last_report: minsSince,
    last_metar: latest.metar, last_valid: latest.valid,
    probable_reason: flaggedInWindow + ' flagged + ' + missingBuckets + ' missing in window',
    flag_codes: [],
  };
}


// =====================================================================
// 6. STATE LOG (history-aware INTERMITTENT)
// =====================================================================
//
// Per-station rolling 6-hour state log persisted in a Sheet so the
// SUAD-spec INTERMITTENT detector can see flapping/recovery patterns
// across runs. Schema:
//
//   StateLog tab columns: Station | Hour ISO | State (OK|FLAGGED|MISSING)
//
// One row per (station, hour). We replace an existing row when we
// see the same hour bucket re-classify, append otherwise. After every
// scan, prune entries older than 7 days to keep the sheet bounded.

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    // No bound spreadsheet (script run from editor before spreadsheet
    // attached). Create a new one and bind it.
    ss = SpreadsheetApp.create('OWL Status — auto');
    PropertiesService.getScriptProperties().setProperty('OWL_SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function bucketHourIso_(d) {
  var x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
  return x.toISOString();
}

function statusToLogState_(status) {
  if (status === 'FLAGGED') return 'FLAGGED';
  if (status === 'MISSING' || status === 'OFFLINE' || status === 'NO DATA') return 'MISSING';
  return 'OK';
}

/** Read every entry into { station: [ {at, state}, ... ] } sorted oldest-first. */
function readStateLog_() {
  // ScriptCache primary (fast, in-memory, ≤ 6 h TTL on Apps Script's
  // promise). Sheet fallback for cold starts / cache evictions.
  var cache = CacheService.getScriptCache();
  var raw = cache.get('state_log_v2');
  if (raw) {
    try { return JSON.parse(raw); } catch (_) { /* fall through */ }
  }
  var sh = getOrCreateSheet_(TAB_STATE_LOG, ['JSON Snapshot']);
  // The new schema stores the entire log as a single JSON cell at A2.
  // The old schema stored row-per-(station, hour). We support both for
  // a smooth upgrade path.
  if (sh.getLastRow() < 2) return {};
  var firstRow = sh.getRange(2, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var first = String(firstRow[0] || '').trim();
  // New schema: cell A2 starts with '{'.
  if (first.charAt(0) === '{') {
    try { return JSON.parse(first); } catch (_) { return {}; }
  }
  // Old schema: read row-by-row (legacy upgrade path).
  var lastRow = sh.getLastRow();
  var vals = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  var byStation = {};
  for (var i = 0; i < vals.length; i++) {
    var st = String(vals[i][0] || '').trim().toUpperCase();
    var at = String(vals[i][1] || '').trim();
    var state = String(vals[i][2] || '').trim();
    if (!st || !at || !state) continue;
    if (!byStation[st]) byStation[st] = [];
    byStation[st].push({ at: at, state: state });
  }
  for (var s in byStation) {
    byStation[s].sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    if (byStation[s].length > STATE_LOG_HOURS) {
      byStation[s] = byStation[s].slice(byStation[s].length - STATE_LOG_HOURS);
    }
  }
  return byStation;
}

/** Persist the rolling log as a single JSON cell + ScriptCache mirror.
 *  This replaced the legacy row-per-(station, hour) schema because the
 *  legacy schema burned ~5,500 cell writes per scan on the full 920-
 *  station network — well past Apps Script's 1M-cells/day consumer
 *  quota. Single-cell JSON: 1 cell write per scan, regardless of
 *  station count. */
function writeStateLog_(byStation) {
  var json = JSON.stringify(byStation);
  // Cache for fast same-process reads. ScriptCache caps at 100 KB —
  // 30-station × 6 hours fits trivially; 920-station × 6 hours is
  // ~165 KB and won't fit, so we tolerate the cache miss in that case.
  if (json.length < 100 * 1024) {
    CacheService.getScriptCache().put('state_log_v2', json, 6 * 3600);
  }
  // Persist to sheet (always — for cross-process warm-restore).
  var sh = getOrCreateSheet_(TAB_STATE_LOG, ['JSON Snapshot']);
  // Wipe any legacy row-schema data first (one-time upgrade cost).
  if (sh.getLastRow() > 2 || sh.getLastColumn() > 1) {
    sh.clearContents();
    sh.getRange(1, 1).setValue('JSON Snapshot').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.getRange(2, 1).setValue(json);
}

/** Detect the SUAD-spec INTERMITTENT signature in a single station's
 *  log: a run of ≥ N MISSING entries followed by ≥ 1 OK entry. */
function detectIntermittentRun_(log) {
  var i = 0;
  while (i < log.length) {
    if (log[i].state !== 'MISSING') { i++; continue; }
    var n = 0;
    while (i + n < log.length && log[i + n].state === 'MISSING') n++;
    if (n >= INTERMITTENT_MISSING_RUN) {
      var after = log[i + n];
      if (after && after.state === 'OK') return n;
    }
    i += Math.max(n, 1);
  }
  return 0;
}

/** Apply history-aware refinement to a fresh classification. */
function refineWithHistory_(row, prevLog, now) {
  var hourKey = bucketHourIso_(now);
  var newLog = (prevLog || []).slice();
  var entryState = statusToLogState_(row.status);
  // Replace any same-hour entry; otherwise append.
  var found = false;
  for (var i = 0; i < newLog.length; i++) {
    if (newLog[i].at === hourKey) {
      newLog[i] = { at: hourKey, state: entryState };
      found = true;
      break;
    }
  }
  if (!found) newLog.push({ at: hourKey, state: entryState });
  if (newLog.length > STATE_LOG_HOURS) newLog = newLog.slice(newLog.length - STATE_LOG_HOURS);

  var status = row.status;
  var probable = row.probable_reason;
  var allOk = true;
  for (var j = 0; j < newLog.length; j++) {
    if (newLog[j].state !== 'OK') { allOk = false; break; }
  }
  // Rule 1: continuously OK overrides single-window noise.
  if (allOk && row.status === 'INTERMITTENT') {
    status = 'CLEAN';
    probable = 'history shows sustained healthy reporting; bucket noise overridden';
  }
  // Rule 2: SUAD signature — MISSING run ≥ N then OK → INTERMITTENT.
  var runLen = detectIntermittentRun_(newLog);
  if (row.status === 'CLEAN' && runLen >= INTERMITTENT_MISSING_RUN) {
    status = 'INTERMITTENT';
    probable = 'comm gap pattern: ' + runLen + ' consecutive MISSING hours, then recovered';
  }
  // Rule 3: persistent FLAGGED — enrich reason but don't escalate.
  if (row.status === 'FLAGGED') {
    var flagRun = 0;
    for (var k = newLog.length - 1; k >= 0; k--) {
      if (newLog[k].state === 'FLAGGED') flagRun++;
      else break;
    }
    if (flagRun >= 3) {
      probable = (probable || '$-flag set') + ' (persisted ' + flagRun + '+ hours)';
    }
  }
  return {
    status: status,
    minutes_since_last_report: row.minutes_since_last_report,
    last_metar: row.last_metar,
    last_valid: row.last_valid,
    probable_reason: probable,
    flag_codes: row.flag_codes,
    state_log: newLog,
  };
}


// =====================================================================
// 7. NCEI CROSS-CHECK
// =====================================================================
//
// Validates disputed (INTERMITTENT/MISSING/FLAGGED) classifications
// against NCEI's authoritative archive. Maintenance-aware: skips
// fetching during NCEI scheduled outages so we don't burn budget on
// requests that would all fail.
//
// NCEI is slow (~500 ms / call); we cap the cross-check pass at 30
// stations per scan, rotating which ones get checked over multiple
// cycles. A round-robin pointer in Script Properties tracks where
// we left off.

var NCEI_BASE = 'https://www.ncei.noaa.gov/access/services/data/v1';

function fetchNceiBuckets_(stationId, hoursBack) {
  if (nceiMaintActive_()) return null;
  var end = new Date();
  var start = new Date(end.getTime() - (hoursBack || 4) * 3600000);
  var fmt = function (d) { return d.toISOString().slice(0, 19); };
  var url = NCEI_BASE +
    '?dataset=global-hourly&stations=' + encodeURIComponent(stationId) +
    '&dataTypes=REPORT_TYPE' +
    '&startDate=' + encodeURIComponent(fmt(start)) +
    '&endDate=' + encodeURIComponent(fmt(end)) +
    '&format=json';
  var data = fetchJson_(url, { timeoutMs: 12000, retries: 1 });
  if (!data || !Array.isArray(data)) return null;
  var hours = {};
  var lastSeen = '';
  for (var i = 0; i < data.length; i++) {
    if (!data[i].DATE) continue;
    hours[data[i].DATE.slice(0, 13)] = true;
    if (data[i].DATE > lastSeen) lastSeen = data[i].DATE;
  }
  return { buckets: Object.keys(hours).length, lastSeen: lastSeen };
}


// =====================================================================
// 8. HAZARD SOURCES
// =====================================================================
//
// Aggregates every hazard feed OWL pulls. Each fetcher catches its
// own errors and returns an empty default — never let one upstream
// outage block the whole hazard section.

/** NWS api.weather.gov active CAP alerts. */
function fetchCapAlerts_() {
  var url = 'https://api.weather.gov/alerts/active';
  var data = fetchJson_(url, {
    headers: { 'Accept': 'application/geo+json', 'Feature-Flags': NWS_FEATURE_FLAGS },
    timeoutMs: 25000, retries: 1,
  });
  if (!data || !data.features) return [];
  return data.features.map(function (f) {
    var p = f.properties || {};
    return {
      id:        String(p.id || ''),
      event:     String(p.event || ''),
      severity:  String(p.severity || ''),
      urgency:   String(p.urgency || ''),
      area_desc: String(p.areaDesc || ''),
      sent:      String(p.sent || ''),
      expires:   String(p.expires || ''),
      sender:    String(p.senderName || ''),
      headline:  String(p.headline || ''),
    };
  });
}

/** AWC SIGMETs + AIRMETs (Alaska). */
function fetchAwcSigmets_() {
  var url = 'https://aviationweather.gov/api/data/airsigmet?format=json';
  var data = fetchJson_(url, { timeoutMs: 15000, retries: 1 });
  return Array.isArray(data) ? data : [];
}

/** AWC G-AIRMETs (CONUS, replaces text AIRMETs since Jan 2025). */
function fetchAwcGAirmets_() {
  var url = 'https://aviationweather.gov/api/data/gairmet?format=json';
  var data = fetchJson_(url, { timeoutMs: 15000, retries: 1 });
  return Array.isArray(data) ? data : [];
}

/** AWC Center Weather Advisories. */
function fetchAwcCwa_() {
  var url = 'https://aviationweather.gov/api/data/cwa?format=json';
  var data = fetchJson_(url, { timeoutMs: 15000, retries: 1 });
  return Array.isArray(data) ? data : [];
}

/** NHC active tropical cyclones. */
function fetchNhcStorms_() {
  var url = 'https://www.nhc.noaa.gov/CurrentStorms.json';
  var data = fetchJson_(url, { timeoutMs: 15000, retries: 1 });
  if (!data || !data.activeStorms) return [];
  return data.activeStorms.map(function (s) {
    return {
      id: String(s.id || ''),
      name: String(s.name || ''),
      classification: String(s.classification || ''),
      intensity_kt: String(s.intensity || ''),
      pressure_mb: String(s.pressure || ''),
      movement: String(s.movement || ''),
      lat: Number(s.latitudeNumeric || 0),
      lon: Number(s.longitudeNumeric || 0),
      public_advisory: String(s.publicAdvisory && s.publicAdvisory.url || ''),
    };
  });
}

/** NWS Tsunami bulletins (NTWC + PTWC). Atom feeds, parsed by regex. */
function fetchTsunami_() {
  var feeds = [
    { id: 'NTWC', url: 'https://www.tsunami.gov/events/xml/PAAQAtomAll.xml' },
    { id: 'PTWC', url: 'https://www.tsunami.gov/events/xml/PHEBAtomAll.xml' },
  ];
  var out = [];
  for (var i = 0; i < feeds.length; i++) {
    var xml = fetchText_(feeds[i].url, { timeoutMs: 10000, retries: 1 });
    if (!xml) continue;
    var entries = xml.match(/<entry[\s\S]*?<\/entry>/g) || [];
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j];
      var titleM = e.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      var idM    = e.match(/<id>([^<]*)<\/id>/);
      var upM    = e.match(/<updated>([^<]+)<\/updated>/);
      var sumM   = e.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
      var title = titleM ? decodeXml_(titleM[1]) : '';
      var level = 'unknown';
      if (/WARNING/i.test(title)) level = 'warning';
      else if (/WATCH/i.test(title)) level = 'watch';
      else if (/ADVISORY/i.test(title)) level = 'advisory';
      else if (/INFORMATION/i.test(title)) level = 'info';
      out.push({
        center: feeds[i].id,
        title: title.trim(),
        id: idM ? idM[1] : '',
        issued: upM ? upM[1] : '',
        summary: sumM ? decodeXml_(sumM[1]).replace(/\s+/g, ' ').trim().slice(0, 600) : '',
        level: level,
      });
    }
  }
  return out;
}
function decodeXml_(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** NIFC active wildfires (WFIGS ArcGIS). */
function fetchNifcFires_() {
  var url = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
            'WFIGS_Incident_Locations_Current/FeatureServer/0/query' +
            '?where=' + encodeURIComponent('FireOutDateTime IS NULL') +
            '&outFields=' + encodeURIComponent('IrwinID,IncidentName,POOState,IncidentSize,PercentContained,IncidentStatusCategory') +
            '&returnGeometry=true&outSR=4326&f=json';
  var data = fetchJson_(url, { timeoutMs: 25000, retries: 1 });
  if (!data || !data.features) return [];
  return data.features.map(function (f) {
    var a = f.attributes || {};
    return {
      id:    String(a.IrwinID || ''),
      name:  String(a.IncidentName || 'Unknown'),
      state: String(a.POOState || ''),
      acres: a.IncidentSize != null ? Number(a.IncidentSize) : null,
      containment_pct: a.PercentContained != null ? Number(a.PercentContained) : null,
      status: a.IncidentStatusCategory != null ? String(a.IncidentStatusCategory) : null,
      lat: f.geometry && f.geometry.y ? Number(f.geometry.y) : 0,
      lon: f.geometry && f.geometry.x ? Number(f.geometry.x) : 0,
    };
  }).filter(function (r) { return r.id && isFinite(r.lat); });
}

/** NCEP Senior Duty Meteorologist administrative bulletin. */
function fetchAdminBulletin_() {
  var listUrl = 'https://api.weather.gov/products/types/ADASDM/locations/KWNO';
  var list = fetchJson_(listUrl, {
    headers: { 'Accept': 'application/geo+json', 'Feature-Flags': NWS_FEATURE_FLAGS },
    timeoutMs: 10000, retries: 1,
  });
  var items = (list && list['@graph']) || [];
  if (items.length === 0) return null;
  var prodUrl = 'https://api.weather.gov/products/' + items[0].id;
  var prod = fetchJson_(prodUrl, {
    headers: { 'Accept': 'application/geo+json' },
    timeoutMs: 10000, retries: 1,
  });
  if (!prod || !prod.productText) return null;
  var text = String(prod.productText).trim();
  return {
    id: prod.id || items[0].id,
    issued: prod.issuanceTime || items[0].issuanceTime || '',
    text: text,
    preview: text.slice(0, 280),
  };
}

/** US Drought Monitor — weekly nationwide GeoJSON. Each polygon
 *  carries a DM property (0-4) for severity. We aggregate counts
 *  per category for the dashboard and pass the full FeatureCollection
 *  through to the map view for shading. Cached 24 hours since the
 *  USDM updates once a week. */
function fetchUsdmCurrent_() {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('usdm_v1');
  if (raw) {
    try { return JSON.parse(raw); } catch (_) { /* fall through */ }
  }
  var data = fetchJson_('https://droughtmonitor.unl.edu/data/json/usdm_current.json',
    { timeoutMs: 25000, retries: 1 });
  if (!data || !data.features) return null;
  var counts = { D0: 0, D1: 0, D2: 0, D3: 0, D4: 0 };
  for (var i = 0; i < data.features.length; i++) {
    var dm = data.features[i].properties && data.features[i].properties.DM;
    var k = 'D' + (typeof dm === 'string' ? Number(dm) : dm);
    if (counts[k] != null) counts[k]++;
  }
  var summary = {
    counts: counts,
    total_polygons: data.features.length,
    effective_date: (data.metadata && data.metadata.date) || null,
  };
  // Cache only the summary in ScriptCache (the full GeoJSON can be
  // multi-MB and exceed the 100 KB cap). The map view fetches the
  // GeoJSON URL directly when it needs the polygons.
  cache.put('usdm_v1', JSON.stringify(summary), 24 * 3600);
  return summary;
}

/** EPA AirNow current AQI for a single (lat, lon). Requires
 *  AIRNOW_API_KEY Script Property; returns null when unset (so the
 *  drill panel just doesn't render that section). Free key from
 *  https://docs.airnowapi.org/ */
function fetchAirNowAt_(lat, lon, radiusMi) {
  var key = PROP('AIRNOW_API_KEY', '');
  if (!key) return null;
  radiusMi = radiusMi || 25;
  var url = 'https://www.airnowapi.org/aq/observation/latLong/current/' +
    '?format=application/json' +
    '&latitude=' + encodeURIComponent(lat) +
    '&longitude=' + encodeURIComponent(lon) +
    '&distance=' + encodeURIComponent(radiusMi) +
    '&API_KEY=' + encodeURIComponent(key);
  var data = fetchJson_(url, { timeoutMs: 10000, retries: 1 });
  if (!Array.isArray(data) || data.length === 0) return null;
  var params = data.filter(function (r) { return typeof r.AQI === 'number'; })
    .map(function (r) {
      return {
        name: String(r.ParameterName || ''),
        aqi: Number(r.AQI),
        category: String((r.Category && r.Category.Name) || 'Unknown'),
      };
    });
  if (!params.length) return null;
  var worst = params.reduce(function (a, b) { return a.aqi >= b.aqi ? a : b; });
  return {
    area: String(data[0].ReportingArea || ''),
    state: String(data[0].StateCode || ''),
    aqi: worst.aqi,
    category: worst.category,
    dominant_parameter: worst.name,
    parameters: params,
  };
}

/** NOAA NWPS — National Water Prediction Service. Returns the nearest
 *  forecast-enabled river gauge for a given coordinate, with current
 *  stage/flow + flood-stage thresholds + 7-day forecast peak.
 *  Catalog (~10k gauges) cached 24h. */
function fetchNwpsCatalog_() {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('nwps_catalog_v1');
  if (raw) {
    try { return JSON.parse(raw); } catch (_) { /* fall through */ }
  }
  var data = fetchJson_('https://api.water.noaa.gov/nwps/v1/gauges',
    { timeoutMs: 30000, retries: 1 });
  if (!data || !data.gauges) return [];
  var gauges = data.gauges.map(function (g) {
    return {
      lid: String(g.lid || '').toUpperCase(),
      name: String(g.name || ''),
      state: String(g.state || ''),
      lat: Number(g.latitude || 0),
      lon: Number(g.longitude || 0),
      waterbody: g.waterbody ? String(g.waterbody) : null,
    };
  }).filter(function (g) { return g.lid && isFinite(g.lat); });
  // Cache as JSON. May exceed 100KB — chunk if needed; for now we
  // accept that very large catalogs may not cache and re-fetch.
  try { cache.put('nwps_catalog_v1', JSON.stringify(gauges), 24 * 3600); }
  catch (_) { /* over 100KB; OK to skip cache */ }
  return gauges;
}

function fetchNwpsNearest_(lat, lon, radiusKm) {
  radiusKm = radiusKm || 75;
  var catalog = fetchNwpsCatalog_();
  if (!catalog.length) return null;
  var best = null, bestKm = Infinity;
  for (var i = 0; i < catalog.length; i++) {
    var g = catalog[i];
    var dLat = (lat - g.lat) * Math.PI / 180;
    var dLon = (lon - g.lon) * Math.PI / 180 * Math.cos((lat + g.lat) * Math.PI / 360);
    var d = Math.hypot(dLat, dLon) * 6371;
    if (d > radiusKm) continue;
    if (d < bestKm) { best = g; bestKm = d; }
  }
  if (!best) return null;
  // Fetch metadata + stage/flow series in parallel? UrlFetchApp doesn't
  // do parallel. Sequential is fine — only triggered on drill clicks.
  var meta = fetchJson_('https://api.water.noaa.gov/nwps/v1/gauges/' + encodeURIComponent(best.lid),
    { timeoutMs: 10000, retries: 1 });
  var sf = fetchJson_('https://api.water.noaa.gov/nwps/v1/gauges/' + encodeURIComponent(best.lid) + '/stageflow',
    { timeoutMs: 10000, retries: 1 });
  var cat = (meta && meta.flood && meta.flood.categories) || {};
  var stages = {
    action_ft:    cat.action    && cat.action.stage    || null,
    minor_ft:     cat.minor     && cat.minor.stage     || null,
    moderate_ft:  cat.moderate  && cat.moderate.stage  || null,
    major_ft:     cat.major     && cat.major.stage     || null,
  };
  var obs = (sf && sf.observed && sf.observed.data) || [];
  var fc  = (sf && sf.forecast && sf.forecast.data) || [];
  var latestObs = obs.length ? obs[obs.length - 1] : null;
  // Forecast peak.
  var peak = null;
  for (var j = 0; j < fc.length; j++) {
    if (fc[j].primary == null) continue;
    if (!peak || fc[j].primary > peak.stage_ft) {
      peak = { stage_ft: fc[j].primary, timestamp: String(fc[j].validTime || '') };
    }
  }
  function categorize(stage) {
    if (stage == null) return 'none';
    if (stages.major_ft != null && stage >= stages.major_ft) return 'major';
    if (stages.moderate_ft != null && stage >= stages.moderate_ft) return 'moderate';
    if (stages.minor_ft != null && stage >= stages.minor_ft) return 'minor';
    if (stages.action_ft != null && stage >= stages.action_ft) return 'action';
    return 'none';
  }
  var maxStage = Math.max(
    latestObs && latestObs.primary != null ? latestObs.primary : -Infinity,
    peak ? peak.stage_ft : -Infinity
  );
  return {
    gauge: { lid: best.lid, name: best.name, state: best.state, distance_km: bestKm,
             waterbody: best.waterbody, lat: best.lat, lon: best.lon },
    stages: stages,
    latest: latestObs ? {
      timestamp: String(latestObs.validTime || ''),
      stage_ft: latestObs.primary,
      flow_cfs: latestObs.secondary,
    } : null,
    peak_forecast: peak,
    flood_status: categorize(maxStage),
    nwps_url: 'https://water.noaa.gov/gauges/' + best.lid,
  };
}

/** Aggregate every hazard source. Used by hazards endpoint + the
 *  status digest email + the dashboard hazard summary. */
function buildHazardContext_() {
  // Run all the slow fetches; each catches its own errors.
  var capAlerts   = [];
  var sigmets     = [];
  var gairmets    = [];
  var cwas        = [];
  var storms      = [];
  var tsunami     = [];
  var fires       = [];
  var adminMsg    = null;
  var usdm        = null;
  var stale       = [];
  try { capAlerts = fetchCapAlerts_(); }    catch (e) { stale.push('cap'); }
  try { sigmets   = fetchAwcSigmets_(); }   catch (e) { stale.push('sigmet'); }
  try { gairmets  = fetchAwcGAirmets_(); }  catch (e) { stale.push('gairmet'); }
  try { cwas      = fetchAwcCwa_(); }       catch (e) { stale.push('cwa'); }
  try { storms    = fetchNhcStorms_(); }    catch (e) { stale.push('nhc'); }
  try { tsunami   = fetchTsunami_(); }      catch (e) { stale.push('tsunami'); }
  try { fires     = fetchNifcFires_(); }    catch (e) { stale.push('nifc'); }
  try { adminMsg  = fetchAdminBulletin_(); } catch (e) { stale.push('ncep-sdm'); }
  try { usdm      = fetchUsdmCurrent_(); }  catch (e) { stale.push('usdm'); }

  // CAP grouping.
  var byEvent = {};
  for (var i = 0; i < capAlerts.length; i++) {
    var k = capAlerts[i].event + '|' + capAlerts[i].severity;
    if (!byEvent[k]) byEvent[k] = { event: capAlerts[i].event, severity: capAlerts[i].severity, count: 0 };
    byEvent[k].count++;
  }
  var capByEvent = Object.keys(byEvent).map(function (k) { return byEvent[k]; })
    .sort(function (a, b) { return b.count - a.count; });

  // SIGMET grouping.
  var bySigHaz = {};
  for (var s = 0; s < sigmets.length; s++) {
    var hk = sigmets[s].hazard || 'OTHER';
    bySigHaz[hk] = (bySigHaz[hk] || 0) + 1;
  }

  // Wildfires by acreage (top 8).
  var topFires = fires.slice().sort(function (a, b) {
    return (b.acres || 0) - (a.acres || 0);
  }).slice(0, 8);

  // Tsunami filter — only active levels.
  var tsActive = tsunami.filter(function (t) {
    return t.level === 'warning' || t.level === 'watch' || t.level === 'advisory';
  }).slice(0, 5);

  return {
    built_at: new Date().toISOString(),
    cap_alerts: { total: capAlerts.length, by_event: capByEvent.slice(0, 12), sample: capAlerts.slice(0, 8) },
    aviation: {
      sigmet_count:  sigmets.length,
      sigmet_by_hazard: Object.keys(bySigHaz).map(function (k) { return { hazard: k, count: bySigHaz[k] }; }),
      gairmet_count: gairmets.length,
      cwa_count:     cwas.length,
    },
    tropical_storms: storms,
    tsunami: tsActive,
    wildfires: topFires,
    admin_message: adminMsg ? { issued: adminMsg.issued, preview: adminMsg.preview } : null,
    ncei_maintenance: { active: nceiMaintActive_() },
    drought: usdm,
    stale_sources: stale,
  };
}


// =====================================================================
// 9. ACTIVE-USERS HEARTBEAT
// =====================================================================
//
// Every page-load fires a heartbeat POST that lands here. We log to
// two sheets: ActiveUsers (latest row per user, keyed by email) for
// the "current concurrent users" counter, and UserHistory (append-
// only) for trend graphs and audit. Idle-out is computed on read:
// any row whose `last_seen` is > ACTIVE_TIMEOUT_MIN ago counts as
// inactive.
//
// Anonymous heartbeats (no auth) are tagged "anonymous" with the
// page they hit; that's enough signal for "the dashboard has
// traffic" without requiring users to sign in.

var ACTIVE_TIMEOUT_MIN = 5;

function trackActiveUser_(user, page) {
  user = String(user || 'anonymous').trim().toLowerCase();
  page = String(page || '').trim();
  var nowIso = new Date().toISOString();
  // ActiveUsers: latest-row-per-user upsert.
  var act = getOrCreateSheet_(TAB_ACTIVE_USERS, ['Email', 'Last Seen UTC', 'Page']);
  var lastRow = act.getLastRow();
  var found = false;
  if (lastRow >= 2) {
    var emails = act.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i][0] || '').trim().toLowerCase() === user) {
        act.getRange(i + 2, 2, 1, 2).setValues([[nowIso, page]]);
        found = true;
        break;
      }
    }
  }
  if (!found) act.appendRow([user, nowIso, page]);
  // UserHistory: append-only.
  var hist = getOrCreateSheet_(TAB_USER_HIST, ['Timestamp UTC', 'Email', 'Page']);
  hist.appendRow([nowIso, user, page]);
  // Bound history to ~500 rows.
  var hl = hist.getLastRow();
  if (hl > 502) hist.deleteRows(2, hl - 502);
}

/** ADMIN_EMAILS gate — comma-separated allow-list in Script Properties.
 *  Returns {allowed: true} when the gate is unset (admin-open) or when
 *  the current user is on the list. Otherwise {allowed: false} with a
 *  user-friendly reason.
 *
 *  Apps Script web apps deployed with "Execute as: User accessing the
 *  web app" expose Session.getActiveUser().getEmail() — that's the
 *  signal we check. Web apps deployed with "Execute as: Me" do NOT
 *  expose the visitor's email (intentional sandbox boundary), so the
 *  gate is effectively unenforceable in that mode. We surface that as
 *  a config warning rather than a hard fail. */
function enforceAdminAccess_() {
  var allowList = PROP('ADMIN_EMAILS', '');
  if (!allowList) return { allowed: true, mode: 'open' };
  var allowed = allowList.split(',').map(function (s) {
    return s.trim().toLowerCase();
  }).filter(Boolean);
  var viewer = '';
  try {
    viewer = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (_) { /* may throw under "execute as Me" deployments */ }
  if (!viewer) {
    return {
      allowed: false,
      mode: 'unknown-viewer',
      message:
        'ADMIN_EMAILS is set but the web app cannot identify the viewer. ' +
        'Apps Script only exposes viewer email when the deployment is configured ' +
        'as "Execute as: User accessing the web app" AND the access scope is ' +
        '"Anyone in your Workspace" (not "Anyone"). Either redeploy with those ' +
        'settings, OR clear the ADMIN_EMAILS Script Property to leave admin open.',
    };
  }
  if (allowed.indexOf(viewer) === -1) {
    return {
      allowed: false,
      mode: 'not-listed',
      viewer: viewer,
      message: 'Access denied. ' + viewer + ' is not on the ADMIN_EMAILS allow-list.',
    };
  }
  return { allowed: true, mode: 'allowed', viewer: viewer };
}

// ---- Banners (sticky operator messages — legacy parity) ----------
//
// James Glenn's app fed sticky banners from a Sheet column. We do the
// same — operators paste/edit rows in the Banners tab and they appear
// at the top of every page until removed. Schema:
//
//   Banners: Active(TRUE/FALSE) | Severity(info|warning|critical) |
//            Message | Created UTC
//
// Cached 60s in ScriptCache so the dashboard polls don't hit the
// Sheet on every tick.

function fetchBanners_() {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('banners_v1');
  if (raw) {
    try { return JSON.parse(raw); } catch (_) { /* fall through */ }
  }
  var sh;
  try { sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_BANNERS); }
  catch (_) { return []; }
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    var active = String(vals[i][0]).toLowerCase();
    if (active !== 'true' && active !== '1' && active !== 'yes') continue;
    var sev = String(vals[i][1] || 'info').toLowerCase();
    if (['info', 'warning', 'critical'].indexOf(sev) === -1) sev = 'info';
    var msg = String(vals[i][2] || '').trim();
    var created = String(vals[i][3] || '').trim();
    if (!msg) continue;
    rows.push({ severity: sev, message: msg, created: created });
  }
  cache.put('banners_v1', JSON.stringify(rows), 60);
  return rows;
}

// ---- Sources Health (admin tab + JSON endpoint) -------------------
//
// Returns the full canonical source registry with their last-fetch
// status. Replaces the legacy "sources" sheet that James Glenn had
// to maintain by hand — we generate it from the wired-in fetcher
// list directly. Operators can audit "is OWL pulling everything we
// expect?" in one place.

function buildSourcesRegistry_() {
  var hazards = null;
  try { hazards = JSON.parse(CacheService.getScriptCache().get('hazards_v1') || 'null'); }
  catch (_) { /* ignore */ }
  var stale = (hazards && hazards.stale_sources) || [];
  function entry(id, name, url, used_for) {
    return {
      id: id, name: name, url: url, used_for: used_for,
      stale: stale.indexOf(id) >= 0,
    };
  }
  return [
    entry('iem',          'Iowa Mesonet',           'https://mesonet.agron.iastate.edu', 'Primary METAR batch fetch'),
    entry('awc-metar',    'AWC METAR API',          'https://aviationweather.gov/api/data/metar', 'Per-station fallback for IEM orphans'),
    entry('ncei',         'NCEI Access Services',   'https://www.ncei.noaa.gov/access/services/data/v1', 'Cross-check against authoritative archive'),
    entry('cap',          'NWS CAP alerts',         'https://api.weather.gov/alerts/active', 'Active warnings/watches/advisories'),
    entry('ncep-sdm',     'NCEP SDM bulletins',     'https://api.weather.gov/products/types/ADASDM/locations/KWNO', 'Network-wide outage admin messages'),
    entry('sigmet',       'AWC SIGMETs',            'https://aviationweather.gov/api/data/airsigmet', 'SIGMETs + Alaska AIRMETs'),
    entry('gairmet',      'AWC G-AIRMETs',          'https://aviationweather.gov/api/data/gairmet', 'CONUS gridded AIRMETs (post-Jan 2025)'),
    entry('cwa',          'AWC CWAs',               'https://aviationweather.gov/api/data/cwa', 'Center Weather Advisories'),
    entry('nhc',          'NHC tropical',           'https://www.nhc.noaa.gov/CurrentStorms.json', 'Active tropical cyclones'),
    entry('tsunami',      'NWS Tsunami (NTWC+PTWC)','https://www.tsunami.gov/', 'Active tsunami bulletins'),
    entry('nifc',         'NIFC wildfires (WFIGS)', 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer', 'Active US wildfires'),
    entry('usdm',         'US Drought Monitor',     'https://droughtmonitor.unl.edu/data/json/usdm_current.json', 'Weekly drought severity'),
    entry('airnow',       'EPA AirNow',             'https://www.airnowapi.org/', 'AQI per coordinate (key required)'),
    entry('nwps',         'NOAA NWPS',              'https://api.water.noaa.gov/nwps/v1/', 'Nearest river gauge + flood stages'),
  ];
}

function readActiveUserSummary_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_ACTIVE_USERS);
  if (!sh || sh.getLastRow() < 2) return { active: 0, unique: 0, rows: [] };
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  var nowMs = Date.now();
  var threshold = ACTIVE_TIMEOUT_MIN * 60 * 1000;
  var active = 0;
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    var email = String(vals[i][0] || '').trim();
    var seen  = String(vals[i][1] || '').trim();
    var page  = String(vals[i][2] || '').trim();
    if (!email) continue;
    var seenMs = Date.parse(seen) || 0;
    var minutesAgo = seenMs > 0 ? Math.round((nowMs - seenMs) / 60000) : null;
    var isActive = seenMs > 0 && (nowMs - seenMs) <= threshold;
    if (isActive) active++;
    rows.push({ email: email, last_seen: seen, page: page, minutes_ago: minutesAgo, active: isActive });
  }
  rows.sort(function (a, b) {
    return Date.parse(b.last_seen) - Date.parse(a.last_seen);
  });
  return { active: active, unique: rows.length, rows: rows };
}


// =====================================================================
// 10. SCAN ORCHESTRATION (renumbered after AI Brief removal)
// =====================================================================

/** Read cached scan from Script Cache + Sheet snapshot. */
function readScanCache_() {
  var raw = CacheService.getScriptCache().get('scan_v1');
  if (raw) {
    try { return JSON.parse(raw); } catch (_) { /* fall through */ }
  }
  // Cache miss → pull from Health sheet snapshot.
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_HEALTH);
    if (sh && sh.getLastRow() >= 2) {
      var raw2 = sh.getRange(2, 1).getValue();
      if (raw2) return JSON.parse(String(raw2));
    }
  } catch (_) { /* ignore */ }
  return null;
}
function writeScanCache_(state) {
  var json = JSON.stringify(state);
  // ScriptCache caps at 100 KB per entry — chunk if needed.
  if (json.length < 100 * 1024) {
    CacheService.getScriptCache().put('scan_v1', json, CACHE_SCAN_TTL_S);
  }
  // Always persist to sheet for warm-restore across deploys.
  var sh = getOrCreateSheet_(TAB_HEALTH, ['Snapshot JSON']);
  sh.getRange(2, 1).setValue(json);
}

/** Run a full scan: fetch IEM + AWC fallback + classify + history-aware
 *  refinement + persist. Returns the new ScanState. */
function runScan() {
  var t0 = Date.now();
  var stations = getStationList_();
  var hoursBack = 4;
  var raw = fetchAllMetars_(stations, hoursBack);

  // Group by normalized key.
  var byStation = {};
  for (var i = 0; i < raw.length; i++) {
    var k = normKey_(raw[i].station);
    if (!byStation[k]) byStation[k] = [];
    byStation[k].push(raw[i]);
  }

  var now = new Date();
  var start = new Date(now.getTime() - hoursBack * 3600000);
  var expBuckets = expectedHourlyBuckets_(start, now);
  var prevLog = readStateLog_();

  // Classify + refine each station.
  var rows = [];
  var newLog = {};
  for (var s = 0; s < stations.length; s++) {
    var stId = stations[s];
    var key = normKey_(stId);
    var ms = byStation[key] || [];
    var firstPass = classifyOne_(ms, now, expBuckets, null);
    var refined = refineWithHistory_(firstPass, prevLog[stId] || prevLog[key] || [], now);
    rows.push({
      station: stId,
      status: refined.status,
      minutes_since_last_report: refined.minutes_since_last_report,
      last_metar: refined.last_metar,
      last_valid: refined.last_valid,
      probable_reason: refined.probable_reason,
      flag_codes: refined.flag_codes,
      state_log: refined.state_log,
    });
    newLog[stId] = refined.state_log;
  }
  writeStateLog_(newLog);

  var counts = { CLEAN: 0, FLAGGED: 0, MISSING: 0, OFFLINE: 0, INTERMITTENT: 0, RECOVERED: 0, 'NO DATA': 0 };
  for (var r = 0; r < rows.length; r++) counts[rows[r].status] = (counts[rows[r].status] || 0) + 1;

  var state = {
    rows: rows,
    counts: counts,
    total: rows.length,
    scanned_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
  };
  writeScanCache_(state);
  appendHistory_('scan', { total: rows.length, counts: counts, duration_ms: state.duration_ms });
  return state;
}

/** Periodic hazard refresh — pulls all hazard sources into cache. */
function runHazards() {
  var ctx = buildHazardContext_();
  CacheService.getScriptCache().put('hazards_v1', JSON.stringify(ctx), CACHE_HAZARD_TTL_S);
  return ctx;
}

/** Periodic status digest — plain-text status summary. Triggered every
 *  4 hours; only sends mail when DIGEST_RECIPIENTS is set. No AI; pure
 *  data emitted from the live scan + hazard cache. */
function runDigest() {
  var recipients = PROP('DIGEST_RECIPIENTS', '');
  if (!recipients) {
    Logger.log('[digest] DIGEST_RECIPIENTS not set; skipping email');
    return;
  }
  var scan = readScanCache_();
  var hazards = buildHazardContext_();
  var lines = [];
  lines.push('OWL × NWS Systems Status — periodic digest');
  lines.push('Generated: ' + new Date().toUTCString());
  lines.push('');
  if (scan && scan.counts) {
    lines.push('STATUS COUNTS (' + scan.total + ' stations · scan age ' +
      Math.round((Date.now() - Date.parse(scan.scanned_at)) / 60000) + ' min):');
    var keys = ['CLEAN', 'FLAGGED', 'INTERMITTENT', 'MISSING', 'OFFLINE', 'RECOVERED'];
    for (var i = 0; i < keys.length; i++) {
      lines.push('  ' + keys[i] + ': ' + (scan.counts[keys[i]] || 0));
    }
    lines.push('');
    // Top problems.
    var ORDER = { MISSING: 0, FLAGGED: 1, INTERMITTENT: 2 };
    var top = (scan.rows || []).filter(function (r) { return r.status in ORDER; })
      .sort(function (a, b) {
        if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
        return (a.minutes_since_last_report || 1e9) - (b.minutes_since_last_report || 1e9);
      }).slice(0, 12);
    if (top.length) {
      lines.push('TOP PROBLEM STATIONS:');
      for (var j = 0; j < top.length; j++) {
        lines.push('  ' + top[j].station + ' ' + top[j].status + '  silent ' +
          fmtSilence_(top[j].minutes_since_last_report) + '  ' + (top[j].probable_reason || ''));
      }
      lines.push('');
    }
    // Long-missing alert.
    var TWO_W = 14 * 24 * 60;
    var lm = (scan.rows || []).filter(function (r) {
      return r.status === 'MISSING' && r.minutes_since_last_report > TWO_W;
    }).sort(function (a, b) {
      return (b.minutes_since_last_report || 0) - (a.minutes_since_last_report || 0);
    });
    if (lm.length) {
      lines.push('LONG-MISSING ALERT (silent > 14 days — every entry):');
      for (var k = 0; k < lm.length; k++) {
        lines.push('  ' + lm[k].station + '  silent ' + fmtSilence_(lm[k].minutes_since_last_report) +
          '  last_valid=' + (lm[k].last_valid || '?'));
      }
      lines.push('');
    }
  }
  // Hazard summary.
  lines.push('ACTIVE HAZARDS:');
  lines.push('  CAP alerts:  ' + ((hazards.cap_alerts && hazards.cap_alerts.total) || 0));
  lines.push('  SIGMETs:     ' + ((hazards.aviation && hazards.aviation.sigmet_count) || 0));
  lines.push('  G-AIRMETs:   ' + ((hazards.aviation && hazards.aviation.gairmet_count) || 0));
  lines.push('  CWAs:        ' + ((hazards.aviation && hazards.aviation.cwa_count) || 0));
  lines.push('  Tropical:    ' + ((hazards.tropical_storms && hazards.tropical_storms.length) || 0));
  lines.push('  Tsunami:     ' + ((hazards.tsunami && hazards.tsunami.length) || 0));
  lines.push('  Wildfires:   ' + ((hazards.wildfires && hazards.wildfires.length) || 0));
  if (hazards.admin_message) {
    lines.push('');
    lines.push('NCEP SDM ADMIN BULLETIN (issued ' + hazards.admin_message.issued + '):');
    lines.push('  ' + hazards.admin_message.preview);
  }
  if (hazards.ncei_maintenance && hazards.ncei_maintenance.active) {
    lines.push('');
    lines.push('⚠ NCEI MAINTENANCE WINDOW ACTIVE');
  }
  if (hazards.stale_sources && hazards.stale_sources.length) {
    lines.push('');
    lines.push('Stale sources: ' + hazards.stale_sources.join(', '));
  }
  lines.push('');
  lines.push('--');
  lines.push('Generated by OWL × Apps Script · ' + ScriptApp.getService().getUrl());
  MailApp.sendEmail({
    to: recipients,
    subject: 'OWL Status Digest — ' + new Date().toUTCString(),
    body: lines.join('\n'),
  });
  appendHistory_('digest', { recipients: recipients });
}

/** History append — bounded to 500 rows so the tab doesn't grow unbounded. */
function appendHistory_(eventType, data) {
  var sh = getOrCreateSheet_(TAB_HISTORY, ['Timestamp UTC', 'Event', 'JSON']);
  sh.appendRow([new Date().toISOString(), eventType, JSON.stringify(data)]);
  // Prune.
  var lastRow = sh.getLastRow();
  if (lastRow > 502) {
    sh.deleteRows(2, lastRow - 502);
  }
}



// =====================================================================
// 11. WEB APP ROUTES
// =====================================================================
//
// One doGet handles every URL. Path-style routing via ?path=:
//
//   (no path)      → main map UI
//   ?path=admin    → admin dashboard
//   ?path=about    → about page
//   ?api=health    → JSON health
//   ?api=scan      → JSON scan results
//   ?api=hazards   → JSON aggregated hazards
//   ?api=missing   → JSON missing-stations buckets
//   ?api=intermittent → JSON SUAD-spec intermittent list
//   ?api=heartbeat → POST per page load (Active Users tracking)
//   ?api=users     → JSON active/unique user counts
//   ?api=usdm      → JSON US Drought Monitor summary
//   ?api=airnow    → JSON AirNow AQI for ?lat=&lon= (needs API key)
//   ?api=nwps      → JSON nearest river gauge + flood stages
//   ?api=sources   → JSON full source registry + stale-source flags
//   ?api=banners   → JSON sticky operator messages from Banners sheet

function doGet(e) {
  e = e || {};
  var p = (e.parameter || {});
  var apiPath = p.api;

  // ---- API paths return JSON ----
  if (apiPath) {
    return apiResponse_(apiPath, p);
  }

  // ---- HTML paths render templates ----
  var pagePath = (p.path || p.page || '').toLowerCase();
  // Render James Glenn's original templates verbatim. Apps Script's
  // createTemplateFromFile resolves the `<?!= include('Css') ?>`
  // template tags his Index.html uses; createHtmlOutputFromFile would
  // not. .evaluate() runs the template through Apps Script's HTML
  // template engine and returns an HtmlOutput object.
  if (pagePath === 'admin') {
    // Optional gate via ADMIN_EMAILS Script Property. Reuses his
    // exact pattern from the legacy doGet — error → render the same
    // simple "access error" page.
    try {
      enforceAdminAccess_().allowed === false
        ? (function () { throw new Error('Access denied. Set ADMIN_EMAILS or contact administrator.'); })()
        : null;
    } catch (err) {
      return HtmlService.createHtmlOutput(
        '<h2>Access Error</h2><pre>' + String(err.message || err) + '</pre>'
      ).setTitle('Error');
    }
    return HtmlService
      .createTemplateFromFile('Admin')
      .evaluate()
      .setTitle('System Status Admin')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // About page — his exact template.
  if (pagePath === 'about') {
    return HtmlService
      .createTemplateFromFile('About')
      .evaluate()
      .setTitle('NWS Systems Status — About')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // Default: main map — his Index.html exactly as he wrote it.
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('NWS Systems Status')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  e = e || {};
  var p = (e.parameter || {});
  if (p.api === 'heartbeat') {
    var body = {};
    try { body = JSON.parse(e.postData && e.postData.contents || '{}'); } catch (_) {}
    trackActiveUser_(body.user || 'anonymous', body.page || '');
    return jsonResponse_({ ok: true });
  }
  // Default: same as doGet's API path handler.
  return apiResponse_(p.api || 'health', p);
}

function apiResponse_(path, p) {
  if (path === 'health') {
    return jsonResponse_({
      status: 'ok',
      now: new Date().toISOString(),
      ncei_maintenance: nceiMaintActive_(),
      stations: getStationList_().length,
    });
  }
  if (path === 'scan') {
    var s = readScanCache_();
    if (!s) return jsonResponse_({ scanned_at: null, rows: [], total: 0, warming: true });
    return jsonResponse_(s);
  }
  if (path === 'hazards') {
    var raw = CacheService.getScriptCache().get('hazards_v1');
    if (raw) {
      try { return jsonResponse_(JSON.parse(raw)); } catch (_) {}
    }
    return jsonResponse_(buildHazardContext_());
  }
  if (path === 'missing') {
    return jsonResponse_(buildMissingBuckets_());
  }
  if (path === 'intermittent') {
    return jsonResponse_(buildIntermittentList_());
  }
  if (path === 'users') {
    return jsonResponse_(readActiveUserSummary_());
  }
  if (path === 'usdm') {
    return jsonResponse_(fetchUsdmCurrent_() || { warming: true });
  }
  if (path === 'airnow') {
    var lat = Number(p.lat || ''), lon = Number(p.lon || '');
    if (!isFinite(lat) || !isFinite(lon)) {
      return jsonResponse_({ error: 'lat and lon required' });
    }
    return jsonResponse_(fetchAirNowAt_(lat, lon, Number(p.radius_mi || 25)) || { warming: true });
  }
  if (path === 'nwps') {
    var nlat = Number(p.lat || ''), nlon = Number(p.lon || '');
    if (!isFinite(nlat) || !isFinite(nlon)) {
      return jsonResponse_({ error: 'lat and lon required' });
    }
    return jsonResponse_(fetchNwpsNearest_(nlat, nlon, Number(p.radius_km || 75)) || { warming: true });
  }
  if (path === 'sources') {
    return jsonResponse_({ sources: buildSourcesRegistry_() });
  }
  if (path === 'banners') {
    return jsonResponse_({ banners: fetchBanners_() });
  }
  return jsonResponse_({ error: 'unknown api path: ' + path }, 404);
}

function jsonResponse_(obj, code) {
  // Apps Script's HtmlService doesn't support custom HTTP codes for
  // ContentService responses — code is informational only.
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Missing-station buckets — auto-exit > 3d / > 1wk / > 2wk + all. */
function buildMissingBuckets_() {
  var scan = readScanCache_();
  if (!scan) return { warming: true, all_missing: [], over_3_days: [], over_1_week: [], over_2_weeks: [] };
  var THREE_D = 3 * 24 * 60, ONE_W = 7 * 24 * 60, TWO_W = 14 * 24 * 60;
  var all = [], over3 = [], over7 = [], over14 = [];
  for (var i = 0; i < scan.rows.length; i++) {
    var r = scan.rows[i];
    if (r.status !== 'MISSING') continue;
    var m = r.minutes_since_last_report;
    var slim = {
      station: r.station,
      status: r.status,
      minutes_since_last_report: m == null ? -1 : m,
      silence_human: m == null ? 'unknown' : fmtSilence_(m),
      last_valid: r.last_valid,
      probable_reason: r.probable_reason,
      alert: m != null && m > TWO_W,
    };
    all.push(slim);
    if (m == null) continue;
    if (m > TWO_W) over14.push(slim);
    else if (m > ONE_W) over7.push(slim);
    else if (m > THREE_D) over3.push(slim);
  }
  var byMinutesDesc = function (a, b) { return b.minutes_since_last_report - a.minutes_since_last_report; };
  all.sort(byMinutesDesc); over3.sort(byMinutesDesc); over7.sort(byMinutesDesc); over14.sort(byMinutesDesc);
  return {
    scanned_at: scan.scanned_at,
    counts: {
      all_missing: all.length,
      over_3_days: over3.length,
      over_1_week: over7.length,
      over_2_weeks: over14.length,
    },
    all_missing: all,
    over_3_days: over3,
    over_1_week: over7,
    over_2_weeks: over14,
  };
}

function buildIntermittentList_() {
  var scan = readScanCache_();
  if (!scan) return { warming: true, stations: [], count: 0 };
  var stations = scan.rows.filter(function (r) { return r.status === 'INTERMITTENT'; });
  return {
    scanned_at: scan.scanned_at,
    count: stations.length,
    stations: stations,
    definition:
      'Per SUAD spec: a METAR didn\'t come in for 3+ consecutive hours, ' +
      'then the station recovered. FLAGGED-then-recovered does NOT count. ' +
      'Continuously-clean stations never enter INTERMITTENT.',
  };
}


// =====================================================================
// 13. TRIGGERS
// =====================================================================

function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('runScan').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('runHazards').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('runDigest').timeBased().everyHours(4).create();
  ScriptApp.newTrigger('rotateLogs').timeBased().atHour(3).everyDays(1).create();
  Logger.log('Installed: runScan/5min, runHazards/10min, runDigest/4h, rotateLogs/daily');
}
function removeTriggers() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) {
    ScriptApp.deleteTrigger(ts[i]);
  }
}
function rotateLogs() {
  // Trim history to 500 most-recent rows.
  var sh = getOrCreateSheet_(TAB_HISTORY, ['Timestamp UTC', 'Event', 'JSON']);
  var lastRow = sh.getLastRow();
  if (lastRow > 502) sh.deleteRows(2, lastRow - 502);
  // Trim ActiveUsers history similarly.
  var ush = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_USER_HIST);
  if (ush && ush.getLastRow() > 502) ush.deleteRows(2, ush.getLastRow() - 502);
}


// =====================================================================
// 14. ENTRY POINTS / UTILITIES
// =====================================================================

/** Custom menu when opened from a bound spreadsheet. */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('OWL Status')
      .addItem('Run Scan Now', 'runScan')
      .addItem('Refresh Hazards', 'runHazards')
      .addItem('Send Status Digest Email', 'runDigest')
      .addSeparator()
      .addItem('Install Triggers', 'installTriggers')
      .addItem('Remove Triggers', 'removeTriggers')
      .addSeparator()
      .addItem('Show Web App URL', 'showWebAppUrl')
      .addToUi();
  } catch (_) { /* not bound to a spreadsheet — that's fine */ }
}

function showWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  Logger.log('Web app URL: ' + url);
  try {
    SpreadsheetApp.getUi().alert('OWL Status — Web App URL', url, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (_) { /* no UI available */ }
  return url;
}

/** Test/debug helpers — run from the editor to verify the install. */
function testHealth() {
  Logger.log(JSON.stringify({
    stations: getStationList_().length,
    ncei_maintenance: nceiMaintActive_(),
    ua: userAgent_(),
    have_airnow_key: !!PROP('AIRNOW_API_KEY', ''),
    digest_recipients: PROP('DIGEST_RECIPIENTS', '(unset)'),
  }, null, 2));
}
function testScan() {
  var s = runScan();
  Logger.log(JSON.stringify({ counts: s.counts, total: s.total, duration_ms: s.duration_ms }, null, 2));
}
function testHazards() {
  var h = buildHazardContext_();
  Logger.log(JSON.stringify({
    cap: h.cap_alerts.total,
    sigmet: h.aviation.sigmet_count,
    gairmet: h.aviation.gairmet_count,
    cwa: h.aviation.cwa_count,
    storms: h.tropical_storms.length,
    tsunami: h.tsunami.length,
    fires: h.wildfires.length,
    sdm: !!h.admin_message,
    stale: h.stale_sources,
  }, null, 2));
}

// =====================================================================
// 12. HTML LOADER + LEGACY-BRIDGE FUNCTIONS
// =====================================================================
//
// James Glenn's original UI lives in the separate HTML files in this
// project (Index.html, JavaScript.html, Css.html, Admin.html, …). His
// templates use `<?!= include('Css') ?>` to inline CSS/JS at render
// time — same pattern Apps Script's built-in template engine uses.
// We support that here.
//
// The renderShell_ / renderIndexHtml_ / renderAdminHtml_ /
// renderAboutHtml_ functions in §12 of v1.1 are gone — replaced by
// HtmlService.createTemplateFromFile() pointed at his actual files.

/** Apps Script template `<?!= include('FileName') ?>` resolver.
 *  Reads the named HTML file from this project and returns its raw
 *  text for inclusion. Stripping the .html extension is supported
 *  for compatibility with his original templates. */
function include(filename) {
  var name = String(filename || '').trim().replace(/\.html$/i, '');
  if (!name) return '<!-- include(): blank filename -->';
  try {
    return HtmlService.createHtmlOutputFromFile(name).getContent();
  } catch (e) {
    Logger.log('include() failed for "' + name + '": ' + e.message);
    return '<!-- include() failed for "' + name + '" -->';
  }
}


// =====================================================================
//   LEGACY-BRIDGE: getPointsPayload(pass, force)
// =====================================================================
//
// James Glenn's client (`JavaScript.html`) calls this server function
// via google.script.run as the heart of the data flow. It expects:
//
//   {
//     ok: true,
//     pass: 'base' | 'overlay',
//     features: [<GeoJSON Point feature>, ...],
//     banners: [...] | null,
//     wwaWfos: { wfoSet: ['LWX','BOX',...] } | null,
//     refreshedStatus: '...',
//     expirationTimestamp: <ms>,
//     servedAtUtc: '...',
//     featureCount: N,
//     meta: { baseChunkCount, overlayChunkCount, ... }
//   }
//
// Each feature's properties include the legacy enum {
//   pid, sid, wfo, type, pgma, status, popupStatus, ... }.
//
// We translate from our SUAD-spec scan output (CLEAN/FLAGGED/MISSING/
// INTERMITTENT/...) into the legacy enum (Up/Down/Degraded/Patching).
// The user-visible UI is unchanged; only the data SOURCE changes
// (live IEM API instead of a Google Sheet column).

function getPointsPayload(pass, force) {
  pass = String(pass || 'base').trim().toLowerCase();
  force = !!force;

  // Use the live scan cache that v1.1 backend maintains. Force a
  // fresh scan only if explicitly asked (Refresh button hit).
  if (force) {
    try { runScan(); } catch (e) { Logger.log('runScan() failed in getPointsPayload: ' + e.message); }
  }
  var scan = readScanCache_();
  var rows = (scan && scan.rows) || [];
  var nowIso = new Date().toISOString();

  // Build a lookup from the (default 30-station) shortlist or
  // override list, with lat/lon from STATION_COORDS or the Catalog
  // sheet.
  var coords = STATION_COORDS;  // global from §2
  // If the Catalog sheet has lat/lon in cols B/C, prefer those.
  try {
    var cat = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Catalog');
    if (cat && cat.getLastRow() > 1) {
      var vals = cat.getRange(2, 1, cat.getLastRow() - 1, 3).getValues();
      for (var i = 0; i < vals.length; i++) {
        var id = String(vals[i][0] || '').trim().toUpperCase();
        var la = Number(vals[i][1]);
        var lo = Number(vals[i][2]);
        if (id && isFinite(la) && isFinite(lo)) coords[id] = [la, lo];
      }
    }
  } catch (_) { /* no spreadsheet bound — that's OK */ }

  var features = [];
  var pass_isOverlay = (pass === 'overlay' || pass === 'asos' || pass === 'asos_overlays');

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var c = coords[row.station] || [null, null];
    if (c[0] == null || c[1] == null) continue;
    // Translate our enum → his enum.
    var legacyStatus = ourEnumToLegacy_(row.status);
    var feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c[1], c[0]] }, // [lon, lat]
      properties: {
        pid: row.station,
        sid: row.station,
        wfo: '',
        type: 'ASOS(PD)',
        pgma: 'ASOS(PD)',
        subtype: '',
        pgmaGroup: 'NWS',
        name: row.name || row.station,
        state: row.state || '',
        city: '',
        county: '',
        kind: null,
        isOverlay: false,
        // Legacy status enum.
        status: legacyStatus,
        popupStatus: legacyStatus,
        // Outage metadata.
        outageStart: null,
        outageSource: 'OWL Apps Script (live IEM)',
        outageCause: row.probable_reason || null,
        svcbu: null,
        patching: null,
        backupTo: null,
        // ASOS-specific: last METAR + age.
        lastOb: row.last_metar || null,
        timeSinceLastOb: row.minutes_since_last_report != null
          ? fmtSilence_(row.minutes_since_last_report) : null,
        lastObEText: row.station + ' (E)',
        lastObEUrl: 'https://www.aviationweather.gov/metar/data?ids=' + encodeURIComponent(row.station) + '&format=raw',
        lastObDText: row.station + ' (D)',
        lastObDUrl: 'https://mesonet.agron.iastate.edu/p.php?network=' + encodeURIComponent(row.state || 'XX') + '_ASOS&station=' + encodeURIComponent(row.station),
        // SUAD-spec metadata (extra — his client ignores fields it doesn't know).
        owl_status: row.status,           // raw OUR enum
        owl_state_log: row.state_log || [],
        owl_flag_codes: row.flag_codes || [],
        owl_evidence: row.evidence_quality || null,
      },
    };
    // For "overlay" pass, his client expects the ACU/DCP1-4 sub-points.
    // We don't have those — return base only. His UI will gracefully
    // skip the overlay layer when the array is empty.
    if (!pass_isOverlay) features.push(feature);
  }

  return {
    ok: true,
    pass: pass_isOverlay ? 'overlay' : 'base',
    refreshedStatus: 'fresh',
    expirationTimestamp: Date.now() + 5 * 60 * 1000,    // 5 min
    servedAtUtc: nowIso,
    meta: {
      baseChunkCount: 1,
      overlayChunkCount: 0,
      built_at: nowIso,
      total: features.length,
    },
    banners: pass_isOverlay ? null : fetchBanners_(),
    wwaWfos: pass_isOverlay ? null : { wfoSet: [] },
    featureCount: features.length,
    features: features,
  };
}

/** Map our SUAD-spec status to the legacy Up/Down/Degraded enum
 *  his client renders. The legacy enum has no INTERMITTENT — we
 *  collapse INTERMITTENT to Degraded so it renders yellow, which
 *  is the closest visual signal his UI offers. */
function ourEnumToLegacy_(status) {
  switch (status) {
    case 'CLEAN':        return 'Up';
    case 'RECOVERED':    return 'Up';
    case 'FLAGGED':      return 'Degraded';
    case 'INTERMITTENT': return 'Degraded';
    case 'MISSING':      return 'Down';
    case 'OFFLINE':      return 'Down';
    case 'NO DATA':      return 'Down';
    default:             return 'Up';
  }
}


// =====================================================================
//   LEGACY-BRIDGE: GeoJSON overlay loaders
// =====================================================================
//
// His original loaded RFC/CWSU/WFO/MCC/Region polygon GeoJSON files
// from his Google Drive. Without those Drive files, we have three
// options: (1) fetch live from NWS ArcGIS REST endpoints (slow but
// always-current), (2) bundle as Drive files in this project (fast
// but requires storing the GeoJSON), (3) return empty FeatureCollection
// (overlays toggle on but render nothing).
//
// For the initial port we go with (3) — empty result. Operators who
// want the overlays can (a) drop the GeoJSON files in the project's
// Drive folder, or (b) set Script Properties pointing at NWS ArcGIS
// services and we'll fetch live in a later iteration.

function getRfcGeojsonText() {
  return loadGeoJsonOverlay_('rfc.geojson', 'RFC');
}
function getCwsuGeojsonText() {
  return loadGeoJsonOverlay_('cwsu.geojson', 'CWSU');
}
function getWfoGeojsonText() {
  return loadGeoJsonOverlay_('wfo.geojson', 'WFO');
}
function getMccGeojsonText() {
  return loadGeoJsonOverlay_('mcc.geojson', 'MCC');
}
function getRegGeojsonText() {
  return loadGeoJsonOverlay_('region.geojson', 'Region');
}

function loadGeoJsonOverlay_(filename, label) {
  // Try Drive first — his pattern.
  try {
    var files = DriveApp.getFilesByName(filename);
    if (files.hasNext()) {
      var blob = files.next().getBlob();
      return { ok: true, text: blob.getDataAsString('UTF-8') };
    }
  } catch (e) {
    Logger.log('Drive lookup for ' + filename + ' failed: ' + e.message);
  }
  // Fall back to empty FeatureCollection so overlay toggles don't
  // throw, just render nothing.
  return {
    ok: true,
    text: JSON.stringify({ type: 'FeatureCollection', features: [] }),
    note: 'No ' + label + ' GeoJSON found in Drive. Drop a file named ' + filename + ' in your Drive root to populate this overlay.',
  };
}


// =====================================================================
//   LEGACY-BRIDGE: WWA list (paginated)
// =====================================================================
//
// His original read paginated rows from a Sheet that humans curated.
// We synthesize the same shape from live NWS CAP alerts so the WWA
// list popup populates without manual sheet upkeep.

function getWwaListChunk(offset, limit) {
  offset = Math.max(0, parseInt(offset || 0, 10) || 0);
  limit  = Math.min(500, Math.max(50, parseInt(limit || 250, 10) || 250));
  var alerts = [];
  try { alerts = fetchCapAlerts_(); } catch (_) { /* graceful degrade */ }
  var header = ['Event', 'Severity', 'Urgency', 'WFO', 'Area', 'Sent', 'Expires', 'Headline'];
  var allRows = alerts.map(function (a) {
    return [
      a.event || '',
      a.severity || '',
      a.urgency || '',
      (a.sender || '').slice(0, 4).toUpperCase(),
      a.area_desc || '',
      a.sent || '',
      a.expires || '',
      a.headline || '',
    ];
  });
  var slice = allRows.slice(offset, offset + limit);
  return {
    ok: true,
    header: header,
    rows: slice,
    nextOffset: offset + slice.length,
    done: offset + slice.length >= allRows.length,
    totalRows: allRows.length,
  };
}
// Older client also calls getWwaListTablePage(offset, limit) — same shape.
function getWwaListTablePage(offset, limit) {
  var c = getWwaListChunk(offset, limit);
  return {
    ok: c.ok,
    header: c.header,
    rows: c.rows,
    rowCount: c.rows.length,
    totalRows: c.totalRows,
    offset: offset,
    limit: limit,
  };
}

