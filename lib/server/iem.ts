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

  // IEM returns rate-limit messages as 200 OK text bodies, bypassing the
  // fetcher's HTTP-status retry logic. Detect that pattern and retry
  // with additional backoff up to ``IEM_TEXT_RETRIES`` times.
  const IEM_TEXT_RETRIES = 4;
  for (let attempt = 0; attempt < IEM_TEXT_RETRIES; attempt++) {
    const text = await fetchText(`${IEM_BASE}/cgi-bin/request/asos.py`, {
      query, timeoutMs: 60_000, retries: 3,
    });
    if (!text) {
      console.warn(`[iem] batch of ${stations.length} got null text (attempt ${attempt + 1}/${IEM_TEXT_RETRIES})`);
      continue;
    }
    if (isIemErrorBody(text)) {
      const waitMs = 1500 * (attempt + 1);
      console.warn(`[iem] batch got rate-limit error body (attempt ${attempt + 1}/${IEM_TEXT_RETRIES}); waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    return parseCsv(text);
  }
  console.warn(`[iem] batch of ${stations.length} exhausted all retries — empty result`);
  return [];
}

/** IEM responds to rate limiting with HTTP 200 + a text body like
 *  "Too many requests from your IP address, slow down." — not a proper
 *  429. We detect the error signature up front and treat it as a batch
 *  failure so fetchText/fetchBatch can retry. */
const IEM_ERROR_SIGNATURES = [
  "too many requests",
  "slow down",
  "error code",
  "error:",
];

function isIemErrorBody(text: string): boolean {
  const first = text.slice(0, 300).toLowerCase();
  return IEM_ERROR_SIGNATURES.some((sig) => first.includes(sig));
}

function parseCsv(text: string): RawMetarRow[] {
  if (isIemErrorBody(text)) {
    console.warn(`[iem] body looks like a rate-limit/error response; treating as empty for retry`);
    return [];
  }
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

/** Minutes a station can be silent before we flip it from "gap but okay"
 *  (INTERMITTENT) to MISSING. Mirrors the Python watchlist constant. */
const MISSING_SILENCE_MIN = 120;

/** Days of silence that escalate MISSING → OFFLINE (major issue / likely
 *  decommissioned). Python's watchlist does not model this yet; OWL UI
 *  adds it per user spec. Note: a single 4h scan cannot by itself
 *  distinguish 4h-silent from 14d-silent — OFFLINE is only emitted when
 *  the station catalog's ``archive_end`` is set and in the past. */
const OFFLINE_ARCHIVE_GRACE_DAYS = 14;

/** Build the set of expected HH:00 UTC bucket boundaries inside
 *  ``[start, end]`` whose scheduled :51 METAR should already have filed. */
function expectedHourlyBuckets(start: Date, end: Date, graceMin = 15): Set<number> {
  const now = Date.now();
  const effectiveEnd = Math.min(end.getTime(), now - graceMin * 60_000);
  if (effectiveEnd <= start.getTime()) return new Set();
  // First full hour >= start.
  let first = new Date(Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
    start.getUTCHours(), 0, 0, 0,
  )).getTime();
  if (first < start.getTime()) first += 3_600_000;
  const out = new Set<number>();
  for (let h = first; h + 3_600_000 <= effectiveEnd + graceMin * 60_000; h += 3_600_000) {
    out.add(h);
  }
  return out;
}

function classify(
  metars: RawMetarRow[],
  now: Date,
  expectedBuckets: Set<number>,
  archiveEnd: string | null = null,
): Pick<ScanRow, "status" | "minutes_since_last_report" | "last_metar" | "last_valid" | "probable_reason"> {
  // Catalog-based OFFLINE: station was decommissioned before the scan window.
  if (archiveEnd) {
    const t = Date.parse(archiveEnd);
    if (Number.isFinite(t) && now.getTime() - t > OFFLINE_ARCHIVE_GRACE_DAYS * 86_400_000) {
      return {
        status: "OFFLINE",
        minutes_since_last_report: null,
        last_metar: null,
        last_valid: null,
        probable_reason: `decommissioned — archive_end ${archiveEnd}`,
      };
    }
  }

  // Zero METARs in the window → MISSING (matches Python watchlist when
  // any expected bucket existed, which is true for any 4h scan).
  if (metars.length === 0) {
    return {
      status: "MISSING",
      minutes_since_last_report: null,
      last_metar: null,
      last_valid: null,
      probable_reason: "no METAR received in scan window",
    };
  }

  // Sort newest-first by valid timestamp.
  const rows = [...metars].sort((a, b) => (a.valid < b.valid ? 1 : -1));
  const latest = rows[0];
  const latestTime = parseMetarTime(latest.metar, now);
  const minsSinceLast = latestTime
    ? Math.max(0, Math.round((now.getTime() - latestTime.getTime()) / 60000))
    : null;

  const flaggedInWindow = rows.filter((r) => hasMaintenanceFlag(r.metar)).length;
  const latestFlagged = hasMaintenanceFlag(latest.metar);

  // Hour-bucket coverage: a bucket [HH:00, HH+1:00) is covered if any
  // METAR or SPECI falls inside it, OR if an early report at HH:45+ files
  // for the next bucket.
  const covered = new Set<number>();
  for (const r of rows) {
    const t = parseMetarTime(r.metar, now);
    if (!t) continue;
    const bucket = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours());
    if (expectedBuckets.has(bucket)) covered.add(bucket);
    if (t.getUTCMinutes() >= 45) {
      const adj = bucket + 3_600_000;
      if (expectedBuckets.has(adj)) covered.add(adj);
    }
  }
  let missingBucketCount = 0;
  for (const b of expectedBuckets) if (!covered.has(b)) missingBucketCount++;

  // Priority ladder — mirrors Python watchlist.build_watchlist():
  //   1. Silent ≥ 2h           → MISSING
  //   2. Latest $-flagged      → FLAGGED
  //   3. No flags, no gaps     → CLEAN
  //   4. No flags but gaps     → INTERMITTENT
  //   5. Last two clean, no gaps → RECOVERED
  //   6. else                   → INTERMITTENT

  if (minsSinceLast === null || minsSinceLast >= MISSING_SILENCE_MIN) {
    return {
      status: "MISSING",
      minutes_since_last_report: minsSinceLast,
      last_metar: latest.metar,
      last_valid: latest.valid,
      probable_reason: `silent ${minsSinceLast ?? "?"}m (≥ ${MISSING_SILENCE_MIN}m threshold)`,
    };
  }
  if (latestFlagged) {
    return {
      status: "FLAGGED",
      minutes_since_last_report: minsSinceLast,
      last_metar: latest.metar,
      last_valid: latest.valid,
      probable_reason: "maintenance-check indicator ($) set on latest METAR",
    };
  }
  if (flaggedInWindow === 0 && missingBucketCount === 0) {
    return {
      status: "CLEAN",
      minutes_since_last_report: minsSinceLast,
      last_metar: latest.metar,
      last_valid: latest.valid,
      probable_reason: null,
    };
  }
  if (flaggedInWindow === 0) {
    return {
      status: "INTERMITTENT",
      minutes_since_last_report: minsSinceLast,
      last_metar: latest.metar,
      last_valid: latest.valid,
      probable_reason: `${missingBucketCount} hour(s) missing in scan window`,
    };
  }
  // flaggedInWindow > 0 — possibly RECOVERED
  const last2 = rows.slice(0, 2);
  if (last2.length >= 2 && last2.every((r) => !hasMaintenanceFlag(r.metar)) && missingBucketCount === 0) {
    return {
      status: "RECOVERED",
      minutes_since_last_report: minsSinceLast,
      last_metar: latest.metar,
      last_valid: latest.valid,
      probable_reason: "recent $-flag cleared; last two reports clean",
    };
  }
  return {
    status: "INTERMITTENT",
    minutes_since_last_report: minsSinceLast,
    last_metar: latest.metar,
    last_valid: latest.valid,
    probable_reason: `${flaggedInWindow} flagged + ${missingBucketCount} missing in window`,
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
  const start = new Date(now.getTime() - hoursBack * 3_600_000);
  const expectedBuckets = expectedHourlyBuckets(start, now);

  // archive_end cross-reference: IEM's full ASOS catalog (2,929 sites)
  // carries decommissioning metadata that the AOMC catalog doesn't.
  // Build a lookup once per scan so classify() can mark OFFLINE accurately.
  const archiveEndByKey = new Map<string, string | null>();
  try {
    const { allAsosStations } = await import("./stations");
    for (const s of allAsosStations()) {
      archiveEndByKey.set(normStationKey(s.id), s.archive_end ?? null);
    }
  } catch { /* optional enrichment */ }

  return cat.map((s) => {
    const key = normStationKey(s.id);
    const ms = byStation.get(key) || [];
    const archiveEnd = archiveEndByKey.get(key) ?? null;
    const cls = classify(ms, now, expectedBuckets, archiveEnd);
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
    CLEAN: 0, FLAGGED: 0, MISSING: 0, OFFLINE: 0,
    INTERMITTENT: 0, RECOVERED: 0, "NO DATA": 0,
  };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return { counts, total: rows.length };
}
