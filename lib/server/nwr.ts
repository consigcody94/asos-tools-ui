/** NOAA Weather Radio outage scraper.
 *
 *  weather.gov/nwr/outages publishes a public HTML table of currently-
 *  out NWR transmitter sites. We extract station id + frequency +
 *  reason + outage start time. Refreshed every 30 minutes per the
 *  spec — the upstream is updated by NCO and doesn't change faster.
 */

import { fetchText } from "./fetcher";

export interface NwrOutage {
  station: string;     // e.g. "KEC79"
  callsign: string;
  state: string;
  freq: string | null;
  start: string | null; // ISO if parseable
  reason: string | null;
  status: "DOWN";       // by definition: this list is "currently down"
}

const SOURCE = "https://www.weather.gov/nwr/outages";
const TTL_MS = 30 * 60 * 1000;

let _cache: { at: number; rows: NwrOutage[] } | null = null;
let _inflight: Promise<NwrOutage[]> | null = null;

export async function nwrOutages(): Promise<NwrOutage[]> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const html = await fetchText(SOURCE, { timeoutMs: 15_000 });
      if (!html) return _cache?.rows ?? [];
      const rows = parseOutageTable(html);
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

/** Parse the <table> rows in the outages page. The page is fairly
 *  stable HTML; tags include <tr><td>...</td></tr> with cells in a
 *  consistent order. We do regex-only extraction (no DOM lib) to keep
 *  the dependency footprint small. */
function parseOutageTable(html: string): NwrOutage[] {
  const out: NwrOutage[] = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  for (const tableMatch of html.matchAll(tableRe)) {
    const tbody = tableMatch[1];
    let isHeader = true;
    for (const rowMatch of tbody.matchAll(rowRe)) {
      const row = rowMatch[1];
      const cells: string[] = [];
      for (const cellMatch of row.matchAll(cellRe)) {
        cells.push(stripTags(cellMatch[1]).trim());
      }
      if (cells.length < 4) continue;
      if (isHeader) { isHeader = false; continue; }
      const [callsign, state, freq, started, reason] = cells;
      if (!callsign) continue;
      out.push({
        station: callsign.toUpperCase(),
        callsign: callsign.toUpperCase(),
        state: (state ?? "").toUpperCase(),
        freq: freq || null,
        start: parseDate(started),
        reason: reason || null,
        status: "DOWN",
      });
    }
  }
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
