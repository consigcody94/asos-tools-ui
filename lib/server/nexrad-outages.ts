/** NEXRAD radar outage status.
 *
 *  weather.gov/nl2/NEXRADView is the public dashboard. The page renders
 *  client-side using a JSON feed; we fetch the same JSON directly. The
 *  NWS hasn't documented this endpoint formally so the response shape
 *  may evolve — the parser is defensive and falls back to whatever
 *  fields exist.
 */

import { fetchJson } from "./fetcher";

export interface NexradStatus {
  station: string;       // 4-letter ICAO, e.g. "KDIX"
  state: string;
  status: "UP" | "DOWN" | "DEGRADED" | "UNKNOWN";
  reason: string | null;
  since: string | null;
}

interface UpstreamRow {
  ICAO?: string;
  ID?: string;
  STATE?: string;
  Status?: string;
  STATUS?: string;
  Reason?: string;
  REASON?: string;
  Since?: string;
  StartTime?: string;
  [k: string]: unknown;
}

const SOURCE = "https://www.weather.gov/source/nexrad/Outages.json";
const TTL_MS = 15 * 60 * 1000;

let _cache: { at: number; rows: NexradStatus[] } | null = null;

export async function nexradOutages(): Promise<NexradStatus[]> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  try {
    const data = await fetchJson<UpstreamRow[] | { features?: UpstreamRow[] }>(SOURCE, {
      timeoutMs: 15_000,
    });
    const raw = Array.isArray(data) ? data : (data?.features ?? []);
    const rows = raw.map((r): NexradStatus => ({
      station: String(r.ICAO ?? r.ID ?? "").toUpperCase(),
      state: String(r.STATE ?? "").toUpperCase(),
      status: classify(String(r.Status ?? r.STATUS ?? "")),
      reason: (r.Reason ?? r.REASON) as string | null ?? null,
      since: parseDate(r.Since ?? r.StartTime),
    })).filter((r) => r.station);
    _cache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn("[nexrad] fetch failed:", (err as Error).message);
    return _cache?.rows ?? [];
  }
}

function classify(s: string): NexradStatus["status"] {
  const up = s.toLowerCase();
  if (up.includes("out") || up.includes("down")) return "DOWN";
  if (up.includes("degrad") || up.includes("partial")) return "DEGRADED";
  if (up.includes("up") || up.includes("ops") || up.includes("normal")) return "UP";
  return "UNKNOWN";
}

function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
