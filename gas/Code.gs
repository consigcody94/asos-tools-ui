/**
 * OWL — Google Apps Script back-end (single-file deploy).
 *
 *  ====================================================================
 *  WHAT THIS IS
 *  ====================================================================
 *  A complete redundant copy of the OWL operations brain that runs on
 *  Google's infrastructure. If the Proxmox LXC, Cloudflare tunnel, or
 *  the upstream Next.js app go dark, this script keeps watching the
 *  ASOS network, the NDBC buoys, the AWC hazards and the NHC storms,
 *  writes everything into a Google Sheet, and emails an AI-generated
 *  shift-change brief on a schedule.
 *
 *  Bonus: doGet() exposes a JSON API that mirrors /api/health from the
 *  Next app, so any external monitor (Datadog, Grafana, a status page)
 *  can poll EITHER endpoint with no client-side branching.
 *
 *  ====================================================================
 *  ZERO-DEPENDENCY DESIGN
 *  ====================================================================
 *  Everything fits in one file. No libraries, no add-ons, no GCP
 *  project, no service accounts. Just a Sheet + this script + Script
 *  Properties. That's the whole point: the Proxmox stack has 8 moving
 *  pieces (Caddy, Authelia, Postgres, Redis, Cloudflare, systemd,
 *  Next.js, the puller) and any of them can fail. Apps Script has 1.
 *
 *  ====================================================================
 *  SETUP (5 minutes — see gas/README.md for the click-by-click)
 *  ====================================================================
 *    1. Create a new Google Sheet titled "OWL Network Status".
 *    2. Extensions → Apps Script. Replace Code.gs with this file.
 *    3. Project Settings → Script Properties — add:
 *         OPENAI_API_KEY        (Ollama Cloud or OpenAI key)
 *         OPENAI_BASE_URL       (e.g. https://ollama.com/v1)
 *         AI_BRIEF_MODEL        (e.g. glm-5.1 or gpt-4o-mini)
 *         BRIEF_RECIPIENTS      comma-separated emails
 *    4. Run installTriggers() once — authorises and schedules everything.
 *    5. Deploy → New deployment → Web app, "Execute as me", "Anyone with
 *       link". Copy the /exec URL — that's your fallback API.
 *
 *  ====================================================================
 *  TRIGGERS THIS FILE INSTALLS
 *  ====================================================================
 *    runScan      every 5  min  — IEM ASOS network scan
 *    runBuoys     every 15 min  — NDBC latest_obs
 *    runHazards   every 10 min  — AWC SIGMETs, NHC storms, SWPC alerts
 *    runDigest    every 4  hr   — emails the AI brief
 *    rotateLogs   daily         — keeps the History sheet under 10k rows
 *
 *  ====================================================================
 *  GOTCHAS APPS SCRIPT FORCES YOU TO HANDLE
 *  ====================================================================
 *    - 6-minute hard execution cap per run. We chunk IEM scans.
 *    - UrlFetchApp has its own retry semantics; we use muteHttpExceptions
 *      and inspect status codes manually to match the Next app's policy.
 *    - Sheet writes are slow. We batch them with setValues() instead of
 *      one cell at a time.
 *    - PropertiesService values are always strings. Always cast.
 *    - Triggers are per-user-per-script; installTriggers() removes
 *      duplicates first to keep idempotent.
 */

// ===================================================================
// 0. CONFIG (loaded from Script Properties at runtime)
// ===================================================================

/** Lazy property accessor with a sane default and a string cast. */
function PROP(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v == null || v === "") ? (fallback == null ? "" : fallback) : String(v);
}

/** Numeric prop. */
function PROPN(key, fallback) {
  var n = Number(PROP(key, ""));
  return isFinite(n) ? n : fallback;
}

/** A single User-Agent string for everything we fetch from NWS — they
 *  reject blank UAs. Includes a contact path so NOAA admins can find us
 *  if we ever rate-limit-misbehave. */
var UA = PROP("USER_AGENT", "OWL-NetworkStatus-AppsScript (cto@sentinelowl.org)");

/** Sheet names. Created on first run if missing. */
var SHEET_SCAN     = "Scan";       // current network scan rows (one per station)
var SHEET_BUOYS    = "Buoys";      // current NDBC buoy status
var SHEET_HAZARDS  = "Hazards";    // active SIGMETs / NHC storms / SWPC alerts
var SHEET_HEALTH   = "Health";     // single-row KV snapshot for /exec lookups
var SHEET_HISTORY  = "History";    // append-only audit log of all runs
var SHEET_BRIEF    = "Briefs";     // the last N AI briefs we generated

/** ASOS station catalogue. Hard-coded shortlist of the 30 most-visible
 *  stations to keep the 5-min scan well under the 6-min execution cap.
 *  For the full 920-station scan, configure ASOS_STATIONS in Script
 *  Properties as a comma-separated list — chunking happens automatically.
 *
 *  Why a default shortlist? A first-time deploy should produce data on
 *  trigger #1 without any config. The script is useful immediately;
 *  expanding to the full network is a config change, not a code change.
 */
var DEFAULT_STATIONS = [
  "KATL","KORD","KDFW","KDEN","KLAX","KJFK","KSFO","KSEA","KMIA","KBOS",
  "KPHX","KIAH","KMSP","KDTW","KCLT","KMCO","KEWR","KLGA","KPHL","KBWI",
  "KIAD","KDCA","KPDX","KSAN","KSLC","KSTL","KMCI","KMDW","KFLL","KTPA"
];

// ===================================================================
// 1. PUBLIC ENTRY POINTS
// ===================================================================

/** Sheet → custom menu so the operator can manually fire any job. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("OWL")
    .addItem("Run scan now",     "runScan")
    .addItem("Refresh buoys",    "runBuoys")
    .addItem("Refresh hazards",  "runHazards")
    .addItem("Send AI brief now","runDigest")
    .addSeparator()
    .addItem("Install triggers", "installTriggers")
    .addItem("Remove triggers",  "removeTriggers")
    .addItem("Open web-app URL", "showWebAppUrl")
    .addToUi();
}

/** Apps Script web-app endpoint. Path-style routing through ?path=...
 *  so a single deployment serves multiple JSON resources. */
function doGet(e) {
  var path = (e && e.parameter && e.parameter.path) || "health";
  var body;
  switch (path) {
    case "health":   body = readHealth();      break;
    case "scan":     body = readSheet(SHEET_SCAN);    break;
    case "buoys":    body = readSheet(SHEET_BUOYS);   break;
    case "hazards":  body = readSheet(SHEET_HAZARDS); break;
    case "brief":    body = readLatestBrief();        break;
    default:         body = { error: "unknown path: " + path };
  }
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/** doPost mirrors doGet but accepts a JSON body — useful for triggering
 *  runs from external systems. Optional: protect with a shared secret
 *  passed via Script Property POST_TOKEN. */
function doPost(e) {
  var token = PROP("POST_TOKEN", "");
  if (token) {
    var sent = (e && e.parameter && e.parameter.token) || "";
    if (sent !== token) {
      return ContentService.createTextOutput(
        JSON.stringify({ error: "unauthorized" })
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }
  var path = (e && e.parameter && e.parameter.path) || "";
  var result;
  switch (path) {
    case "scan":    result = runScan();    break;
    case "buoys":   result = runBuoys();   break;
    case "hazards": result = runHazards(); break;
    case "digest":  result = runDigest();  break;
    default:        result = { error: "unknown path: " + path };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===================================================================
// 2. ASOS NETWORK SCAN — IEM ONE-MIN
// ===================================================================

/**
 * Fetch the latest METAR + AFOS report for each configured ASOS station
 * via IEM's one-minute service, classify status, and write the result
 * to the Scan sheet.
 *
 * Status logic mirrors lib/server/iem.ts on the Next.js side:
 *   age <  90 min  → CLEAN
 *   age <  6 hours → INTERMITTENT
 *   age <  24 hours → MISSING
 *   age >= 24 hours → OFFLINE
 *   no row at all  → "NO DATA"
 */
function runScan() {
  var t0 = Date.now();
  var stations = parseList(PROP("ASOS_STATIONS", ""), DEFAULT_STATIONS);
  // Chunk so a 1000-station list doesn't trip the 6-min cap.
  var chunkSize = PROPN("SCAN_CHUNK_SIZE", 100);
  var rows = [];
  for (var i = 0; i < stations.length; i += chunkSize) {
    var chunk = stations.slice(i, i + chunkSize);
    rows = rows.concat(scanChunk(chunk));
    // Defensive throttle so we never trip IEM's "1 req / 5 s" bucket.
    Utilities.sleep(500);
  }
  var counts = tallyCounts(rows);
  writeSheet(SHEET_SCAN,
    ["station","status","minutes_since","probable_reason","last_metar"],
    rows.map(function (r) {
      return [r.station, r.status, r.minutes_since, r.probable_reason, r.last_metar];
    }));
  upsertHealth({
    last_scan_at: nowIso(),
    last_scan_duration_ms: Date.now() - t0,
    last_scan_stations: rows.length,
    status_counts: counts
  });
  appendHistory("scan", { duration_ms: Date.now() - t0, rows: rows.length, counts: counts });
  return { ok: true, rows: rows.length, counts: counts, duration_ms: Date.now() - t0 };
}

/** Fetch one chunk of stations from IEM. */
function scanChunk(stations) {
  if (!stations.length) return [];
  // IEM accepts a comma-separated `station=` parameter and returns CSV.
  var url = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py" +
    "?station=" + encodeURIComponent(stations.join(",")) +
    "&data=metar&latest=yes&format=onlycomma" +
    "&year1=" + new Date().getFullYear() +
    "&month1=1&day1=1&year2=" + new Date().getFullYear() +
    "&month2=12&day2=31";
  var txt = httpGet(url, 30000);
  if (!txt) {
    // IEM down or rate-limited — emit "NO DATA" rows so the sheet still
    // shows every requested station rather than silently shrinking.
    return stations.map(function (s) {
      return { station: s, status: "NO DATA", minutes_since: null,
               probable_reason: "IEM unreachable", last_metar: "" };
    });
  }
  return parseIemCsv(txt, stations);
}

/** Parse IEM's `format=onlycomma` CSV. First line is the header. */
function parseIemCsv(txt, requested) {
  var lines = txt.split(/\r?\n/);
  if (lines.length < 2) return [];
  var headers = lines[0].split(",");
  var stationCol = headers.indexOf("station");
  var validCol   = headers.indexOf("valid");
  var metarCol   = headers.indexOf("metar");
  if (stationCol < 0 || validCol < 0) return [];
  var seen = {};
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    var fields = lines[i].split(",");
    var st = (fields[stationCol] || "").trim().toUpperCase();
    if (!st) continue;
    // IEM may return multiple rows per station ordered chronologically.
    // We keep the LAST one we see (chronologically latest).
    seen[st] = {
      valid: fields[validCol] || "",
      metar: metarCol >= 0 ? (fields[metarCol] || "") : ""
    };
  }
  var now = Date.now();
  return requested.map(function (st) {
    var hit = seen[st.toUpperCase()];
    if (!hit || !hit.valid) {
      return { station: st, status: "NO DATA", minutes_since: null,
               probable_reason: "no recent observation in IEM",
               last_metar: "" };
    }
    var ts = Date.parse(hit.valid + "Z");
    var minutes = isFinite(ts) ? Math.round((now - ts) / 60000) : null;
    var status, reason;
    if (minutes == null)         { status = "NO DATA";     reason = "unparseable timestamp"; }
    else if (minutes <  90)      { status = "CLEAN";       reason = ""; }
    else if (minutes <  360)     { status = "INTERMITTENT"; reason = "no METAR for >90 min"; }
    else if (minutes < 1440)     { status = "MISSING";     reason = "no METAR for >6 hr"; }
    else                         { status = "OFFLINE";     reason = "no METAR for >24 hr"; }
    return { station: st, status: status, minutes_since: minutes,
             probable_reason: reason, last_metar: hit.metar };
  });
}

function tallyCounts(rows) {
  var c = { CLEAN:0, FLAGGED:0, MISSING:0, INTERMITTENT:0, OFFLINE:0, "NO DATA":0 };
  rows.forEach(function (r) { c[r.status] = (c[r.status] || 0) + 1; });
  return c;
}

// ===================================================================
// 3. NDBC BUOY STATUS
// ===================================================================

/**
 * Mirrors lib/server/ndbc-status.ts. Pulls latest_obs.txt and computes
 * one of UP / DEGRADED / DOWN per buoy from the gap-since-last-obs.
 */
function runBuoys() {
  var t0 = Date.now();
  var url = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt";
  var txt = httpGet(url, 25000);
  if (!txt) {
    appendHistory("buoys", { error: "NDBC unreachable" });
    return { ok: false, error: "NDBC unreachable" };
  }
  var rows = parseNdbcLatest(txt);
  writeSheet(SHEET_BUOYS,
    ["station","lat","lon","status","minutes_since","last_ob"],
    rows.map(function (r) {
      return [r.station, r.lat, r.lon, r.status, r.minutes_since, r.last_ob];
    }));
  var up = 0, deg = 0, down = 0;
  rows.forEach(function (r) {
    if (r.status === "UP") up++;
    else if (r.status === "DEGRADED") deg++;
    else down++;
  });
  upsertHealth({
    last_buoys_at: nowIso(),
    buoy_counts: { UP: up, DEGRADED: deg, DOWN: down, total: rows.length }
  });
  appendHistory("buoys", { rows: rows.length, up: up, degraded: deg, down: down,
                           duration_ms: Date.now() - t0 });
  return { ok: true, rows: rows.length, up: up, degraded: deg, down: down };
}

/** Parse the fixed-width-ish NDBC latest_obs format. The file has two
 *  header lines (column names + units) followed by rows of obs. */
function parseNdbcLatest(txt) {
  var lines = txt.split(/\r?\n/);
  // First two lines are headers.
  var rows = [];
  var now = Date.now();
  for (var i = 2; i < lines.length; i++) {
    var line = lines[i];
    if (!line || !line.trim()) continue;
    var fields = line.split(/\s+/);
    if (fields.length < 5) continue;
    var station = fields[0];
    var lat = parseFloat(fields[1]);
    var lon = parseFloat(fields[2]);
    // year mo dy hr mn = fields[3..7]
    var Y = fields[3], Mo = fields[4], D = fields[5], H = fields[6], Mi = fields[7];
    var iso = Y + "-" + pad(Mo) + "-" + pad(D) + "T" + pad(H) + ":" + pad(Mi) + ":00Z";
    var ts = Date.parse(iso);
    var minutes = isFinite(ts) ? Math.round((now - ts) / 60000) : null;
    var status = "UP";
    if (minutes == null || minutes > 360)     status = "DOWN";
    else if (minutes > 90)                    status = "DEGRADED";
    rows.push({ station: station, lat: lat, lon: lon, status: status,
                minutes_since: minutes, last_ob: iso });
  }
  return rows;
}

// ===================================================================
// 4. HAZARDS — AWC SIGMETs, NHC storms, SWPC alerts
// ===================================================================

function runHazards() {
  var t0 = Date.now();
  var sigmets = fetchAwcSigmets();
  var storms  = fetchNhcStorms();
  var swpc    = fetchSwpcAlerts();
  var combined = []
    .concat(sigmets.map(function (s) {
      return ["SIGMET", s.hazard || "", s.airSigmetType || "",
              s.validTimeFrom || "", s.validTimeTo || "",
              (s.rawAirSigmet || "").slice(0, 250)];
    }))
    .concat(storms.map(function (s) {
      return ["STORM", s.name || "", s.classification || "",
              s.advisoryDate || "", "",
              "wind " + (s.intensity || "") + " kt; " + (s.movement || "")];
    }))
    .concat(swpc.map(function (a) {
      return ["SWPC", a.message_code || "", a.serial_number || "",
              a.issue_datetime || "", "",
              (a.message || "").slice(0, 250)];
    }));
  writeSheet(SHEET_HAZARDS,
    ["kind","label","subtype","valid_from","valid_to","detail"],
    combined);
  upsertHealth({
    last_hazards_at: nowIso(),
    hazard_counts: { sigmets: sigmets.length, storms: storms.length, swpc: swpc.length }
  });
  appendHistory("hazards", { sigmets: sigmets.length, storms: storms.length,
                             swpc: swpc.length, duration_ms: Date.now() - t0 });
  return { ok: true, sigmets: sigmets.length, storms: storms.length, swpc: swpc.length };
}

function fetchAwcSigmets() {
  var url = "https://aviationweather.gov/api/data/airsigmet?format=json";
  var raw = httpGet(url, 20000);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function fetchNhcStorms() {
  var url = "https://www.nhc.noaa.gov/CurrentStorms.json";
  var raw = httpGet(url, 15000);
  if (!raw) return [];
  try {
    var obj = JSON.parse(raw);
    return Array.isArray(obj.activeStorms) ? obj.activeStorms : [];
  } catch (e) { return []; }
}

function fetchSwpcAlerts() {
  var url = "https://services.swpc.noaa.gov/products/alerts.json";
  var raw = httpGet(url, 15000);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

// ===================================================================
// 5. AI BRIEF — emails the operator a NOC shift-change summary
// ===================================================================

function runDigest() {
  var t0 = Date.now();
  var health = readHealth();
  var hazards = readSheet(SHEET_HAZARDS).rows || [];
  var scan    = readSheet(SHEET_SCAN).rows    || [];
  // Top 5 problem stations by minutes_since descending among non-CLEAN.
  var top = scan
    .filter(function (r) { return r[1] !== "CLEAN" && r[1] !== "NO DATA"; })
    .sort(function (a, b) { return (Number(b[2]) || 0) - (Number(a[2]) || 0); })
    .slice(0, 5);
  var hazardSummary = hazards.slice(0, 10).map(function (h) {
    return "  " + h[0] + " — " + h[1] + " (" + h[2] + ")";
  }).join("\n");
  var sysPrompt =
    "You are an ASOS network operations briefer for the NOAA / FAA " +
    "Automated Surface Observing System. Write a concise NOC shift-" +
    "change briefing in 3 short paragraphs: 1) NETWORK HEALTH from " +
    "the status counts; 2) STATIONS NEEDING ATTENTION (top 5 worst " +
    "by ICAO + reason); 3) AVIATION HAZARDS (active SIGMETs / NHC " +
    "storms / SWPC alerts). English only. Operational tone.";
  var userMsg =
    "STATUS COUNTS:\n" + JSON.stringify(health.status_counts || {}) + "\n\n" +
    "TOP PROBLEM STATIONS:\n" +
    top.map(function (r) {
      return "  " + r[0] + " " + r[1] + " " + r[2] + "min " + (r[3] || "");
    }).join("\n") + "\n\n" +
    "ACTIVE HAZARDS (showing " + hazards.length + " total):\n" +
    hazardSummary;
  var brief = openaiChat(sysPrompt, userMsg);
  if (!brief) {
    appendHistory("digest", { error: "AI brief returned empty" });
    return { ok: false, error: "AI brief returned empty" };
  }
  // Persist the brief so the web app's ?path=brief can serve it.
  appendBriefRow(brief, top, health.status_counts || {}, hazards.length);
  // Email it.
  var recipients = parseList(PROP("BRIEF_RECIPIENTS", ""), []);
  if (recipients.length) {
    MailApp.sendEmail({
      to: recipients.join(","),
      subject: "OWL Shift-Change Brief — " + new Date().toISOString().slice(0, 16) + "Z",
      body: brief + "\n\n--\nGenerated by OWL Apps Script. " +
            "Status counts: " + JSON.stringify(health.status_counts || {}),
      htmlBody: htmlEscape(brief).replace(/\n/g, "<br>") +
                "<hr><small>Generated by OWL Apps Script. " +
                "Status counts: " + htmlEscape(JSON.stringify(health.status_counts || {})) +
                "</small>"
    });
  }
  appendHistory("digest", {
    duration_ms: Date.now() - t0,
    chars: brief.length,
    recipients: recipients.length
  });
  return { ok: true, chars: brief.length, recipients: recipients.length };
}

/** OpenAI-compatible chat call. Supports both Ollama Cloud (any model
 *  via OPENAI_BASE_URL) and OpenAI directly. */
function openaiChat(sys, user) {
  var base  = PROP("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/+$/, "");
  var key   = PROP("OPENAI_API_KEY", "");
  var model = PROP("AI_BRIEF_MODEL", "gpt-4o-mini");
  if (!key) return "AI Brief is not configured. Set OPENAI_API_KEY in Script Properties.";
  var url = base + "/chat/completions";
  var body = {
    model: model,
    messages: [
      { role: "system", content: sys },
      { role: "user",   content: user }
    ],
    max_tokens: PROPN("AI_BRIEF_MAX_TOKENS", 4000),
    temperature: 0.3
  };
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    headers: { Authorization: "Bearer " + key },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) {
    return "AI Brief upstream error (" + res.getResponseCode() + "): " +
           res.getContentText().slice(0, 200);
  }
  try {
    var obj = JSON.parse(res.getContentText());
    return (obj.choices && obj.choices[0] && obj.choices[0].message &&
            obj.choices[0].message.content) || "";
  } catch (e) {
    return "AI Brief parse error: " + e.message;
  }
}

// ===================================================================
// 6. SHEET HELPERS
// ===================================================================

/** Idempotent: returns the sheet, creating it if missing. */
function sheet(name) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** Replace all rows on a sheet with the given header + rows. Header is
 *  pinned; data rows are written in one batch (fast). */
function writeSheet(name, headers, rows) {
  var sh = sheet(name);
  sh.clearContents();
  if (rows.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  } else {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  }
  sh.setFrozenRows(1);
}

/** Read a sheet back as { headers: [...], rows: [[...], ...] }. */
function readSheet(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return { headers: [], rows: [] };
  var values = sh.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [] };
  return { headers: values[0], rows: values.slice(1) };
}

/** Health is a single-row sheet of key/value pairs we maintain. */
function upsertHealth(patch) {
  var sh = sheet(SHEET_HEALTH);
  var data = sh.getDataRange().getValues();
  var current = {};
  for (var i = 1; i < data.length; i++) {
    current[data[i][0]] = data[i][1];
  }
  Object.keys(patch).forEach(function (k) {
    var v = patch[k];
    current[k] = (typeof v === "object") ? JSON.stringify(v) : v;
  });
  sh.clearContents();
  sh.getRange(1, 1, 1, 2).setValues([["key","value"]]).setFontWeight("bold");
  var rows = Object.keys(current).map(function (k) { return [k, current[k]]; });
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  sh.setFrozenRows(1);
}

function readHealth() {
  var data = readSheet(SHEET_HEALTH);
  var out = { source: "owl-gas", now: nowIso() };
  data.rows.forEach(function (r) {
    var v = r[1];
    // Parse JSON-encoded values transparently.
    if (typeof v === "string" && (v[0] === "{" || v[0] === "[")) {
      try { v = JSON.parse(v); } catch (e) { /* leave as string */ }
    }
    out[r[0]] = v;
  });
  return out;
}

/** Append-only run log. Capped via rotateLogs() daily. */
function appendHistory(kind, payload) {
  var sh = sheet(SHEET_HISTORY);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["timestamp","kind","payload"]);
    sh.setFrozenRows(1);
  }
  sh.appendRow([nowIso(), kind, JSON.stringify(payload)]);
}

function appendBriefRow(text, top, counts, hazardCount) {
  var sh = sheet(SHEET_BRIEF);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["timestamp","counts","hazards","top","brief"]);
    sh.setFrozenRows(1);
  }
  sh.appendRow([
    nowIso(), JSON.stringify(counts), hazardCount,
    JSON.stringify((top || []).map(function (r) { return r[0]; })),
    text
  ]);
}

/** Returns the most recent brief row as { timestamp, brief, ... }. */
function readLatestBrief() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_BRIEF);
  if (!sh || sh.getLastRow() < 2) return { ok: false, brief: null };
  var lastRow = sh.getRange(sh.getLastRow(), 1, 1, 5).getValues()[0];
  return {
    ok: true,
    timestamp: lastRow[0],
    counts: safeParse(lastRow[1]),
    hazards: lastRow[2],
    top: safeParse(lastRow[3]),
    brief: lastRow[4]
  };
}

/** Trim history sheets so they never blow past 10k rows. */
function rotateLogs() {
  [SHEET_HISTORY, SHEET_BRIEF].forEach(function (name) {
    var sh = SpreadsheetApp.getActive().getSheetByName(name);
    if (!sh) return;
    var max = 10000;
    var rows = sh.getLastRow();
    if (rows > max + 1) {
      // Delete the oldest rows beyond the cap, keeping the header.
      sh.deleteRows(2, rows - max - 1);
    }
  });
}

// ===================================================================
// 7. TRIGGER MANAGEMENT
// ===================================================================

/** Idempotent: removes any existing OWL triggers and recreates them. */
function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger("runScan").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("runBuoys").timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger("runHazards").timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger("runDigest").timeBased().everyHours(4).create();
  ScriptApp.newTrigger("rotateLogs").timeBased().everyDays(1).atHour(3).create();
  SpreadsheetApp.getUi().alert(
    "OWL triggers installed.\n\n" +
    "  • Scan       every 5 min\n" +
    "  • Buoys      every 15 min\n" +
    "  • Hazards    every 10 min\n" +
    "  • AI Brief   every 4 hr\n" +
    "  • Log rotate daily at 03:00\n\n" +
    "Initial run will fire at the next interval. To run now, " +
    "use the OWL menu.");
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === "runScan" || fn === "runBuoys" || fn === "runHazards" ||
        fn === "runDigest" || fn === "rotateLogs") {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function showWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(
    "Web-app URL:\n\n" + (url || "(not deployed yet — Deploy → New deployment → Web app)") +
    "\n\nQuery params:\n" +
    "  ?path=health   ← /api/health-shaped JSON\n" +
    "  ?path=scan     ← latest scan rows\n" +
    "  ?path=buoys    ← latest buoy rows\n" +
    "  ?path=hazards  ← active hazards\n" +
    "  ?path=brief    ← most recent AI brief");
}

// ===================================================================
// 8. UTILITIES
// ===================================================================

/** GET helper with status-aware error handling. Returns empty string
 *  on any non-2xx so callers can fall back to last-known cache instead
 *  of throwing. */
function httpGet(url, timeoutMs) {
  try {
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*" },
      muteHttpExceptions: true,
      followRedirects: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return res.getContentText();
    Logger.log("httpGet " + url + " → " + code);
    return "";
  } catch (e) {
    Logger.log("httpGet exception " + url + " → " + e);
    return "";
  }
}

function parseList(s, fallback) {
  if (!s || !String(s).trim()) return fallback;
  return String(s).split(",").map(function (x) { return x.trim(); }).filter(Boolean);
}

function nowIso() { return new Date().toISOString(); }

function pad(n) { n = String(n); return n.length < 2 ? "0" + n : n; }

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return s; }
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
