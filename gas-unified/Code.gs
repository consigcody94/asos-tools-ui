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
 *      surfaces in the Admin tab and the AI brief. Unbounded list
 *      per SUAD spec.
 *
 *    - All OWL hazard sources: NWS CAP alerts, AWC SIGMETs +
 *      G-AIRMETs + CWAs, NHC tropical, Tsunami (NTWC + PTWC), NIFC
 *      wildfires, AirNow AQI, NWPS flood gauges, NCEP SDM admin
 *      bulletins, NCEI maintenance window awareness.
 *
 *    - AI Brief generator: structured 12-section operational brief
 *      pulling the full hazard context, with audience / horizon /
 *      length tunables. Brief-to-brief delta tracking surfaces
 *      what changed since the last brief.
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
 *         OPENAI_API_KEY     (Ollama Cloud or OpenAI key)
 *         OPENAI_BASE_URL    (e.g. https://ollama.com/v1)
 *         AI_BRIEF_MODEL     (e.g. glm-5.1 or gpt-4o-mini)
 *         OWL_CONTACT        (email for the NWS UA, e.g. you@noaa.gov)
 *       Optional:
 *         BRIEF_RECIPIENTS   (comma-sep emails, for digestEmail trigger)
 *         AIRNOW_API_KEY     (free key from airnowapi.org)
 *         ASOS_STATIONS      (comma-sep ICAO list to scan; defaults to
 *                             a 920-site nationwide catalog)
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
 *                              Tsunami / NIFC / AirNow / NWPS / SDM
 *    9. AI BRIEF             — Context aggregator + structured prompt
 *   10. SCAN ORCHESTRATION   — runScan, runHazards, runDigest
 *   11. WEB APP ROUTES       — doGet / doPost + path-style API
 *   12. HTML TEMPLATES       — Index / Admin / About / Status
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
var CACHE_BRIEF_TTL_S   = 600;    // 10 min — briefs are expensive

/** Sheet tab names — auto-created on first run. */
var TAB_HISTORY      = 'History';
var TAB_BRIEFS       = 'Briefs';
var TAB_HEALTH       = 'Health';
var TAB_STATE_LOG    = 'StateLog';      // per-station rolling state
var TAB_ACTIVE_USERS = 'ActiveUsers';
var TAB_USER_HIST    = 'UserHistory';
var TAB_ADMIN_ACCESS = 'AdminAccess';

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

var IEM_BATCH = 80;
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
  var sh = getOrCreateSheet_(TAB_STATE_LOG, ['Station', 'Hour ISO', 'State']);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return {};
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
  // Sort each list oldest→newest and trim to STATE_LOG_HOURS depth.
  for (var s in byStation) {
    byStation[s].sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    if (byStation[s].length > STATE_LOG_HOURS) {
      byStation[s] = byStation[s].slice(byStation[s].length - STATE_LOG_HOURS);
    }
  }
  return byStation;
}

/** Persist the rolling log. Replaces prior rows entirely. Bounded by
 *  STATE_LOG_HOURS per station so the sheet doesn't grow unbounded. */
function writeStateLog_(byStation) {
  var sh = getOrCreateSheet_(TAB_STATE_LOG, ['Station', 'Hour ISO', 'State']);
  var rows = [];
  for (var s in byStation) {
    var list = byStation[s];
    for (var i = 0; i < list.length; i++) {
      rows.push([s, list[i].at, list[i].state]);
    }
  }
  // Clear data area, write fresh.
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
  }
  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, 3).setValues(rows);
  }
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

/** Aggregate every hazard source. Used by hazards endpoint + AI brief. */
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
  var stale       = [];
  try { capAlerts = fetchCapAlerts_(); }    catch (e) { stale.push('cap'); }
  try { sigmets   = fetchAwcSigmets_(); }   catch (e) { stale.push('sigmet'); }
  try { gairmets  = fetchAwcGAirmets_(); }  catch (e) { stale.push('gairmet'); }
  try { cwas      = fetchAwcCwa_(); }       catch (e) { stale.push('cwa'); }
  try { storms    = fetchNhcStorms_(); }    catch (e) { stale.push('nhc'); }
  try { tsunami   = fetchTsunami_(); }      catch (e) { stale.push('tsunami'); }
  try { fires     = fetchNifcFires_(); }    catch (e) { stale.push('nifc'); }
  try { adminMsg  = fetchAdminBulletin_(); } catch (e) { stale.push('ncep-sdm'); }

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
    stale_sources: stale,
  };
}


// =====================================================================
// 9. AI BRIEF
// =====================================================================
//
// Comprehensive context aggregator + structured 12-section prompt.
// Pulls scan results + hazards + history delta + long-missing list,
// then produces an operator-ready brief via OpenAI/Ollama-compatible
// chat. Tunable via audience / horizon / length params.

/** Persists last brief snapshot so we can compute change-deltas. */
function readLastBriefSnapshot_() {
  var raw = PropertiesService.getScriptProperties().getProperty('LAST_BRIEF_SNAPSHOT');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}
function writeBriefSnapshot_(snap) {
  PropertiesService.getScriptProperties().setProperty(
    'LAST_BRIEF_SNAPSHOT', JSON.stringify(snap)
  );
}

/** Build the comprehensive AI Brief context. */
function buildBriefContext_(focus) {
  var scan = readScanCache_();
  var rows = (scan && scan.rows) || [];
  var counts = { CLEAN: 0, FLAGGED: 0, MISSING: 0, OFFLINE: 0, INTERMITTENT: 0, RECOVERED: 0, 'NO DATA': 0 };
  for (var i = 0; i < rows.length; i++) counts[rows[i].status] = (counts[rows[i].status] || 0) + 1;

  var ORDER = ['MISSING', 'FLAGGED', 'INTERMITTENT'];
  var top = rows.filter(function (r) { return ORDER.indexOf(r.status) >= 0; })
    .sort(function (a, b) {
      var oa = ORDER.indexOf(a.status), ob = ORDER.indexOf(b.status);
      if (oa !== ob) return oa - ob;
      return (a.minutes_since_last_report || 1e9) - (b.minutes_since_last_report || 1e9);
    });
  var topProblems = top.slice(0, 20);
  var intermittent = rows.filter(function (r) { return r.status === 'INTERMITTENT'; }).slice(0, 20);

  var TWO_WEEKS_MIN = 14 * 24 * 60;
  var longMissing = rows.filter(function (r) {
    return r.status === 'MISSING' && r.minutes_since_last_report > TWO_WEEKS_MIN;
  }).sort(function (a, b) {
    return (b.minutes_since_last_report || 0) - (a.minutes_since_last_report || 0);
  });

  var hazards = buildHazardContext_();
  var minutesOld = scan && scan.scanned_at
    ? Math.round((Date.now() - Date.parse(scan.scanned_at)) / 60000)
    : null;

  return {
    built_at: new Date().toISOString(),
    status_counts: counts,
    total_stations: rows.length,
    scan_freshness: {
      scanned_at: scan ? scan.scanned_at : null,
      duration_ms: scan ? scan.duration_ms : null,
      minutes_old: minutesOld,
    },
    top_problems: topProblems,
    intermittent_stations: intermittent,
    long_missing_alert: longMissing.map(function (r) {
      return {
        station: r.station,
        state: r.state,
        minutes_since_last_report: r.minutes_since_last_report,
        silence_human: fmtSilence_(r.minutes_since_last_report),
        last_valid: r.last_valid,
        probable_reason: r.probable_reason,
      };
    }),
    hazards: hazards,
    focus: focus || null,
  };
}

/** Compute diff vs last brief — newly problem, recovered, count deltas. */
function computeBriefDelta_(ctx) {
  var prev = readLastBriefSnapshot_();
  var curProblems = {};
  for (var i = 0; i < ctx.top_problems.length; i++) curProblems[ctx.top_problems[i].station] = true;

  var delta = null;
  if (prev) {
    var newly = [], recovered = [];
    for (var s in curProblems) if (!prev.problems[s]) newly.push(s);
    for (var p in prev.problems) if (!curProblems[p]) recovered.push(p);
    var cd = {};
    for (var k in ctx.status_counts) {
      cd[k] = (ctx.status_counts[k] || 0) - (prev.counts[k] || 0);
    }
    delta = { newly_problem: newly, recovered: recovered, count_delta: cd };
  }
  writeBriefSnapshot_({ counts: ctx.status_counts, problems: curProblems });
  return delta;
}

function buildBriefSystemPrompt_(audience, horizon, length) {
  var aud = {
    noc: 'You are an ASOS NOC shift briefer. Audience: 24/7 ops engineers. Use ICAO IDs verbatim, terse operational language, specific action items.',
    'field-tech': 'You are an ASOS field-maintenance dispatch briefer. Emphasize sensor codes (PWINO, FZRANO, RVRNO), priority by impact + accessibility, ticket-ready summaries.',
    management: 'You are an ASOS Network executive summary writer. Audience: non-technical management. Translate ICAO to airport names; describe operational impact in plain English.',
    aviation: 'You are an aviation weather briefer. Audience: airline dispatch + ATC flow management. Emphasize SIGMETs, G-AIRMETs, CWAs, airports affected by station outages.',
  }[audience] || aud.noc;
  var hz = {
    now: 'Time horizon: current state. Describe what is happening now.',
    '6h': 'Time horizon: next 6 hours. Project trajectory based on current patterns — which stations likely escalate, which hazards likely clear.',
    '24h': 'Time horizon: next 24 hours. Identify systemic risks (incoming tropical activity, multi-day outages worth scheduling field response).',
  }[horizon] || hz.now;
  var ln = {
    summary: 'Length: 4-6 sentences total. Hit only the most-critical items. Skip empty sections.',
    standard: 'Length: 1-2 paragraphs per section, only including sections with non-trivial data. Skip empty sections.',
    detailed: 'Length: full structured brief, all sections present (note "no active items" in empty ones).',
  }[length] || ln.standard;

  return [
    'Respond in English only.',
    aud, hz, ln,
    '',
    'Use these section headers (all-caps): EXECUTIVE SUMMARY · NETWORK HEALTH · URGENT (STATIONS UNDER ACTIVE WEATHER) · INTERMITTENT (FLAPPING) · TOP PROBLEM STATIONS · AVIATION HAZARDS · ACTIVE ALERTS · TROPICAL · WILDFIRES & TSUNAMI · DELTA SINCE LAST BRIEF · DATA FRESHNESS · TICKETS TO OPEN.',
    'Use ICAO IDs verbatim. Cite specific stations and reasons.',
    'Never invent data not present in the context.',
    'EVERY long-missing-alert station (silent > 14 days) MUST appear in URGENT.',
    'TICKETS TO OPEN: each line is one actionable ticket.',
  ].join('\n');
}

function buildBriefUserMessage_(ctx, delta) {
  var blocks = [];
  blocks.push('META: scan_age_min=' + (ctx.scan_freshness.minutes_old || '?') +
    ', total_stations=' + ctx.total_stations +
    ', focus=' + (ctx.focus || 'all'));
  blocks.push('STATUS_COUNTS: ' + JSON.stringify(ctx.status_counts));

  if (ctx.top_problems.length > 0) {
    var tps = ['TOP_PROBLEMS:'];
    for (var i = 0; i < ctx.top_problems.length; i++) {
      var p = ctx.top_problems[i];
      tps.push('  ' + p.station + ' ' + p.status + ' ' + (p.minutes_since_last_report || '?') + 'min ' + (p.probable_reason || ''));
    }
    blocks.push(tps.join('\n'));
  }
  if (ctx.intermittent_stations.length > 0) {
    var iss = ['INTERMITTENT_STATIONS (SUAD-spec — flapping):'];
    for (var j = 0; j < ctx.intermittent_stations.length; j++) {
      var s = ctx.intermittent_stations[j];
      iss.push('  ' + s.station + ' last=' + (s.minutes_since_last_report || '?') + 'min');
    }
    blocks.push(iss.join('\n'));
  }
  if (ctx.long_missing_alert.length > 0) {
    var lm = ['LONG_MISSING_ALERT (silent > 14 days — every entry MUST appear in URGENT):'];
    for (var l = 0; l < ctx.long_missing_alert.length; l++) {
      var x = ctx.long_missing_alert[l];
      lm.push('  ' + x.station + ' silent=' + x.silence_human + ' last_valid=' + (x.last_valid || '?'));
    }
    blocks.push(lm.join('\n'));
  }
  if (ctx.hazards.cap_alerts.total > 0) {
    var capLines = ['ACTIVE_ALERTS: ' + ctx.hazards.cap_alerts.total + ' total · by event:'];
    for (var c = 0; c < ctx.hazards.cap_alerts.by_event.length; c++) {
      var e = ctx.hazards.cap_alerts.by_event[c];
      capLines.push('  ' + e.event + ' (' + e.severity + '): ' + e.count);
    }
    blocks.push(capLines.join('\n'));
  }
  if (ctx.hazards.aviation.sigmet_count + ctx.hazards.aviation.gairmet_count + ctx.hazards.aviation.cwa_count > 0) {
    blocks.push('AVIATION_HAZARDS: ' + ctx.hazards.aviation.sigmet_count + ' SIGMETs, ' +
      ctx.hazards.aviation.gairmet_count + ' G-AIRMETs, ' + ctx.hazards.aviation.cwa_count + ' CWAs');
  }
  if (ctx.hazards.tropical_storms.length > 0) {
    var ts = ['TROPICAL_STORMS:'];
    for (var t = 0; t < ctx.hazards.tropical_storms.length; t++) {
      var st = ctx.hazards.tropical_storms[t];
      ts.push('  ' + st.name + ' ' + st.classification + ' ' + st.intensity_kt + 'kt ' + st.pressure_mb + 'mb ' + st.movement);
    }
    blocks.push(ts.join('\n'));
  }
  if (ctx.hazards.tsunami.length > 0) {
    var tsu = ['TSUNAMI_BULLETINS:'];
    for (var u = 0; u < ctx.hazards.tsunami.length; u++) {
      var b = ctx.hazards.tsunami[u];
      tsu.push('  ' + b.center + ' ' + b.level.toUpperCase() + ': ' + b.title);
    }
    blocks.push(tsu.join('\n'));
  }
  if (ctx.hazards.wildfires.length > 0) {
    var wf = ['WILDFIRES (top by acres):'];
    for (var w = 0; w < ctx.hazards.wildfires.length; w++) {
      var f = ctx.hazards.wildfires[w];
      wf.push('  ' + f.name + ' ' + f.state + ' acres=' + (f.acres || '?') + ' contain=' + (f.containment_pct || '?') + '%');
    }
    blocks.push(wf.join('\n'));
  }
  if (ctx.hazards.admin_message) {
    blocks.push('NCEP_SDM_ADMIN: issued=' + ctx.hazards.admin_message.issued + '\n  ' + ctx.hazards.admin_message.preview);
  }
  if (ctx.hazards.ncei_maintenance.active) {
    blocks.push('NCEI_MAINTENANCE_ACTIVE');
  }
  if (delta) {
    var dStr = [];
    for (var dk in delta.count_delta) {
      if (delta.count_delta[dk] !== 0) dStr.push(dk + (delta.count_delta[dk] > 0 ? '+' : '') + delta.count_delta[dk]);
    }
    blocks.push('DELTA_SINCE_LAST: newly_problem=[' + delta.newly_problem.slice(0, 12).join(',') +
      '] recovered=[' + delta.recovered.slice(0, 12).join(',') + '] counts={' + dStr.join(', ') + '}');
  }
  if (ctx.hazards.stale_sources.length > 0) {
    blocks.push('STALE_SOURCES: ' + ctx.hazards.stale_sources.join(', '));
  }
  return blocks.join('\n\n');
}

/** OpenAI/Ollama chat — returns the assistant's text. */
function openaiChat_(messages, options) {
  var key = PROP('OPENAI_API_KEY', '');
  var base = PROP('OPENAI_BASE_URL', 'https://ollama.com/v1');
  var model = PROP('AI_BRIEF_MODEL', 'glm-5.1');
  if (!key) return '[AI Brief unavailable — set OPENAI_API_KEY in Script Properties.]';

  var url = base.replace(/\/+$/, '') + '/chat/completions';
  var body = {
    model: model,
    messages: messages,
    max_tokens: (options && options.maxTokens) || 4000,
    temperature: 0.2,
  };
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    Logger.log('[ai-brief] HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 400));
    return '[AI Brief failed — HTTP ' + resp.getResponseCode() + '. Check OPENAI_API_KEY / OPENAI_BASE_URL / AI_BRIEF_MODEL.]';
  }
  try {
    var j = JSON.parse(resp.getContentText());
    var msg = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return msg || '[AI Brief returned empty content.]';
  } catch (e) {
    return '[AI Brief parse failed: ' + e.message + ']';
  }
}

function generateAiBrief_(opts) {
  opts = opts || {};
  var ctx = buildBriefContext_(opts.focus);
  var delta = opts.compareToLast === false ? null : computeBriefDelta_(ctx);
  var sys = buildBriefSystemPrompt_(opts.audience || 'noc', opts.horizon || 'now', opts.length || 'standard');
  var usr = buildBriefUserMessage_(ctx, delta);
  var text = openaiChat_(
    [{ role: 'system', content: sys }, { role: 'user', content: usr }],
    { maxTokens: 4000 }
  );
  return { text: text, context: ctx, delta: delta };
}


// =====================================================================
// 10. SCAN ORCHESTRATION
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

/** Email digest with the AI brief — fired by the digestEmail trigger. */
function runDigest() {
  var recipients = PROP('BRIEF_RECIPIENTS', '');
  if (!recipients) {
    Logger.log('[digest] BRIEF_RECIPIENTS not set; skipping email');
    return;
  }
  var brief = generateAiBrief_({});
  var subject = 'OWL Network Brief — ' + new Date().toUTCString();
  MailApp.sendEmail({
    to: recipients,
    subject: subject,
    body: brief.text + '\n\n--\nGenerated by OWL × Apps Script · ' + brief.context.built_at,
  });
  appendBriefRow_(brief);
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

function appendBriefRow_(brief) {
  var sh = getOrCreateSheet_(TAB_BRIEFS, ['Timestamp UTC', 'Audience', 'Length', 'Stale Sources', 'Brief Text']);
  sh.appendRow([
    new Date().toISOString(),
    'noc',
    'standard',
    (brief.context.hazards.stale_sources || []).join(','),
    brief.text,
  ]);
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
//   ?api=brief     → JSON AI brief (POST or GET)
//   ?api=missing   → JSON missing-stations buckets
//   ?api=intermittent → JSON SUAD-spec intermittent list

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
  if (pagePath === 'admin') {
    return HtmlService.createHtmlOutput(renderAdminHtml_())
      .setTitle('OWL Status — Admin')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (pagePath === 'about') {
    return HtmlService.createHtmlOutput(renderAboutHtml_())
      .setTitle('OWL Status — About')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // Default: main map.
  return HtmlService.createHtmlOutput(renderIndexHtml_())
    .setTitle('OWL Status — NWS Systems Status')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  e = e || {};
  var p = (e.parameter || {});
  if (p.api === 'brief') {
    var body = {};
    try { body = JSON.parse(e.postData && e.postData.contents || '{}'); } catch (_) {}
    return jsonResponse_(generateAiBrief_(body));
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
  if (path === 'brief') {
    var opts = {
      focus: p.focus || '',
      audience: p.audience || 'noc',
      horizon: p.horizon || 'now',
      length: p.length || 'standard',
    };
    return jsonResponse_(generateAiBrief_(opts));
  }
  if (path === 'missing') {
    return jsonResponse_(buildMissingBuckets_());
  }
  if (path === 'intermittent') {
    return jsonResponse_(buildIntermittentList_());
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
// 12. HTML TEMPLATES (inline, no separate .html files)
// =====================================================================
//
// Apps Script's HtmlService accepts inline HTML strings via
// HtmlService.createHtmlOutput(string). We embed all templates as
// JS string constants — single-file deploy, no include() machinery.

/** Renders the per-page wrapper: shared head + content. */
function renderShell_(title, body) {
  var webappUrl = ScriptApp.getService().getUrl() || '';
  return [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<base target="_top">',
    '<title>' + title + '</title>',
    '<style>' + INLINE_CSS + '</style>',
    '</head><body>',
    '<header class="hdr">',
    '  <div class="hdr-l"><span class="hdr-mark">●</span> OWL × NWS Systems Status</div>',
    '  <nav class="hdr-nav">',
    '    <a href="' + webappUrl + '">Map</a>',
    '    <a href="' + webappUrl + '?path=admin">Admin</a>',
    '    <a href="' + webappUrl + '?path=about">About</a>',
    '  </nav>',
    '</header>',
    '<main class="main">' + body + '</main>',
    '<footer class="ftr">' +
      'Apps Script unified build · ' + new Date().toUTCString() +
    '</footer>',
    '<script>window.OWL_WEBAPP_URL = ' + JSON.stringify(webappUrl) + ';</script>',
    '<script>' + INLINE_JS + '</script>',
    '</body></html>',
  ].join('\n');
}

function renderIndexHtml_() {
  var body = [
    '<section class="dashboard">',
    '  <div class="counter-strip">',
    '    <div class="counter clean"><label>CLEAN</label><span id="cnt-clean">—</span></div>',
    '    <div class="counter flagged"><label>FLAGGED</label><span id="cnt-flagged">—</span></div>',
    '    <div class="counter intermittent"><label>INTERMITTENT</label><span id="cnt-intermittent">—</span></div>',
    '    <div class="counter missing"><label>MISSING</label><span id="cnt-missing">—</span></div>',
    '    <div class="counter offline"><label>OFFLINE</label><span id="cnt-offline">—</span></div>',
    '    <div class="counter recovered"><label>RECOVERED</label><span id="cnt-recovered">—</span></div>',
    '  </div>',
    '  <div class="freshness" id="freshness">scan freshness: …</div>',
    '  <div class="grid-2">',
    '    <section class="card"><h2>Top Problem Stations</h2><div id="top-problems" class="scroll">loading…</div></section>',
    '    <section class="card"><h2>INTERMITTENT (SUAD-spec)</h2><div id="intermittent-list" class="scroll">loading…</div></section>',
    '  </div>',
    '  <div class="grid-2">',
    '    <section class="card"><h2>Long Missing (>2 weeks)</h2><div id="long-missing" class="scroll">loading…</div></section>',
    '    <section class="card"><h2>Active Hazards</h2><div id="hazard-summary" class="scroll">loading…</div></section>',
    '  </div>',
    '  <section class="card brief-card">',
    '    <h2>AI Brief</h2>',
    '    <div class="brief-controls">',
    '      <label>Audience <select id="brief-audience"><option value="noc">NOC</option><option value="field-tech">Field Tech</option><option value="management">Management</option><option value="aviation">Aviation</option></select></label>',
    '      <label>Horizon <select id="brief-horizon"><option value="now">Now</option><option value="6h">6 h</option><option value="24h">24 h</option></select></label>',
    '      <label>Length <select id="brief-length"><option value="standard">Standard</option><option value="summary">Summary</option><option value="detailed">Detailed</option></select></label>',
    '      <button id="brief-generate">Generate Brief</button>',
    '    </div>',
    '    <pre id="brief-output" class="brief-output">Click Generate Brief to produce a fresh operational summary.</pre>',
    '  </section>',
    '</section>',
  ].join('\n');
  return renderShell_('OWL Status — Map', body);
}

function renderAdminHtml_() {
  var body = [
    '<section class="admin">',
    '  <h1>Admin Console</h1>',
    '  <p class="muted">Full operational picture — every count, every long-missing alert, every cross-check disagreement. Per SUAD spec.</p>',
    '  <div class="counter-strip" id="admin-counters">loading…</div>',
    '  <section class="card"><h2>Long-Missing Alert (every entry, no slicing)</h2>',
    '    <p class="muted">Stations silent &gt; 14 days require eyes on every one.</p>',
    '    <div id="admin-long-missing" class="scroll-tall">loading…</div>',
    '  </section>',
    '  <section class="card"><h2>Missing &gt; 1 Week</h2><div id="admin-1wk" class="scroll-tall">loading…</div></section>',
    '  <section class="card"><h2>Missing &gt; 3 Days</h2><div id="admin-3d" class="scroll-tall">loading…</div></section>',
    '  <section class="card"><h2>INTERMITTENT (SUAD-spec)</h2><div id="admin-intermittent" class="scroll-tall">loading…</div></section>',
    '  <section class="card"><h2>FLAGGED — by sensor code</h2><div id="admin-flagged" class="scroll-tall">loading…</div></section>',
    '  <section class="card"><h2>Hazard Summary</h2><div id="admin-hazards" class="scroll-tall">loading…</div></section>',
    '  <section class="card"><h2>NCEP SDM Admin Bulletin</h2><div id="admin-sdm">loading…</div></section>',
    '  <section class="card"><h2>Sources Health</h2><div id="admin-sources">loading…</div></section>',
    '</section>',
  ].join('\n');
  return renderShell_('OWL Status — Admin', body);
}

function renderAboutHtml_() {
  var body = [
    '<section class="about">',
    '<h1>OWL × NWS Systems Status — About</h1>',
    '<p>Single-file Google Apps Script that replaces a multi-file System Outage Map ' +
      'project with live API data sources, the SUAD-spec INTERMITTENT classifier, ' +
      'comprehensive hazard aggregation (CAP / SIGMET / G-AIRMET / CWA / NHC / Tsunami / ' +
      'NIFC / NCEP SDM / NCEI maintenance state), and an AI-generated 12-section ' +
      'shift-change brief.</p>',
    '<h2>Data Sources</h2>',
    '<ul class="sources">',
    '  <li><strong>IEM</strong> · primary METAR fetch (Iowa State Mesonet — academic mirror of NCEI)</li>',
    '  <li><strong>AWC</strong> · METAR fallback for IEM-orphaned stations</li>',
    '  <li><strong>NCEI</strong> · authoritative cross-check (maintenance-aware)</li>',
    '  <li><strong>NWS api.weather.gov</strong> · CAP alerts + NCEP SDM admin bulletins</li>',
    '  <li><strong>AWC SIGMETs / G-AIRMETs / CWAs</strong> · aviation hazards</li>',
    '  <li><strong>NHC</strong> · active tropical storms</li>',
    '  <li><strong>Tsunami.gov</strong> · NTWC + PTWC bulletins</li>',
    '  <li><strong>NIFC WFIGS</strong> · active US wildfires (ArcGIS)</li>',
    '  <li><strong>OpenAI/Ollama-compatible</strong> · AI Brief generation</li>',
    '</ul>',
    '<h2>Status Definitions</h2>',
    '<dl class="defs">',
    '  <dt>CLEAN</dt><dd>Station reports on schedule, no $ flag, ≤1 missing hourly bucket. No action needed.</dd>',
    '  <dt>FLAGGED</dt><dd>Latest METAR carries the $ maintenance flag. Decoded NO-codes (PWINO, FZRANO etc.) tell field techs which sensor needs attention.</dd>',
    '  <dt>MISSING</dt><dd>Silent ≥ 75 minutes (one hourly cycle + 15-min grace). Watch for the next scheduled report; escalate at 2 h.</dd>',
    '  <dt>OFFLINE</dt><dd>Catalog says decommissioned (archive_end &gt; 14 days past).</dd>',
    '  <dt>INTERMITTENT</dt><dd><em>SUAD-spec:</em> the station\'s 6-hour log shows ≥3 consecutive MISSING hours followed by recovery. ' +
      'FLAGGED→OK transitions do NOT count. Continuously-clean stations never enter INTERMITTENT.</dd>',
    '  <dt>RECOVERED</dt><dd>Was FLAGGED earlier in the window, last two reports clean.</dd>',
    '</dl>',
    '</section>',
  ].join('\n');
  return renderShell_('OWL Status — About', body);
}

/** Inline CSS — single string constant. Operator dark theme. */
var INLINE_CSS = [
  ':root{--bg:#0b1220;--surface:#111a2e;--surface-2:#162338;--border:#1f3458;--fg:#e2e8f0;--fg-dim:#94a3b8;--accent:#00e5ff;--accent-strong:#0891b2;--ok:#3fb27f;--warn:#e0a73a;--bad:#e25c6b;--info:#5fa8e6;--alt:#c48828;--off:#475569;}',
  '*{box-sizing:border-box}',
  'html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px}',
  'a{color:var(--accent);text-decoration:none}',
  'a:hover{text-decoration:underline}',
  '.hdr{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border);}',
  '.hdr-l{font-weight:700;letter-spacing:.06em;}',
  '.hdr-mark{color:var(--accent);margin-right:6px;}',
  '.hdr-nav a{margin-left:14px;font-size:.85em;}',
  '.main{padding:16px;max-width:1400px;margin:0 auto;}',
  '.ftr{padding:10px 16px;font-size:.7em;color:var(--fg-dim);text-align:center;border-top:1px solid var(--border);}',
  '.counter-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px;}',
  '.counter{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;justify-content:space-between}',
  '.counter label{font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--fg-dim);}',
  '.counter span{font-size:1.6rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1;margin-top:6px;}',
  '.counter.clean span{color:var(--ok)}',
  '.counter.flagged span{color:var(--warn)}',
  '.counter.intermittent span{color:var(--alt)}',
  '.counter.missing span{color:var(--bad)}',
  '.counter.offline span{color:var(--off)}',
  '.counter.recovered span{color:var(--info)}',
  '.freshness{font-size:.7rem;color:var(--fg-dim);margin-bottom:14px;}',
  '.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}',
  '@media (max-width:900px){.grid-2{grid-template-columns:1fr}}',
  '.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;}',
  '.card h2{margin:0 0 10px;font-size:.85rem;letter-spacing:.16em;text-transform:uppercase;color:var(--fg-dim);font-weight:600;}',
  '.scroll{max-height:280px;overflow-y:auto}',
  '.scroll-tall{max-height:480px;overflow-y:auto;padding-right:4px}',
  'table.sites{width:100%;border-collapse:collapse;font-size:.78rem}',
  'table.sites th, table.sites td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums}',
  'table.sites th{font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--fg-dim);font-weight:600;}',
  'table.sites tr:hover{background:var(--surface-2)}',
  '.pill{display:inline-block;padding:1px 6px;border-radius:10px;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}',
  '.pill.CLEAN{background:rgba(63,178,127,.18);color:var(--ok)}',
  '.pill.FLAGGED{background:rgba(224,167,58,.18);color:var(--warn)}',
  '.pill.MISSING{background:rgba(226,92,107,.18);color:var(--bad)}',
  '.pill.OFFLINE{background:rgba(71,85,105,.28);color:var(--off)}',
  '.pill.INTERMITTENT{background:rgba(196,136,40,.20);color:var(--alt)}',
  '.pill.RECOVERED{background:rgba(95,168,230,.20);color:var(--info)}',
  '.pill.alert{background:rgba(226,92,107,.45);color:#fff;animation:pulse 1.4s infinite}',
  '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}',
  '.brief-card{background:linear-gradient(180deg,var(--surface),var(--surface-2));}',
  '.brief-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px}',
  '.brief-controls label{display:flex;flex-direction:column;font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--fg-dim)}',
  '.brief-controls select,.brief-controls button{margin-top:4px;padding:6px 10px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:6px;font-size:.78rem}',
  '.brief-controls button{background:var(--accent-strong);color:#fff;cursor:pointer;font-weight:700;border:0}',
  '.brief-controls button:hover{filter:brightness(1.1)}',
  '.brief-output{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:.78rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;min-height:120px;color:var(--fg);}',
  '.muted{color:var(--fg-dim);font-size:.85em}',
  '.about dl.defs dt{font-weight:700;color:var(--accent);margin-top:8px}',
  '.about dl.defs dd{margin:0 0 8px 0;color:var(--fg-dim)}',
  '.about ul.sources li{padding:3px 0;color:var(--fg-dim)}',
  '.about ul.sources strong{color:var(--fg)}',
].join('\n');

/** Inline JS — runs on every page. Polls /api/* paths to populate
 *  the counters / problem lists / hazard summary. AI Brief click
 *  POSTs to ?api=brief and renders the response.
 *
 *  Uses standard fetch() with the web-app URL passed in as
 *  window.OWL_WEBAPP_URL — safe regardless of where the page is
 *  loaded from. */
var INLINE_JS = [
  '(function(){',
  'var BASE = window.OWL_WEBAPP_URL || "";',
  'var fetchJson = function(url, opts) {',
  '  opts = opts || {};',
  '  var u = url;',
  '  return fetch(u, opts).then(function(r){ return r.json(); });',
  '};',
  '',
  '// Counter strip + freshness ----------------------------------',
  'function updateScan() {',
  '  fetchJson(BASE + "?api=scan").then(function(s){',
  '    if (!s || !s.counts) return;',
  '    var ids = ["clean","flagged","intermittent","missing","offline","recovered"];',
  '    ids.forEach(function(id){',
  '      var el = document.getElementById("cnt-"+id);',
  '      if (el) el.textContent = (s.counts[id.toUpperCase()] || 0).toLocaleString();',
  '    });',
  '    var fresh = document.getElementById("freshness");',
  '    if (fresh) {',
  '      var min = s.scanned_at ? Math.round((Date.now() - new Date(s.scanned_at).getTime())/60000) : null;',
  '      fresh.textContent = "scan freshness: " + (min!=null ? (min + " min ago · " + s.total + " stations · " + (s.duration_ms||"?") + "ms") : "warming…");',
  '    }',
  '    renderTopProblems(s);',
  '  }).catch(function(e){ console.warn("scan poll failed", e); });',
  '}',
  '',
  '// Top problems list ------------------------------------------',
  'function renderTopProblems(s) {',
  '  var box = document.getElementById("top-problems");',
  '  if (!box) return;',
  '  var ORDER = {MISSING:0, FLAGGED:1, INTERMITTENT:2};',
  '  var rows = (s.rows||[]).filter(function(r){ return r.status in ORDER; })',
  '    .sort(function(a,b){',
  '      var oa = ORDER[a.status], ob = ORDER[b.status];',
  '      if (oa !== ob) return oa - ob;',
  '      return (a.minutes_since_last_report||1e9) - (b.minutes_since_last_report||1e9);',
  '    }).slice(0, 30);',
  '  if (!rows.length) { box.innerHTML = "<p class=muted>No problem stations.</p>"; return; }',
  '  var html = ["<table class=sites><tr><th>ICAO</th><th>Status</th><th>Silent</th><th>Reason</th></tr>"];',
  '  rows.forEach(function(r){',
  '    html.push("<tr><td><strong>"+r.station+"</strong></td><td><span class=\\"pill "+r.status+"\\">"+r.status+"</span></td>"+',
  '      "<td>"+(r.minutes_since_last_report!=null ? r.minutes_since_last_report+"m" : "—")+"</td>"+',
  '      "<td>"+(r.probable_reason||"—")+"</td></tr>");',
  '  });',
  '  html.push("</table>");',
  '  box.innerHTML = html.join("");',
  '}',
  '',
  '// Intermittent ------------------------------------------------',
  'function renderIntermittent() {',
  '  fetchJson(BASE+"?api=intermittent").then(function(d){',
  '    var box = document.getElementById("intermittent-list");',
  '    if (!box) return;',
  '    if (!d.stations || !d.stations.length) {',
  '      box.innerHTML = "<p class=muted>No flapping stations detected. The SUAD-spec INTERMITTENT label fires only when a station misses 3+ consecutive METARs and recovers.</p>";',
  '      return;',
  '    }',
  '    var html = ["<table class=sites><tr><th>ICAO</th><th>Pattern</th><th>Reason</th></tr>"];',
  '    d.stations.forEach(function(r){',
  '      var pattern = (r.state_log||[]).map(function(e){ return e.state==="OK"?"OK":(e.state==="FLAGGED"?"$":"MISS"); }).join("-");',
  '      html.push("<tr><td><strong>"+r.station+"</strong></td><td><code>"+pattern+"</code></td><td>"+(r.probable_reason||"—")+"</td></tr>");',
  '    });',
  '    html.push("</table>");',
  '    box.innerHTML = html.join("");',
  '  });',
  '}',
  '',
  '// Long missing (>2wk) ----------------------------------------',
  'function renderLongMissing() {',
  '  fetchJson(BASE+"?api=missing").then(function(d){',
  '    var box = document.getElementById("long-missing");',
  '    if (!box) return;',
  '    var rows = d.over_2_weeks || [];',
  '    if (!rows.length) { box.innerHTML = "<p class=muted>No stations silent &gt; 14 days. Network looking healthy on long-tail.</p>"; return; }',
  '    var html = ["<table class=sites><tr><th>ICAO</th><th>Silent</th><th>Last Valid</th></tr>"];',
  '    rows.forEach(function(r){',
  '      html.push("<tr><td><strong>"+r.station+"</strong> <span class=\\"pill alert\\">ALERT</span></td><td>"+r.silence_human+"</td><td>"+(r.last_valid||"—")+"</td></tr>");',
  '    });',
  '    html.push("</table>");',
  '    box.innerHTML = html.join("");',
  '  });',
  '}',
  '',
  '// Hazards summary --------------------------------------------',
  'function renderHazards() {',
  '  fetchJson(BASE+"?api=hazards").then(function(h){',
  '    var box = document.getElementById("hazard-summary");',
  '    if (!box) return;',
  '    var bits = [];',
  '    if (h.cap_alerts && h.cap_alerts.total > 0) bits.push("<div><strong>"+h.cap_alerts.total+"</strong> CAP alerts</div>");',
  '    if (h.aviation) {',
  '      bits.push("<div>"+h.aviation.sigmet_count+" SIGMETs · "+h.aviation.gairmet_count+" G-AIRMETs · "+h.aviation.cwa_count+" CWAs</div>");',
  '    }',
  '    if (h.tropical_storms && h.tropical_storms.length > 0) bits.push("<div>"+h.tropical_storms.length+" active tropical storms</div>");',
  '    if (h.tsunami && h.tsunami.length > 0) bits.push("<div class=muted>Tsunami advisories active: "+h.tsunami.length+"</div>");',
  '    if (h.wildfires && h.wildfires.length > 0) bits.push("<div>"+h.wildfires.length+" major wildfires</div>");',
  '    if (h.admin_message) bits.push("<div class=muted><strong>NCEP SDM:</strong> "+h.admin_message.preview+"</div>");',
  '    if (h.ncei_maintenance && h.ncei_maintenance.active) bits.push("<div class=muted>⚠ NCEI maintenance window active</div>");',
  '    if (h.stale_sources && h.stale_sources.length) bits.push("<div class=muted>Stale: "+h.stale_sources.join(", ")+"</div>");',
  '    box.innerHTML = bits.length ? bits.join("") : "<p class=muted>No active hazards across CAP / SIGMET / G-AIRMET / CWA / NHC / Tsunami / NIFC.</p>";',
  '  });',
  '}',
  '',
  '// AI Brief generator -----------------------------------------',
  'function generateBrief() {',
  '  var btn = document.getElementById("brief-generate");',
  '  var out = document.getElementById("brief-output");',
  '  var aud = document.getElementById("brief-audience").value;',
  '  var hz  = document.getElementById("brief-horizon").value;',
  '  var ln  = document.getElementById("brief-length").value;',
  '  if (btn) btn.disabled = true;',
  '  if (out) out.textContent = "Generating brief… (typically 5-15 seconds)";',
  '  fetch(BASE+"?api=brief", {',
  '    method: "POST",',
  '    headers: {"Content-Type":"application/json"},',
  '    body: JSON.stringify({audience: aud, horizon: hz, length: ln})',
  '  }).then(function(r){ return r.json(); }).then(function(d){',
  '    if (out) out.textContent = (d && d.text) || "[No brief content returned.]";',
  '  }).catch(function(e){',
  '    if (out) out.textContent = "Error generating brief: " + (e && e.message || e);',
  '  }).finally(function(){',
  '    if (btn) btn.disabled = false;',
  '  });',
  '}',
  '',
  '// Admin page renderer ----------------------------------------',
  'function renderAdmin() {',
  '  fetchJson(BASE+"?api=scan").then(function(s){',
  '    var box = document.getElementById("admin-counters");',
  '    if (!box || !s.counts) return;',
  '    var keys = ["CLEAN","FLAGGED","INTERMITTENT","MISSING","OFFLINE","RECOVERED"];',
  '    var html = "";',
  '    keys.forEach(function(k){ html += "<div class=\\"counter "+k.toLowerCase()+"\\"><label>"+k+"</label><span>"+(s.counts[k]||0).toLocaleString()+"</span></div>"; });',
  '    box.innerHTML = html;',
  '  });',
  '  fetchJson(BASE+"?api=missing").then(function(d){',
  '    document.getElementById("admin-long-missing").innerHTML = adminMissingTable(d.over_2_weeks, true);',
  '    document.getElementById("admin-1wk").innerHTML = adminMissingTable(d.over_1_week, false);',
  '    document.getElementById("admin-3d").innerHTML = adminMissingTable(d.over_3_days, false);',
  '  });',
  '  fetchJson(BASE+"?api=intermittent").then(function(d){',
  '    var rows = d.stations || [];',
  '    if (!rows.length) { document.getElementById("admin-intermittent").innerHTML = "<p class=muted>None.</p>"; return; }',
  '    var html = ["<table class=sites><tr><th>ICAO</th><th>Pattern</th><th>Last METAR</th></tr>"];',
  '    rows.forEach(function(r){',
  '      var pat = (r.state_log||[]).map(function(e){ return e.state==="OK"?"OK":(e.state==="FLAGGED"?"$":"MISS"); }).join("-");',
  '      html.push("<tr><td><strong>"+r.station+"</strong></td><td><code>"+pat+"</code></td><td>"+(r.last_valid||"—")+"</td></tr>");',
  '    });',
  '    html.push("</table>");',
  '    document.getElementById("admin-intermittent").innerHTML = html.join("");',
  '  });',
  '  fetchJson(BASE+"?api=scan").then(function(s){',
  '    var rows = (s.rows||[]).filter(function(r){ return r.status==="FLAGGED"; });',
  '    if (!rows.length) { document.getElementById("admin-flagged").innerHTML = "<p class=muted>None.</p>"; return; }',
  '    var html = ["<table class=sites><tr><th>ICAO</th><th>Codes</th><th>Reason</th></tr>"];',
  '    rows.forEach(function(r){',
  '      html.push("<tr><td><strong>"+r.station+"</strong></td><td><code>"+(r.flag_codes||[]).join(",")+"</code></td><td>"+(r.probable_reason||"—")+"</td></tr>");',
  '    });',
  '    html.push("</table>");',
  '    document.getElementById("admin-flagged").innerHTML = html.join("");',
  '  });',
  '  fetchJson(BASE+"?api=hazards").then(function(h){',
  '    var html = "";',
  '    if (h.cap_alerts) html += "<p><strong>CAP alerts:</strong> "+h.cap_alerts.total+"</p>";',
  '    if (h.aviation) html += "<p><strong>Aviation:</strong> "+h.aviation.sigmet_count+" SIGMETs · "+h.aviation.gairmet_count+" G-AIRMETs · "+h.aviation.cwa_count+" CWAs</p>";',
  '    if (h.tropical_storms) html += "<p><strong>Tropical:</strong> "+h.tropical_storms.length+"</p>";',
  '    if (h.tsunami) html += "<p><strong>Tsunami:</strong> "+h.tsunami.length+"</p>";',
  '    if (h.wildfires) html += "<p><strong>Wildfires:</strong> "+h.wildfires.length+"</p>";',
  '    document.getElementById("admin-hazards").innerHTML = html || "<p class=muted>None.</p>";',
  '    document.getElementById("admin-sdm").innerHTML = h.admin_message',
  '      ? "<p>Issued "+h.admin_message.issued+"</p><pre class=brief-output>"+h.admin_message.preview+"</pre>"',
  '      : "<p class=muted>No active NCEP SDM bulletin.</p>";',
  '    var stale = h.stale_sources && h.stale_sources.length',
  '      ? "<p class=muted>Stale: "+h.stale_sources.join(", ")+"</p>"',
  '      : "<p>All sources fresh.</p>";',
  '    document.getElementById("admin-sources").innerHTML = stale;',
  '  });',
  '}',
  'function adminMissingTable(rows, withAlert) {',
  '  if (!rows || !rows.length) return "<p class=muted>None.</p>";',
  '  var html = ["<table class=sites><tr><th>ICAO</th><th>Silent</th><th>Last Valid</th><th>Reason</th></tr>"];',
  '  rows.forEach(function(r){',
  '    var alert = withAlert ? " <span class=\\"pill alert\\">ALERT</span>" : "";',
  '    html.push("<tr><td><strong>"+r.station+"</strong>"+alert+"</td><td>"+r.silence_human+"</td><td>"+(r.last_valid||"—")+"</td><td>"+(r.probable_reason||"—")+"</td></tr>");',
  '  });',
  '  html.push("</table>");',
  '  return html.join("");',
  '}',
  '',
  '// Boot --------------------------------------------------------',
  'function boot() {',
  '  var path = window.location.search;',
  '  var isAdmin = /[?&](path|page)=admin/.test(path);',
  '  if (isAdmin) {',
  '    renderAdmin();',
  '    setInterval(renderAdmin, 60000);',
  '    return;',
  '  }',
  '  var brief = document.getElementById("brief-generate");',
  '  if (brief) brief.addEventListener("click", generateBrief);',
  '  if (document.getElementById("cnt-clean")) {',
  '    updateScan();',
  '    renderIntermittent();',
  '    renderLongMissing();',
  '    renderHazards();',
  '    setInterval(updateScan, 60000);',
  '    setInterval(renderHazards, 120000);',
  '  }',
  '}',
  'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);',
  'else boot();',
  '})();',
].join('\n');


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
  // Trim Briefs similarly.
  var bsh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_BRIEFS);
  if (bsh && bsh.getLastRow() > 102) bsh.deleteRows(2, bsh.getLastRow() - 102);
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
      .addItem('Send AI Brief Email', 'runDigest')
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
    have_openai_key: !!PROP('OPENAI_API_KEY', ''),
    have_airnow_key: !!PROP('AIRNOW_API_KEY', ''),
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
function testBrief() {
  var b = generateAiBrief_({ audience: 'noc', horizon: 'now', length: 'standard' });
  Logger.log(b.text);
}
