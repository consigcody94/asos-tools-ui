/** Aviation Weather Center (AWC) client.
 *  aviationweather.gov/api/data — zero auth, JSON for most endpoints,
 *  text/plain for fcstdisc (AFD).
 *
 *  All requests go through the shared rate-limited owlFetch so the
 *  per-host bucket at aviationweather.gov (2 req/s) is respected across
 *  callers (SIGMET + METAR + TAF + PIREP + AFD sub-endpoints).
 */

import { fetchJson, fetchText } from "./fetcher";

const BASE = process.env.AWC_API_BASE || "https://aviationweather.gov/api/data";

export async function fetchMetars(ids: string[]): Promise<Array<Record<string, unknown>>> {
  if (!ids.length) return [];
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const data = await fetchJson<Array<Record<string, unknown>>>(`${BASE}/metar`, {
      query: { ids: chunk.join(","), format: "json", taf: "false" },
      timeoutMs: 15_000,
    });
    if (Array.isArray(data)) out.push(...data);
  }
  return out;
}

export async function fetchTaf(id: string): Promise<Array<Record<string, unknown>>> {
  const data = await fetchJson<Array<Record<string, unknown>>>(`${BASE}/taf`, {
    query: { ids: id, format: "json" }, timeoutMs: 15_000,
  });
  return Array.isArray(data) ? data : [];
}

// Cached AIR/SIGMETs. AWC's airsigmet endpoint can take 30+ seconds
// when active weather is heavy, which used to make the AI Brief
// button hang. Cache for 5 minutes so subsequent calls are instant.
let _sigmetCache: { at: number; rows: Array<Record<string, unknown>> } | null = null;
const SIGMET_TTL_MS = 5 * 60 * 1000;

export async function fetchAirSigmet(): Promise<Array<Record<string, unknown>>> {
  if (_sigmetCache && Date.now() - _sigmetCache.at < SIGMET_TTL_MS) {
    return _sigmetCache.rows;
  }
  try {
    const data = await fetchJson<Array<Record<string, unknown>>>(`${BASE}/airsigmet`, {
      query: { format: "json" }, timeoutMs: 8_000,
    });
    const rows = Array.isArray(data) ? data : [];
    _sigmetCache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn("[awc] airsigmet fetch failed:", (err as Error).message);
    // Serve stale rather than empty when upstream is flaky.
    return _sigmetCache?.rows ?? [];
  }
}

export async function fetchPireps(hours = 2): Promise<Array<Record<string, unknown>>> {
  const data = await fetchJson<Array<Record<string, unknown>>>(`${BASE}/pirep`, {
    query: { format: "json", age: String(hours) }, timeoutMs: 15_000,
  });
  return Array.isArray(data) ? data : [];
}

/** Area Forecast Discussion. CWA is auto-promoted from 3-letter → 4-letter. */
export async function fetchAfd(cwa: string): Promise<{ cwa: string; text: string } | null> {
  if (!cwa) return null;
  let id = cwa.trim().toUpperCase();
  if (id.length === 3) id = "K" + id;
  const txt = await fetchText(`${BASE}/fcstdisc`, {
    query: { cwa: id, format: "raw" }, timeoutMs: 15_000,
  });
  if (!txt) return null;
  if (txt.startsWith('{"status":"error"')) return null;
  return { cwa: id, text: txt };
}
