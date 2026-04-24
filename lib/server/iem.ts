/** Iowa Environmental Mesonet (IEM) METAR fetcher + network scan.
 *
 *  IEM's CGI endpoint accepts any number of stations in one GET and
 *  returns CSV. We batch 40 per request (the URL otherwise gets long).
 */

import { METAR_UA, hasMaintenanceFlag, parseMetarTime } from "./metar";
import type { ScanRow, StationStatus } from "./types";
import { aomcStations } from "./stations";

const IEM_BASE =
  process.env.IEM_API_BASE || "https://mesonet.agron.iastate.edu";

const BATCH = 40;

interface RawMetarRow {
  station: string;
  valid: string;     // "YYYY-MM-DD HH:MM" (local — UTC with no TZ marker)
  metar: string;
}

async function fetchBatch(stations: string[], hoursBack = 4): Promise<RawMetarRow[]> {
  if (!stations.length) return [];
  const params = new URLSearchParams();
  for (const s of stations) params.append("station", s);
  params.set("data", "metar");
  params.set("year1", "");
  params.set("hours", String(hoursBack));
  params.set("format", "onlycomma");
  params.set("latlon", "no");
  params.set("missing", "M");
  params.set("trace", "T");
  params.set("direct", "no");
  // IEM wants ``report_type`` repeated, not comma-joined: &report_type=3&report_type=4
  params.append("report_type", "3");
  params.append("report_type", "4");

  // Use the last-N-hours convenience route so the CGI doesn't have to
  // parse explicit start/end.
  const url = `${IEM_BASE}/cgi-bin/request/asos.py?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": METAR_UA, Accept: "text/plain" },
    });
    if (!r.ok) {
      console.warn(`[iem] batch of ${stations.length} returned ${r.status}`);
      return [];
    }
    const text = await r.text();
    const rows = parseCsv(text);
    if (rows.length === 0 && text.length > 0) {
      console.warn(`[iem] batch parsed 0 rows from ${text.length} bytes; first 120 chars: ${text.slice(0, 120)}`);
    }
    return rows;
  } catch (e) {
    console.warn(`[iem] batch fetch failed: ${String(e)}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text: string): RawMetarRow[] {
  const lines = text.split("\n");
  const out: RawMetarRow[] = [];
  if (!lines.length) return out;
  const header = lines[0].split(",").map((s) => s.trim());
  const stIdx = header.indexOf("station");
  const vIdx = header.indexOf("valid");
  const mIdx = header.findIndex((h) => h === "metar" || h === "report");
  if (stIdx < 0 || vIdx < 0 || mIdx < 0) return out;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Quotes in METARs are rare but present; simple CSV split works because
    // IEM's `onlycomma` format uses no quoting.
    const parts = line.split(",");
    if (parts.length < header.length) continue;
    out.push({
      station: parts[stIdx].trim(),
      valid: parts[vIdx].trim(),
      metar: parts[mIdx].trim(),
    });
  }
  return out;
}

/** Fetch the last-N-hours of METARs for a set of stations. */
export async function fetchRecentMetars(
  stations: string[],
  hoursBack = 4,
): Promise<RawMetarRow[]> {
  const batches: string[][] = [];
  for (let i = 0; i < stations.length; i += BATCH) {
    batches.push(stations.slice(i, i + BATCH));
  }
  // Up to 6 concurrent batch requests — IEM handles this comfortably and
  // it keeps 920-station cold scans under ~15 s.
  const out: RawMetarRow[] = [];
  const cc = 6;
  for (let i = 0; i < batches.length; i += cc) {
    const slice = batches.slice(i, i + cc);
    const results = await Promise.all(slice.map((b) => fetchBatch(b, hoursBack)));
    for (const r of results) out.push(...r);
  }
  return out;
}

// ---- Classifier ------------------------------------------------------------
//
// Rules mirror the Python watchlist logic:
//   - No METAR in the last 2h                 → MISSING
//   - Latest METAR has `$` maintenance flag   → FLAGGED
//   - Latest OK but prior 4h had `$` or gap   → RECOVERED / INTERMITTENT
//   - All METARs present + no flags           → CLEAN

function classify(
  metars: RawMetarRow[],
  now: Date,
): Pick<ScanRow, "status" | "minutes_since_last_report" | "last_metar" | "last_valid" | "probable_reason"> {
  if (metars.length === 0) {
    return {
      status: "NO DATA",
      minutes_since_last_report: null,
      last_metar: null,
      last_valid: null,
      probable_reason: "no METARs returned by IEM",
    };
  }
  // Sort newest-first by valid timestamp.
  const rows = [...metars].sort((a, b) => (a.valid < b.valid ? 1 : -1));
  const latest = rows[0];
  const latestTime = parseMetarTime(latest.metar, now);
  const latestMinsAgo = latestTime
    ? Math.max(0, Math.round((now.getTime() - latestTime.getTime()) / 60000))
    : null;

  const flaggedNow = hasMaintenanceFlag(latest.metar);
  const anyFlaggedInWindow = rows.some((r) => hasMaintenanceFlag(r.metar));

  // MISSING: no METAR in the last 2 hours.
  if (latestMinsAgo === null || latestMinsAgo >= 120) {
    return {
      status: "MISSING",
      minutes_since_last_report: latestMinsAgo,
      last_metar: latest.metar,
      last_valid: latest.valid,
      probable_reason: `no METAR in ${latestMinsAgo ?? "?"}m`,
    };
  }

  if (flaggedNow) {
    return {
      status: "FLAGGED",
      minutes_since_last_report: latestMinsAgo,
      last_metar: latest.metar,
      last_valid: latest.valid,
      probable_reason: "maintenance-check indicator ($) set",
    };
  }

  // INTERMITTENT: we had `$` in the window but the latest is clean.
  if (anyFlaggedInWindow) {
    return {
      status: "RECOVERED",
      minutes_since_last_report: latestMinsAgo,
      last_metar: latest.metar,
      last_valid: latest.valid,
      probable_reason: "earlier $-flag cleared in latest report",
    };
  }

  return {
    status: "CLEAN",
    minutes_since_last_report: latestMinsAgo,
    last_metar: latest.metar,
    last_valid: latest.valid,
    probable_reason: null,
  };
}

/** IEM strips leading K/P/T from US ICAOs in its response body (so
 *  ``KJFK`` comes back as ``JFK``), while the AOMC catalog uses the full
 *  4-letter form. Normalise both sides to the K/P/T-stripped shape so
 *  the map lookup matches regardless of which form the upstream picked. */
function normStationKey(id: string): string {
  const s = id.trim().toUpperCase();
  if (s.length === 4 && (s[0] === "K" || s[0] === "P" || s[0] === "T")) {
    return s.substring(1);
  }
  return s;
}

/** Run a full AOMC-catalog scan. Returns per-station rows. */
export async function scanNetwork(hoursBack = 4): Promise<ScanRow[]> {
  const cat = aomcStations();
  const ids = cat.map((s) => s.id);

  const metars = await fetchRecentMetars(ids, hoursBack);
  const byStation = new Map<string, RawMetarRow[]>();
  for (const m of metars) {
    const k = normStationKey(m.station);
    const arr = byStation.get(k) || [];
    arr.push(m);
    byStation.set(k, arr);
  }

  const now = new Date();
  return cat.map((s) => {
    const ms = byStation.get(normStationKey(s.id)) || [];
    const cls = classify(ms, now);
    return {
      station: s.id,
      name: s.name,
      state: s.state,
      lat: s.lat,
      lon: s.lon,
      ...cls,
    };
  });
}

export function scanSummary(rows: ScanRow[]): {
  counts: Record<StationStatus, number>;
  total: number;
} {
  const counts: Record<StationStatus, number> = {
    CLEAN: 0, FLAGGED: 0, MISSING: 0, INTERMITTENT: 0, RECOVERED: 0, "NO DATA": 0,
  };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return { counts, total: rows.length };
}
