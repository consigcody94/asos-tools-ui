/** Iowa Environmental Mesonet (IEM) METAR fetcher + network scan.
 *
 *  IEM's CGI endpoint accepts any number of stations in one GET and
 *  returns CSV. We batch 20 per request; the shared rate-limited
 *  fetcher enforces the per-host budget (3 req/s) and handles
 *  Retry-After / 429 backoff automatically.
 */

import { hasMaintenanceFlag, parseMetarTime } from "./metar";
import type { ScanRow, StationStatus } from "./types";
import { aomcStations } from "./stations";
import { fetchText } from "./fetcher";

const IEM_BASE =
  process.env.IEM_API_BASE || "https://mesonet.agron.iastate.edu";

// 20-station batches serially; fetcher's token bucket keeps things polite.
const BATCH = 20;

interface RawMetarRow {
  station: string;
  valid: string;     // "YYYY-MM-DD HH:MM" (local — UTC with no TZ marker)
  metar: string;
}

async function fetchBatch(stations: string[], hoursBack = 4): Promise<RawMetarRow[]> {
  if (!stations.length) return [];
  const query: Record<string, string | string[]> = {
    station: stations,
    data: "metar",
    year1: "",
    hours: String(hoursBack),
    format: "onlycomma",
    latlon: "no",
    missing: "M",
    trace: "T",
    direct: "no",
    report_type: ["3", "4"],
  };
  const text = await fetchText(`${IEM_BASE}/cgi-bin/request/asos.py`, {
    query, timeoutMs: 60_000, retries: 6,
  });
  if (!text) {
    console.warn(`[iem] batch of ${stations.length} returned null text after retries`);
    return [];
  }
  return parseCsv(text);
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

/** Fetch the last-N-hours of METARs for a set of stations.
 *
 *  Batches run serially — the shared fetcher's token bucket (3 req/s)
 *  and per-host serial queue paces them without us needing a manual
 *  inter-batch delay. 920 stations ≈ 46 batches → ~20-30s typical. */
export async function fetchRecentMetars(
  stations: string[],
  hoursBack = 4,
): Promise<RawMetarRow[]> {
  const batches: string[][] = [];
  for (let i = 0; i < stations.length; i += BATCH) {
    batches.push(stations.slice(i, i + BATCH));
  }
  const out: RawMetarRow[] = [];
  for (const batch of batches) {
    const rows = await fetchBatch(batch, hoursBack);
    for (const r of rows) out.push(r);
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
  // Empty set → station reported nothing in the 4h window we asked for.
  // That's MISSING, not NO DATA (the latter is pre-scan-only state).
  if (metars.length === 0) {
    return {
      status: "MISSING",
      minutes_since_last_report: null,
      last_metar: null,
      last_valid: null,
      probable_reason: "no METAR in the 4h scan window",
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
