/** NDBC buoy network status — latest observations index.
 *
 *  ndbc.noaa.gov/data/latest_obs/latest_obs.txt dumps every active
 *  station's most recent observation as fixed-width text. We use the
 *  gap-since-last-ob as the status signal:
 *    > 6h   → DOWN
 *    > 90m  → DEGRADED
 *    else   → UP
 *  Per-buoy detail is fetched on click via the existing lib/server/ndbc.ts.
 */

import { fetchText } from "./fetcher";

export interface BuoyStatus {
  station: string;
  lat: number;
  lon: number;
  status: "UP" | "DEGRADED" | "DOWN";
  last_ob: string | null;
  minutes_since: number | null;
}

const SOURCE = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt";
const TTL_MS = 15 * 60 * 1000;

let _cache: { at: number; rows: BuoyStatus[] } | null = null;

export async function buoyStatuses(): Promise<BuoyStatus[]> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  try {
    const txt = await fetchText(SOURCE, { timeoutMs: 20_000 });
    if (!txt) return _cache?.rows ?? [];
    const rows = parse(txt);
    _cache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn("[ndbc-status] fetch failed:", (err as Error).message);
    return _cache?.rows ?? [];
  }
}

function parse(text: string): BuoyStatus[] {
  const out: BuoyStatus[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 2; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln || ln.startsWith("#")) continue;
    const parts = ln.trim().split(/\s+/);
    if (parts.length < 8) continue;
    const [station, lat, lon, yy, mm, dd, hh, min] = parts;
    const lt = Number(lat);
    const ln_ = Number(lon);
    if (!Number.isFinite(lt) || !Number.isFinite(ln_)) continue;
    const iso = `${yy}-${pad(mm)}-${pad(dd)}T${pad(hh)}:${pad(min)}:00Z`;
    const t = Date.parse(iso);
    const since = Number.isFinite(t) ? Math.round((Date.now() - t) / 60_000) : null;
    let status: BuoyStatus["status"] = "UP";
    if (since == null) status = "DOWN";
    else if (since > 360) status = "DOWN";
    else if (since > 90) status = "DEGRADED";
    out.push({
      station,
      lat: lt,
      lon: ln_,
      status,
      last_ob: Number.isFinite(t) ? new Date(t).toISOString() : null,
      minutes_since: since,
    });
  }
  return out;
}

function pad(s: string): string {
  return s.padStart(2, "0");
}
