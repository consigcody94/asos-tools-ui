/** NOAA Weather Radio transmitter status.
 *
 *  weather.gov/nwr/outages itself loads its table from a JS file at
 *  weather.gov/source/nwr/JS/ccl-data.js — a JavaScript assignment
 *  `var cclData = [{ ... }, ...]` containing every NWR transmitter
 *  with its callsign, lat/lon, frequency, county coverage, and
 *  status. We pull that file and treat the assignment as JSON.
 *
 *  Refreshed every 30 minutes — the upstream is updated by NCO
 *  and doesn't change faster.
 */

import { fetchText } from "./fetcher";

export interface NwrOutage {
  station: string;     // callsign, e.g. "WXL37"
  callsign: string;
  state: string;
  lat: number | null;
  lon: number | null;
  sitename: string | null;
  freq: string | null;
  wfo: string | null;
  status: "UP" | "DOWN" | "DEGRADED";
  reason: string | null;
}

interface UpstreamRow {
  callsign?: string;
  sitestate?: string;
  sitename?: string;
  siteloc?: string;
  freq?: string;
  power?: string;
  wfo?: string;
  status?: string;
  lat?: string;
  lon?: string;
  remarks?: string;
}

const SOURCE = "https://www.weather.gov/source/nwr/JS/ccl-data.js";
const TTL_MS = 30 * 60 * 1000;

let _cache: { at: number; rows: NwrOutage[] } | null = null;
let _inflight: Promise<NwrOutage[]> | null = null;

export async function nwrOutages(): Promise<NwrOutage[]> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const text = await fetchText(SOURCE, { timeoutMs: 15_000 });
      if (!text) return _cache?.rows ?? [];
      const rows = parse(text);
      _cache = { at: Date.now(), rows };
      return rows;
    } catch (err) {
      console.warn("[nwr] fetch failed:", (err as Error).message);
      return _cache?.rows ?? [];
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

function parse(js: string): NwrOutage[] {
  // The file is `var cclData = [...];`. Strip the prefix/suffix and
  // JSON.parse the array literal — the data is plain JSON-shape.
  const start = js.indexOf("[");
  const end = js.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  const json = js.slice(start, end + 1);
  let arr: UpstreamRow[];
  try {
    arr = JSON.parse(json);
  } catch (err) {
    console.warn("[nwr] JSON parse failed:", (err as Error).message);
    return [];
  }
  return arr.map((r): NwrOutage => ({
    station: (r.callsign ?? "").toUpperCase(),
    callsign: (r.callsign ?? "").toUpperCase(),
    state: (r.sitestate ?? "").toUpperCase(),
    lat: numOrNull(r.lat),
    lon: numOrNull(r.lon),
    sitename: r.sitename ?? r.siteloc ?? null,
    freq: r.freq ?? null,
    wfo: r.wfo ?? null,
    status: classify(r.status ?? ""),
    reason: r.remarks ?? null,
  })).filter((r) => r.callsign);
}

function classify(s: string): "UP" | "DOWN" | "DEGRADED" {
  const u = s.toUpperCase();
  if (u === "NORMAL" || u === "UP" || u === "OK") return "UP";
  if (u === "DOWN" || u === "OUT" || u === "OFF") return "DOWN";
  return "DEGRADED";
}

function numOrNull(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
