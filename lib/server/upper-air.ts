/** Upper-air RAOB / radiosonde "thanks message" status.
 *
 *  NCO publishes a thanks-message index at
 *    https://www.nco.ncep.noaa.gov/status/data/thanks/?loc=usa
 *  listing each upper-air station's most-recent ingested message
 *  with a timestamp. Stations with stale messages are likely missing
 *  their 00Z/12Z launch.
 *
 *  This is a status feed, not a launch feed — DOWN means we haven't
 *  received a thanks-message for >12h, DEGRADED means we missed the
 *  most recent scheduled launch.
 */

import { fetchText } from "./fetcher";

export interface UpperAirStatus {
  station: string;
  status: "UP" | "DEGRADED" | "DOWN";
  last_seen: string | null;
  hours_since: number | null;
}

const SOURCE = "https://www.nco.ncep.noaa.gov/status/data/thanks/?loc=usa";
const TTL_MS = 60 * 60 * 1000;

let _cache: { at: number; rows: UpperAirStatus[] } | null = null;

export async function upperAirStatuses(): Promise<UpperAirStatus[]> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  try {
    const html = await fetchText(SOURCE, { timeoutMs: 20_000 });
    if (!html) return _cache?.rows ?? [];
    const rows = parse(html);
    _cache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn("[upper-air] fetch failed:", (err as Error).message);
    return _cache?.rows ?? [];
  }
}

/** The thanks page is a simple <pre>-formatted dump:
 *    KOAK  2026-04-29 12Z   ...
 *    KSLC  2026-04-29 00Z   ...
 *  The parser pulls station + most-recent-Z timestamp.
 */
function parse(html: string): UpperAirStatus[] {
  const text = html.replace(/<[^>]+>/g, " ");
  const lines = text.split(/\r?\n/);
  const out: UpperAirStatus[] = [];
  const stationRe = /^\s*([A-Z]{4})\s+(\d{4}-\d{2}-\d{2})\s+(\d{2})Z/;
  for (const ln of lines) {
    const m = ln.match(stationRe);
    if (!m) continue;
    const [, station, date, zhh] = m;
    const iso = `${date}T${zhh}:00:00Z`;
    const t = Date.parse(iso);
    const hours = Number.isFinite(t) ? Math.round((Date.now() - t) / 3600_000) : null;
    let status: UpperAirStatus["status"] = "UP";
    if (hours == null) status = "DOWN";
    else if (hours > 12) status = "DOWN";
    else if (hours > 6) status = "DEGRADED";
    out.push({
      station,
      status,
      last_seen: Number.isFinite(t) ? new Date(t).toISOString() : null,
      hours_since: hours,
    });
  }
  return out;
}
