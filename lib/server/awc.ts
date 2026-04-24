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

export async function fetchAirSigmet(): Promise<Array<Record<string, unknown>>> {
  const data = await fetchJson<Array<Record<string, unknown>>>(`${BASE}/airsigmet`, {
    query: { format: "json" }, timeoutMs: 15_000,
  });
  return Array.isArray(data) ? data : [];
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
