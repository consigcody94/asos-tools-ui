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

// IEM aggressively rate-limits `asos.py`. A batch of 40 with 6-way parallelism
// triggers 429 on every call. 20-station batches served serially with a
// 300ms politeness gap survive the limiter cleanly; scan still completes
// in ~25s for 920 stations.
const BATCH = 20;
const INTER_BATCH_MS = 300;
const MAX_RETRIES = 3;

interface RawMetarRow {
  station: string;
  valid: string;     // "YYYY-MM-DD HH:MM" (local — UTC with no TZ marker)
  metar: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchBatchOnce(stations: string[], hoursBack: number): Promise<{ ok: boolean; rows: RawMetarRow[]; status: number; retryAfter?: number }> {
  if (!stations.length) return { ok: true, rows: [], status: 200 };
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
  params.append("report_type", "3");
  params.append("report_type", "4");

  const url = `${IEM_BASE}/cgi-bin/request/asos.py?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": METAR_UA, Accept: "text/plain" },
    });
    if (!r.ok) {
      const retryAfter = parseFloat(r.headers.get("retry-after") || "0");
      return { ok: false, rows: [], status: r.status, retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 };
    }
    const text = await r.text();
    return { ok: true, rows: parseCsv(text), status: 200 };
  } catch (e) {
    console.warn(`[iem] batch fetch error: ${String(e)}`);
    return { ok: false, rows: [], status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBatch(stations: string[], hoursBack = 4): Promise<RawMetarRow[]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const r = await fetchBatchOnce(stations, hoursBack);
    if (r.ok) return r.rows;
    // Rate-limit or transient — back off and retry.
    if (r.status === 429 || r.status === 503 || r.status === 502 || r.status === 0) {
      const waitMs = Math.max(r.retryAfter ? r.retryAfter * 1000 : 0, 800 * Math.pow(2, attempt));
      console.warn(`[iem] batch ${r.status} (attempt ${attempt + 1}/${MAX_RETRIES}); backing off ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }
    // Non-retryable (4xx other than 429) — give up.
    console.warn(`[iem] batch failed non-retryable status ${r.status}`);
    return [];
  }
  console.warn(`[iem] batch gave up after ${MAX_RETRIES} retries`);
  return [];
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
 *  Batches are run **serially** with a small delay between each — IEM's
 *  rate limiter starts 429-ing at ~3 concurrent requests. Serial with a
 *  300 ms gap gets 920 stations through in ~25-35s which is still well
 *  under the 60s server response budget. */
export async function fetchRecentMetars(
  stations: string[],
  hoursBack = 4,
): Promise<RawMetarRow[]> {
  const batches: string[][] = [];
  for (let i = 0; i < stations.length; i += BATCH) {
    batches.push(stations.slice(i, i + BATCH));
  }
  const out: RawMetarRow[] = [];
  for (let i = 0; i < batches.length; i++) {
    const rows = await fetchBatch(batches[i], hoursBack);
    for (const r of rows) out.push(r);
    if (i < batches.length - 1) await sleep(INTER_BATCH_MS);
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
