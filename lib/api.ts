/** OWL API client — Next.js self-hosted backend.
 *
 *  This repo used to proxy to a HuggingFace Space; we've since ported
 *  every data source natively into `lib/server/*` with matching API
 *  routes under `app/api/*`. All fetches here hit the same origin.
 */

const SAME_ORIGIN = "";

/** On the server we can't use relative URLs; read the base from env or the
 *  request's origin via middleware. For server-components we prefer
 *  ``NEXT_PUBLIC_SITE_URL`` when set; otherwise we fall back to localhost.
 *  Keeping this branch simple — the app is single-origin. */
function base(): string {
  if (typeof window !== "undefined") return SAME_ORIGIN;
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

/** Retained for back-compat with components that import this symbol. */
export const OWL_API_BASE = base();

// -- Shared shapes -----------------------------------------------------------

export interface HealthSnapshot {
  status: "ok" | "degraded" | "unknown";
  now?: string;
  scan_in_flight?: boolean;
  status_counts?: Record<string, number>;
  last_tick_at?: string | null;
  last_tick_ok?: boolean | null;
  last_tick_stations?: number;
  last_tick_flagged?: number;
  last_tick_duration_s?: number | null;
  last_error?: string | null;
  data_stale?: boolean;
  upstream_outage?: boolean;
}

export interface ScanRowClient {
  station: string;
  name?: string;
  state?: string;
  lat?: number;
  lon?: number;
  status: string;
  minutes_since_last_report: number | null;
  last_metar: string | null;
  last_valid: string | null;
  probable_reason: string | null;
}

export interface WeatherCam {
  id: number;
  site_name: string;
  direction: string;
  distance_nm: number;
  lat: number;
  lon: number;
  thumbnail_url?: string;
}

export interface NewsItem {
  source: string;
  title: string;
  link: string;
  published_iso: string;
  severity?: "info" | "warn" | "crit";
}

// -- Fetcher -----------------------------------------------------------------
async function owlFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number; revalidate?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, revalidate, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base()}${path}`, {
      ...rest,
      signal: ctrl.signal,
      next: revalidate !== undefined ? { revalidate } : { revalidate: 60 },
      headers: {
        Accept: "application/json",
        "User-Agent": "owl-ui/2.0",
        ...(rest.headers || {}),
      },
    });
    if (!r.ok) throw new Error(`OWL API ${path} returned ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// -- Endpoints ---------------------------------------------------------------
export const getHealth = () =>
  owlFetch<HealthSnapshot>("/api/health", { revalidate: 30 });

export const getScanResults = () =>
  owlFetch<{ scanned_at: string; duration_ms: number; total: number; rows: ScanRowClient[] }>(
    "/api/scan-results", { revalidate: 30 },
  );

export const getCamerasNear = (lat: number, lon: number, radiusNm = 25, limit = 4) =>
  owlFetch<WeatherCam[]>(
    `/api/webcams/near?lat=${lat}&lon=${lon}&radius_nm=${radiusNm}&limit=${limit}`,
    { revalidate: 600 },
  );

export const getNews = (limit = 30) =>
  owlFetch<NewsItem[]>(`/api/news?limit=${limit}`, { revalidate: 300 });

export const getSources = () =>
  owlFetch<Array<Record<string, unknown>>>("/api/sources", { revalidate: 3600 });

export const getStationHazards = (id: string) =>
  owlFetch<{
    station: { id: string; name: string; lat: number; lon: number; state: string };
    quakes: Array<Record<string, unknown>>;
    storms: Array<Record<string, unknown>>;
    buoy: unknown;
    coops: unknown;
    notams: Record<string, unknown>;
  }>(`/api/station/${encodeURIComponent(id)}/hazards`, { revalidate: 120 });

export const searchStations = (q: string, limit = 20) =>
  owlFetch<Array<{ id: string; name: string; state: string; lat: number; lon: number }>>(
    `/api/stations/search?q=${encodeURIComponent(q)}&limit=${limit}`, { revalidate: 3600 },
  );
