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
    // retries=0 + tight timeout so the AI Brief endpoint doesn't get
    // stuck behind AWC backoff cycles. If upstream is slow, return
    // stale (or empty) and let the next 5-min cache-refresh retry.
    const data = await fetchJson<Array<Record<string, unknown>>>(`${BASE}/airsigmet`, {
      query: { format: "json" }, timeoutMs: 6_000, retries: 1,
    });
    const rows = Array.isArray(data) ? data : [];
    _sigmetCache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn("[awc] airsigmet fetch failed:", (err as Error).message);
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

// ---- G-AIRMETs (replaces CONUS text AIRMETs since Jan 2025) ---------------
//
// Per the AWC API spec, G-AIRMETs are the gridded successor to CONUS text
// AIRMETs (which were discontinued in January 2025). They provide better
// time/space precision for turbulence, icing, and IFR advisories. Alaska
// still uses traditional text AIRMETs through the airsigmet endpoint.

let _gairmetCache: { at: number; rows: Array<Record<string, unknown>> } | null = null;
const GAIRMET_TTL_MS = 5 * 60 * 1000;

export async function fetchGAirmets(): Promise<Array<Record<string, unknown>>> {
  if (_gairmetCache && Date.now() - _gairmetCache.at < GAIRMET_TTL_MS) {
    return _gairmetCache.rows;
  }
  try {
    const data = await fetchJson<Array<Record<string, unknown>>>(`${BASE}/gairmet`, {
      query: { format: "json" }, timeoutMs: 8_000, retries: 1,
    });
    const rows = Array.isArray(data) ? data : [];
    _gairmetCache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn("[awc] gairmet fetch failed:", (err as Error).message);
    return _gairmetCache?.rows ?? [];
  }
}

// ---- Center Weather Advisories --------------------------------------------
// Regional aviation advisories issued by Center Weather Service Units
// (CWSUs) for ARTCCs. Lighter-weight than SIGMETs; fast to fetch.

let _cwaCache: { at: number; rows: Array<Record<string, unknown>> } | null = null;
const CWA_TTL_MS = 5 * 60 * 1000;

export async function fetchCwa(): Promise<Array<Record<string, unknown>>> {
  if (_cwaCache && Date.now() - _cwaCache.at < CWA_TTL_MS) {
    return _cwaCache.rows;
  }
  try {
    const data = await fetchJson<Array<Record<string, unknown>>>(`${BASE}/cwa`, {
      query: { format: "json" }, timeoutMs: 8_000, retries: 1,
    });
    const rows = Array.isArray(data) ? data : [];
    _cwaCache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn("[awc] cwa fetch failed:", (err as Error).message);
    return _cwaCache?.rows ?? [];
  }
}
