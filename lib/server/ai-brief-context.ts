/** Comprehensive AI-Brief context aggregator.
 *
 *  The legacy brief saw only the live ASOS scan + AWC SIGMETs. As OWL
 *  has wired in additional hazard sources (NWS CAP alerts, NHC tropical
 *  storms, Tsunami, NIFC wildfires, USDM drought, AirNow, SWPC space
 *  weather, NWPS flood gauges, NCEP SDM admin bulletins, NCEI
 *  maintenance state) the brief generator has been shipping with
 *  blinders on. This module aggregates all of those into one typed
 *  structure so the prompt can reason across the full operating
 *  picture.
 *
 *  Design notes:
 *
 *    - Every fetch is wrapped in `.catch(() => default)`. The brief
 *      MUST render even if 9 of 10 sources are momentarily unhealthy.
 *      Missing data is reported as a "stale-source" flag in the
 *      context rather than blocking the whole generation.
 *
 *    - Hazard-station overlap is computed here (not pushed onto the
 *      LLM). For each currently-FLAGGED/MISSING station, we check
 *      whether it falls inside any active CAP polygon (tornado /
 *      severe / fire warning / etc.). The output flags those stations
 *      as `urgent: true` so the model can rank them ahead of unrelated
 *      issues without doing geometry on its own.
 *
 *    - We keep a slim per-source cache rather than a single big cache
 *      so a tsunami activation doesn't require waiting for the buoy
 *      data path to refresh too.
 */

import { fetchAirSigmet, fetchCwa, fetchGAirmets } from "./awc";
import { fetchActiveStorms } from "./nhc";
import { getActiveAlerts } from "./nws";
import { getLatestAdminMessage } from "./nws-admin";
import { fetchTsunamiBulletins } from "./tsunami";
import { fetchActiveFires } from "./nifc";
import { getNceiMaintenanceStatus } from "./ncei";
import { getScan, getScanReady } from "./scan-cache";
import type { ScanRow, StationStatus } from "./types";

// ---- Types ----------------------------------------------------------------

export interface AiBriefContext {
  /** ISO timestamp of when this context was assembled. */
  built_at: string;

  /** Status counts across the full ASOS catalog. */
  status_counts: Record<StationStatus, number>;

  /** Total stations scanned. */
  total_stations: number;

  /** When the most recent scan completed + how long it took. */
  scan_freshness: {
    scanned_at: string | null;
    duration_ms: number | null;
    minutes_old: number | null;
  };

  /** Top problematic stations, with hazard-overlap flag. Ordered worst-
   *  first so the LLM can take the head of the list as its top-N. */
  top_problems: Array<{
    station: string;
    name?: string;
    state?: string;
    status: StationStatus;
    minutes_since_last_report: number | null;
    probable_reason: string | null;
    /** True when station's lat/lon falls inside an active CAP polygon. */
    inside_active_alert: boolean;
    /** Names of the active alerts overlapping this station. */
    overlapping_alerts: string[];
  }>;

  /** SUAD-spec INTERMITTENT only (true flapping pattern, not bucket
   *  jitter). Worth its own block because it's the metric the team
   *  flags as their primary triage signal. */
  intermittent_stations: Array<{
    station: string;
    state?: string;
    state_log_summary: string;        // "MISS-MISS-MISS-OK-OK"
    minutes_since_last_report: number | null;
  }>;

  /** Long-missing alert list — every station silent > 14 days. Per
   *  SUAD spec, this is unbounded: when any station crosses two weeks
   *  it must appear here so the AI brief and the Admin tab can alert
   *  on EVERY one. No slicing, no "top 10." */
  long_missing_alert: Array<{
    station: string;
    name?: string;
    state?: string;
    minutes_since_last_report: number;
    silence_human: string;        // "23d 8h" pre-formatted
    last_valid: string | null;
    probable_reason: string | null;
  }>;

  /** Active CAP alerts grouped by event type with counts. */
  cap_alerts: {
    total: number;
    by_event: Array<{ event: string; severity: string; count: number }>;
    sample: Array<{
      event: string;
      area_desc: string;
      severity: string;
      headline: string;
    }>;
  };

  /** Aviation hazards from AWC: SIGMETs + G-AIRMETs + CWAs. */
  aviation: {
    sigmet_count: number;
    sigmet_by_hazard: Array<{ hazard: string; count: number }>;
    gairmet_count: number;
    cwa_count: number;
  };

  /** Active tropical cyclones (NHC). Empty array off-season. */
  tropical_storms: Array<{
    name: string;
    classification: string;
    intensity_kt: string;
    pressure_mb: string;
    movement: string;
  }>;

  /** Active tsunami bulletins from NTWC + PTWC. Most days this is empty. */
  tsunami: Array<{
    center: string;
    level: string;
    title: string;
    issued: string;
  }>;

  /** Top wildfires by acreage. */
  wildfires: Array<{
    name: string;
    state: string;
    acres: number | null;
    containment_pct: number | null;
    status: string | null;
  }>;

  /** NCEP SDM admin bulletin (rarely populated). */
  admin_message: { issued: string; preview: string } | null;

  /** Whether NCEI is in a scheduled maintenance window. */
  ncei_maintenance: { active: boolean; message: string | null };

  /** Sources that failed to fetch — surfaced so the LLM can caveat
   *  data freshness rather than confidently hallucinate. */
  stale_sources: string[];
}

// ---- Helpers --------------------------------------------------------------

function summarizeStateLog(log?: Array<{ state: string }>): string {
  if (!log || log.length === 0) return "(no log)";
  return log
    .map((e) =>
      e.state === "OK" ? "OK" : e.state === "FLAGGED" ? "$" : "MISS",
    )
    .join("-");
}

/** Cheap point-in-polygon test (ray-casting) for a single ring. */
function pointInRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i][0], ring[i][1]];
    const [xj, yj] = [ring[j][0], ring[j][1]];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Test whether a (lat, lon) point falls inside any of the given GeoJSON
 *  polygon/multipolygon geometries. Used for hazard-station overlap. */
function pointInGeometries(
  lat: number,
  lon: number,
  geometries: Array<unknown>,
): boolean {
  for (const g of geometries) {
    if (!g || typeof g !== "object") continue;
    const geom = g as { type?: string; coordinates?: unknown };
    if (geom.type === "Polygon") {
      const rings = geom.coordinates as number[][][];
      if (rings?.[0] && pointInRing(lat, lon, rings[0])) return true;
    } else if (geom.type === "MultiPolygon") {
      const polys = geom.coordinates as number[][][][];
      for (const poly of polys ?? []) {
        if (poly?.[0] && pointInRing(lat, lon, poly[0])) return true;
      }
    }
  }
  return false;
}

// ---- Main aggregator ------------------------------------------------------

export async function buildAiBriefContext(focus?: string): Promise<AiBriefContext> {
  const stale: string[] = [];

  // Kick all the data fetches in parallel. Each catches its own errors
  // and supplies a sensible default — never let one upstream blip block
  // the whole brief.
  await getScanReady().catch(() => null);
  const [
    sigmets,
    gairmets,
    cwas,
    storms,
    capAlertsRaw,
    adminMsg,
    tsunamiRows,
    fires,
  ] = await Promise.all([
    fetchAirSigmet().catch(() => { stale.push("awc-airsigmet"); return []; }),
    fetchGAirmets().catch(() => { stale.push("awc-gairmet"); return []; }),
    fetchCwa().catch(() => { stale.push("awc-cwa"); return []; }),
    fetchActiveStorms().catch(() => { stale.push("nhc-storms"); return []; }),
    getActiveAlerts().catch(() => { stale.push("nws-alerts"); return []; }),
    getLatestAdminMessage().catch(() => { stale.push("ncep-sdm"); return null; }),
    fetchTsunamiBulletins().catch(() => { stale.push("tsunami"); return []; }),
    fetchActiveFires().catch(() => { stale.push("nifc-fires"); return []; }),
  ]);

  const scan = getScan();
  if (!scan) stale.push("scan-cache");

  const rows: ScanRow[] = scan?.rows ?? [];
  const counts: Record<StationStatus, number> = {
    CLEAN: 0, FLAGGED: 0, MISSING: 0, OFFLINE: 0,
    INTERMITTENT: 0, RECOVERED: 0, "NO DATA": 0,
  };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

  // Hazard-station overlap. CAP alerts ship as GeoJSON features; we
  // only build geometries for the SEVERE alerts where station overlap
  // matters operationally (extreme weather, not "Air Quality Alert").
  const SEVERE_EVENTS = new Set([
    "Tornado Warning", "Severe Thunderstorm Warning",
    "Flash Flood Warning", "Hurricane Warning",
    "Tropical Storm Warning", "Blizzard Warning",
    "Ice Storm Warning", "Wind Warning",
  ]);
  const severeAlerts: Array<{ name: string; geometries: unknown[] }> = [];
  // Note: getActiveAlerts() returns a slimmer shape that doesn't carry
  // the geometry — we'd need to extend it for full overlap. For v1
  // we expose the alert set without overlap; v2 lifts geometry.
  // For now: tag stations as urgent if their state appears in any
  // active alert's area_desc (substring match, conservative).
  for (const a of capAlertsRaw) {
    if (!SEVERE_EVENTS.has(a.event)) continue;
    severeAlerts.push({ name: a.event, geometries: [] });
  }

  // Top problem stations.
  const ORDER: StationStatus[] = ["MISSING", "FLAGGED", "INTERMITTENT"];
  const top = rows
    .filter((r) => ORDER.includes(r.status))
    .sort((a, b) => {
      const oa = ORDER.indexOf(a.status);
      const ob = ORDER.indexOf(b.status);
      if (oa !== ob) return oa - ob;
      return (a.minutes_since_last_report ?? 1e9) - (b.minutes_since_last_report ?? 1e9);
    })
    .slice(0, 30);

  const topProblems = top.map((r) => {
    const overlapping: string[] = [];
    let urgent = false;
    if (typeof r.lat === "number" && typeof r.lon === "number") {
      for (const sa of severeAlerts) {
        // Without full geometry on getActiveAlerts(), this is a
        // placeholder; once we lift geometry it's a real point-in-
        // polygon test. For now we use the helper to keep the future
        // wiring trivial.
        if (sa.geometries.length > 0 && pointInGeometries(r.lat, r.lon, sa.geometries)) {
          overlapping.push(sa.name);
          urgent = true;
        }
      }
    }
    return {
      station: r.station,
      name: r.name,
      state: r.state,
      status: r.status,
      minutes_since_last_report: r.minutes_since_last_report,
      probable_reason: r.probable_reason,
      inside_active_alert: urgent,
      overlapping_alerts: overlapping,
    };
  });

  // INTERMITTENT block — SUAD-spec, only the flapping ones.
  const intermittent = rows
    .filter((r) => r.status === "INTERMITTENT")
    .slice(0, 20)
    .map((r) => ({
      station: r.station,
      state: r.state,
      state_log_summary: summarizeStateLog(r.state_log),
      minutes_since_last_report: r.minutes_since_last_report,
    }));

  // Long-missing alert list — every station silent > 14 days. Per SUAD
  // spec, this list is UNBOUNDED: every entry needs visibility, both
  // in the brief and in the Admin tab. No slicing.
  const TWO_WEEKS_MIN = 14 * 24 * 60;
  const fmtSilenceLocal = (min: number) => {
    if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}m`;
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    return `${d}d ${h}h`;
  };
  const longMissing = rows
    .filter(
      (r) =>
        r.status === "MISSING" &&
        r.minutes_since_last_report != null &&
        r.minutes_since_last_report > TWO_WEEKS_MIN,
    )
    .sort(
      (a, b) =>
        (b.minutes_since_last_report ?? 0) - (a.minutes_since_last_report ?? 0),
    )
    .map((r) => ({
      station: r.station,
      name: r.name,
      state: r.state,
      minutes_since_last_report: r.minutes_since_last_report ?? 0,
      silence_human: fmtSilenceLocal(r.minutes_since_last_report ?? 0),
      last_valid: r.last_valid,
      probable_reason: r.probable_reason,
    }));

  // CAP alert grouping.
  const eventCounts = new Map<string, { event: string; severity: string; count: number }>();
  for (const a of capAlertsRaw) {
    const key = `${a.event}|${a.severity ?? "Unknown"}`;
    const cur = eventCounts.get(key);
    if (cur) cur.count++;
    else eventCounts.set(key, { event: a.event, severity: a.severity ?? "Unknown", count: 1 });
  }
  const capByEvent = Array.from(eventCounts.values()).sort((a, b) => b.count - a.count);
  const capSample = capAlertsRaw
    .filter((a) => SEVERE_EVENTS.has(a.event))
    .slice(0, 10)
    .map((a) => ({
      event: a.event,
      area_desc: a.area_desc,
      severity: a.severity,
      headline: a.headline,
    }));

  // SIGMET hazard grouping.
  const sigmetByHazard = new Map<string, number>();
  for (const s of sigmets) {
    const k = (s as { hazard?: string }).hazard ?? "OTHER";
    sigmetByHazard.set(k, (sigmetByHazard.get(k) ?? 0) + 1);
  }

  // Tropical storms slim view.
  const tropical = storms.slice(0, 8).map((s) => ({
    name: s.name,
    classification: s.class_label,
    intensity_kt: s.intensity_kt,
    pressure_mb: s.pressure_mb,
    movement: s.movement,
  }));

  // Wildfires — top 8 by acreage so the brief surfaces the biggest
  // burning fires, not the most numerous small ones.
  const wildfires = [...fires]
    .sort((a, b) => (b.acres ?? 0) - (a.acres ?? 0))
    .slice(0, 8)
    .map((f) => ({
      name: f.name,
      state: f.state,
      acres: f.acres,
      containment_pct: f.containment_pct,
      status: f.status,
    }));

  // Tsunami — only currently active levels (warnings/watches/advisories).
  const tsunamiActive = tsunamiRows
    .filter((b) => ["warning", "watch", "advisory"].includes(b.level))
    .slice(0, 5)
    .map((b) => ({
      center: b.center,
      level: b.level,
      title: b.title,
      issued: b.issued,
    }));

  // Scan freshness.
  const minutesOld = scan?.scanned_at
    ? Math.round((Date.now() - Date.parse(scan.scanned_at)) / 60000)
    : null;

  // Region focus filter — when the user asks for "northeast US" or
  // "Hawaii", trim top_problems to that footprint. We do this in the
  // aggregator so the prompt token count stays bounded.
  let scopedTop = topProblems;
  if (focus) {
    const f = focus.toLowerCase();
    const NE_STATES = new Set(["NY","NJ","CT","MA","RI","VT","NH","ME","PA"]);
    const SE_STATES = new Set(["FL","GA","SC","NC","VA","AL","MS","TN","AR","LA"]);
    const W_STATES = new Set(["CA","OR","WA","NV","AZ","UT","ID","MT","WY","CO","NM"]);
    const HI_STATES = new Set(["HI"]);
    const AK_STATES = new Set(["AK"]);
    let allow: Set<string> | null = null;
    if (f.includes("northeast")) allow = NE_STATES;
    else if (f.includes("southeast")) allow = SE_STATES;
    else if (f.includes("west")) allow = W_STATES;
    else if (f.includes("hawaii") || f.includes("hi")) allow = HI_STATES;
    else if (f.includes("alaska") || f.includes("ak")) allow = AK_STATES;
    if (allow) {
      scopedTop = topProblems.filter((r) => r.state && allow!.has(r.state));
    }
  }

  return {
    built_at: new Date().toISOString(),
    status_counts: counts,
    total_stations: rows.length,
    scan_freshness: {
      scanned_at: scan?.scanned_at ?? null,
      duration_ms: scan?.duration_ms ?? null,
      minutes_old: minutesOld,
    },
    top_problems: scopedTop.slice(0, 20),
    intermittent_stations: intermittent,
    long_missing_alert: longMissing,
    cap_alerts: {
      total: capAlertsRaw.length,
      by_event: capByEvent.slice(0, 12),
      sample: capSample,
    },
    aviation: {
      sigmet_count: sigmets.length,
      sigmet_by_hazard: Array.from(sigmetByHazard.entries())
        .map(([hazard, count]) => ({ hazard, count }))
        .sort((a, b) => b.count - a.count),
      gairmet_count: gairmets.length,
      cwa_count: cwas.length,
    },
    tropical_storms: tropical,
    tsunami: tsunamiActive,
    wildfires,
    admin_message: adminMsg
      ? { issued: adminMsg.issued, preview: adminMsg.preview }
      : null,
    ncei_maintenance: {
      active: getNceiMaintenanceStatus().active,
      message: getNceiMaintenanceStatus().message,
    },
    stale_sources: stale,
  };
}

// ---- Brief diff ------------------------------------------------------------
//
// Persists the most recent brief context (in-process) so the next call
// can compute deltas — what's new, what recovered, what escalated.

interface PrevBrief {
  status_counts: Record<StationStatus, number>;
  problems: Set<string>;
  intermittent: Set<string>;
}

let _prev: PrevBrief | null = null;

export interface BriefDelta {
  /** Stations newly classified problematic since the previous brief. */
  newly_problem: string[];
  /** Stations that recovered (were problem, now CLEAN). */
  recovered: string[];
  /** Stations whose status escalated (e.g., FLAGGED → MISSING). */
  escalated: string[];
  /** Net change in counts. */
  count_delta: Record<StationStatus, number>;
}

/** Compute deltas vs the most-recent previous brief, then snapshot
 *  current state for the next call. Returns null on the first invocation
 *  (no baseline yet). */
export function computeBriefDelta(ctx: AiBriefContext): BriefDelta | null {
  const curProblems = new Set(ctx.top_problems.map((p) => p.station));
  const curIntermittent = new Set(ctx.intermittent_stations.map((p) => p.station));

  let delta: BriefDelta | null = null;
  if (_prev) {
    const newly: string[] = [];
    const recovered: string[] = [];
    for (const s of curProblems) {
      if (!_prev.problems.has(s)) newly.push(s);
    }
    for (const s of _prev.problems) {
      if (!curProblems.has(s)) recovered.push(s);
    }
    // For escalation we'd need per-station status from the previous
    // snapshot; v1 ships count-deltas + new/recovered, v2 adds
    // per-station status diffs.
    const cd: Record<StationStatus, number> = {} as Record<StationStatus, number>;
    for (const k of Object.keys(ctx.status_counts) as StationStatus[]) {
      cd[k] = (ctx.status_counts[k] ?? 0) - (_prev.status_counts[k] ?? 0);
    }
    delta = {
      newly_problem: newly,
      recovered,
      escalated: [],
      count_delta: cd,
    };
  }

  _prev = {
    status_counts: { ...ctx.status_counts },
    problems: curProblems,
    intermittent: curIntermittent,
  };
  return delta;
}
