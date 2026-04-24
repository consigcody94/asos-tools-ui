/** Aviation Weather Center (AWC) client.
 *  aviationweather.gov/api/data — zero auth, JSON for most endpoints,
 *  text/plain for fcstdisc (AFD).
 */

const BASE = process.env.AWC_API_BASE || "https://aviationweather.gov/api/data";
const UA = "owl-ui/2.0 (asos-tools-ui)";

async function getJson<T = unknown>(path: string, params: Record<string, string>): Promise<T | null> {
  const url = `${BASE.replace(/\/+$/, "")}/${path}?${new URLSearchParams(params).toString()}`;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 120 },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function getText(path: string, params: Record<string, string>): Promise<string | null> {
  const url = `${BASE.replace(/\/+$/, "")}/${path}?${new URLSearchParams(params).toString()}`;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": UA, Accept: "text/plain" },
      next: { revalidate: 600 },
    });
    if (!r.ok) return null;
    const t = (await r.text()).trim();
    if (!t || t.startsWith('{"status":"error"')) return null;
    return t;
  } catch {
    return null;
  }
}

export async function fetchMetars(ids: string[]): Promise<Array<Record<string, unknown>>> {
  if (!ids.length) return [];
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const data = await getJson<Array<Record<string, unknown>>>("metar", {
      ids: chunk.join(","), format: "json", taf: "false",
    });
    if (Array.isArray(data)) out.push(...data);
  }
  return out;
}

export async function fetchTaf(id: string): Promise<Array<Record<string, unknown>>> {
  const data = await getJson<Array<Record<string, unknown>>>("taf", {
    ids: id, format: "json",
  });
  return Array.isArray(data) ? data : [];
}

export async function fetchAirSigmet(): Promise<Array<Record<string, unknown>>> {
  const data = await getJson<Array<Record<string, unknown>>>("airsigmet", {
    format: "json",
  });
  return Array.isArray(data) ? data : [];
}

export async function fetchPireps(hours = 2): Promise<Array<Record<string, unknown>>> {
  const data = await getJson<Array<Record<string, unknown>>>("pirep", {
    format: "json", age: String(hours),
  });
  return Array.isArray(data) ? data : [];
}

/** Area Forecast Discussion. CWA is auto-promoted from 3-letter → 4-letter. */
export async function fetchAfd(cwa: string): Promise<{ cwa: string; text: string } | null> {
  if (!cwa) return null;
  let id = cwa.trim().toUpperCase();
  if (id.length === 3) id = "K" + id;
  const txt = await getText("fcstdisc", { cwa: id, format: "raw" });
  return txt ? { cwa: id, text: txt } : null;
}
