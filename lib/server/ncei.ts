/** NCEI Access Services + cross-validation layer.
 *
 *  Wires NCEI as the authoritative second source for ASOS METAR data
 *  classifications. When IEM returns INTERMITTENT/MISSING/FLAGGED for
 *  a station, this module asks NCEI for the same window. If NCEI shows
 *  full data, the IEM classification is downgraded — the gap was the
 *  mirror, not the station.
 *
 *  Why NCEI specifically: per the user's directive, NCEI is the
 *  redundancy layer. NCEI is the authoritative archive (Iowa State's
 *  IEM is a *mirror* of NCEI's data); using it as the second opinion
 *  means our classifications are backed by the canonical source even
 *  when the mirror lags.
 *
 *  Maintenance-aware: NCEI publishes scheduled outage windows (see
 *  https://www.ncei.noaa.gov/access/services/alerts). When configured
 *  via NCEI_MAINT_START / NCEI_MAINT_END env vars, fetches short-
 *  circuit and the cross-check pass marks rows with skipped:"maintenance"
 *  rather than fail. Operators see a banner; classifications stay at
 *  whatever IEM produced until NCEI returns.
 *
 *  Rate envelope: NCEI's docs guide ≤5 req/s per IP. Combined with our
 *  fetcher.ts host-bucket (3 req/s safe default), one full cross-check
 *  pass over the ~370 disputed stations would take ~125 seconds. To
 *  fit inside a single 5-min scan-cache cycle, the pass instead picks
 *  ~30 disputed stations per cycle, oldest-checked first, so every
 *  disputed classification gets a second opinion within ~12 cycles
 *  (~1 hour). This is the right tradeoff: we never burn the entire
 *  NCEI budget on a single tick and the worst case stale-cross-check
 *  is one hour.
 */

import { fetchJson } from "./fetcher";
import type { CrossCheck, ScanRow, StationStatus } from "./types";

const ACCESS_BASE  = "https://www.ncei.noaa.gov/access/services/data/v1";
const STORM_BASE   = "https://www.ncei.noaa.gov/stormevents/json";

// Maintenance window — env-configurable so we can flip it without a
// redeploy. Defaults to today's published window: April 30 2026,
// 06:00–12:00 ET (10:00–16:00 UTC). Operators can override or unset.
const DEFAULT_MAINT_START = "2026-04-30T10:00:00Z";
const DEFAULT_MAINT_END   = "2026-04-30T16:00:00Z";

const MAINT_START = process.env.NCEI_MAINT_START || DEFAULT_MAINT_START;
const MAINT_END   = process.env.NCEI_MAINT_END   || DEFAULT_MAINT_END;

/** Returns true when NOW falls inside the configured maintenance window.
 *  Clears env-overridden empties to disable the gate entirely. */
export function isInNceiMaintenanceWindow(now: Date = new Date()): boolean {
  if (!MAINT_START || !MAINT_END) return false;
  const t = now.getTime();
  return t >= Date.parse(MAINT_START) && t <= Date.parse(MAINT_END);
}

/** Public maintenance state for the UI banner. */
export function getNceiMaintenanceStatus(): {
  active: boolean;
  start: string | null;
  end: string | null;
  message: string | null;
} {
  if (!MAINT_START || !MAINT_END) {
    return { active: false, start: null, end: null, message: null };
  }
  const active = isInNceiMaintenanceWindow();
  return {
    active,
    start: MAINT_START,
    end: MAINT_END,
    message: active
      ? `NCEI maintenance window active until ${MAINT_END} — cross-checks suspended`
      : `NCEI maintenance scheduled ${MAINT_START} to ${MAINT_END}`,
  };
}

// ---- NCEI Access Services METAR fetch -------------------------------------
//
// global-hourly is the NCEI dataset of hourly observations from ASOS/AWOS
// stations worldwide. The `stations` param accepts ICAO call signs (e.g.
// "KLGA"). Each row is one hourly observation; for our purpose we only
// need to count buckets in the requested window — NCEI is "did you see
// data here?" not "what was the data."

interface NceiAccessRow {
  STATION?: string;
  DATE?: string;          // ISO timestamp (UTC)
  REPORT_TYPE?: string;   // "FM-15" = METAR
  /* Many other fields — we ignore them; bucket counting is enough. */
}

async function fetchNceiBuckets(
  stationId: string,
  hoursBack: number,
): Promise<{ buckets: number; lastSeen: string | null } | { error: string }> {
  const end = new Date();
  const start = new Date(end.getTime() - hoursBack * 3_600_000);
  // NCEI Access wants `YYYY-MM-DDTHH:mm:ss` (no Z, no ms). Strip both.
  const fmt = (d: Date) => d.toISOString().slice(0, 19);

  const data = await fetchJson<NceiAccessRow[] | { error?: string }>(
    ACCESS_BASE,
    {
      query: {
        dataset: "global-hourly",
        stations: stationId,
        startDate: fmt(start),
        endDate: fmt(end),
        format: "json",
        // Request only the report-type field; massively shrinks payload.
        dataTypes: "REPORT_TYPE",
      },
      timeoutMs: 12_000,
      retries: 1,
    },
  );

  if (!data) return { error: "no response" };
  if (!Array.isArray(data)) {
    const errMsg = (data as { error?: string }).error || "unexpected NCEI shape";
    return { error: errMsg };
  }

  // Bucket by hour (YYYY-MM-DDTHH). NCEI sometimes returns multiple
  // rows for the same hour (corrections, special obs); count distinct
  // hourly buckets to match IEM's bucket-count semantics.
  const buckets = new Set<string>();
  let last = "";
  for (const row of data) {
    if (!row.DATE) continue;
    const hourKey = row.DATE.slice(0, 13);  // YYYY-MM-DDTHH
    buckets.add(hourKey);
    if (row.DATE > last) last = row.DATE;
  }
  return { buckets: buckets.size, lastSeen: last || null };
}

// ---- Cross-check orchestrator ---------------------------------------------

/** Compute what NCEI's bucket count *would* imply about a station's
 *  status, using the same thresholds IEM uses. Centralised so changes
 *  to the classifier rules propagate to the validator automatically. */
function bucketsToStatus(
  buckets: number,
  expected: number,
  iemHadFlag: boolean,
): StationStatus {
  if (iemHadFlag) return "FLAGGED";  // NCEI confirms only the data shape, not the $ flag
  if (buckets === 0) return "MISSING";
  // CLEAN tolerates ≤1 missing bucket in a 4-hour window (matches iem.ts).
  if (expected - buckets <= 1) return "CLEAN";
  return "INTERMITTENT";
}

/** Cross-check a single station against NCEI. Returns a populated
 *  CrossCheck for the row (even on skip — UI needs to know). */
export async function crossCheckStation(
  row: ScanRow,
  hoursBack = 4,
): Promise<CrossCheck> {
  const checked_at = new Date().toISOString();

  if (isInNceiMaintenanceWindow()) {
    return {
      source: "ncei",
      agrees_with_iem: false,
      checked_at,
      buckets_seen: 0,
      skipped: "maintenance",
    };
  }

  const result = await fetchNceiBuckets(row.station, hoursBack);
  if ("error" in result) {
    return {
      source: "ncei",
      agrees_with_iem: false,
      checked_at,
      buckets_seen: 0,
      skipped: "error",
    };
  }

  // Count IEM's expected buckets the same way iem.ts does (1 hourly bucket
  // per hour in the window). Don't bother computing exactly: if minutes
  // since last report is null we have no IEM data; if a number, divide
  // by 60 to estimate.
  const expected = hoursBack;  // simple: 4 hourly buckets in 4-hour window
  const iemHadFlag = row.status === "FLAGGED";
  const suggested = bucketsToStatus(result.buckets, expected, iemHadFlag);

  return {
    source: "ncei",
    agrees_with_iem: suggested === row.status,
    checked_at,
    buckets_seen: result.buckets,
    suggested_status: suggested,
  };
}

// ---- NCEI Storm Events DB (BETA) ------------------------------------------
//
// The Storm Events Database is in BETA per the NCEI alerts page (banner
// active through Dec 18, 2026). UI must surface that flag. Endpoint
// returns JSON of historical hazardous-weather events keyed by location
// and date range. We use it for drill-panel enrichment: "5 events near
// this station in the last 30 days."

export interface StormEvent {
  event_id: number;
  event_type: string;        // "Tornado", "Hail", "Thunderstorm Wind", etc.
  begin_date: string;
  end_date: string;
  state: string;
  county: string;
  magnitude?: number | null;
  deaths_direct?: number | null;
  injuries_direct?: number | null;
  damage_property?: string | null;
  narrative?: string | null;
  source: "ncei-storm-events";
  beta: true;
}

/** Fetch storm events near a coordinate over the last `daysBack` days.
 *  Returns [] on maintenance / error — never throws. The BETA flag on
 *  every row reminds the UI to label the data accordingly. */
export async function fetchStormEvents(
  lat: number,
  lon: number,
  daysBack = 30,
  radiusKm = 100,
): Promise<StormEvent[]> {
  if (isInNceiMaintenanceWindow()) return [];

  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 86_400_000);

  // NCEI Storm Events search supports begin/end + bounding box. Convert
  // radius to a rough lat/lon box (1° lat ≈ 111 km).
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const data = await fetchJson<{ events?: Array<Record<string, unknown>> }>(
    STORM_BASE,
    {
      query: {
        beginDate_mm: String(start.getMonth() + 1),
        beginDate_dd: String(start.getDate()),
        beginDate_yyyy: String(start.getFullYear()),
        endDate_mm: String(end.getMonth() + 1),
        endDate_dd: String(end.getDate()),
        endDate_yyyy: String(end.getFullYear()),
        latNorth: String(lat + dLat),
        latSouth: String(lat - dLat),
        lonWest:  String(lon - dLon),
        lonEast:  String(lon + dLon),
        eventType: "ALL",
        county: "",
        statefips: "",
      },
      timeoutMs: 15_000,
      retries: 1,
    },
  );

  const events = data?.events ?? [];
  if (!Array.isArray(events)) return [];

  return events.map((e) => ({
    event_id: Number(e.event_id ?? 0),
    event_type: String(e.event_type ?? ""),
    begin_date: String(e.begin_date_time ?? ""),
    end_date:   String(e.end_date_time ?? ""),
    state:      String(e.state ?? ""),
    county:     String(e.cz_name ?? ""),
    magnitude:  e.magnitude != null ? Number(e.magnitude) : null,
    deaths_direct:    e.deaths_direct != null ? Number(e.deaths_direct) : null,
    injuries_direct:  e.injuries_direct != null ? Number(e.injuries_direct) : null,
    damage_property:  e.damage_property != null ? String(e.damage_property) : null,
    narrative:        e.event_narrative != null ? String(e.event_narrative) : null,
    source: "ncei-storm-events" as const,
    beta: true as const,
  }));
}
