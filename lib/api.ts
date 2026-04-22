/** O.W.L. backend client — talks to the existing FastAPI sidecar deployed
 *  on the Hugging Face Space (asos-tools).  We deliberately keep all
 *  Python data work (avwx-engine METAR parsing, stumpy anomaly detection,
 *  IEM/AWC/NCEI scrapers, FAA WeatherCams reverse-engineering) on the
 *  Python side and consume it as REST from this Next.js front-end.
 *
 *  Default base = the public HF Space.  Override per-environment with
 *  `OWL_API_BASE` in Vercel env vars to point at staging / a fork / etc.
 */

const DEFAULT_BASE = "https://consgicody-asos-tools.hf.space";
export const OWL_API_BASE = (
  process.env.OWL_API_BASE ||
  process.env.NEXT_PUBLIC_OWL_API_BASE ||
  DEFAULT_BASE
).replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Network-wide health snapshot returned by `/api/health`. */
export interface HealthSnapshot {
  status: "ok" | "degraded" | "unknown";
  now?: string;
  scan_in_flight?: boolean;
  status_counts?: Record<string, number>;
  next_scan_iso?: string | null;
  built_at?: string;
  last_tick_at?: string | null;
  last_tick_ok?: boolean | null;
  last_tick_stations?: number;
  last_tick_flagged?: number;
  last_tick_duration_s?: number | null;
  last_error?: string | null;
  data_stale?: boolean;
  upstream_outage?: boolean;
}

/** A single WeatherCam returned by `/api/webcams/near`. */
export interface WeatherCam {
  id: number;
  site_name: string;
  direction: string;
  distance_nm: number;
  lat: number;
  lon: number;
}

/** Single news item from `/api/news`. */
export interface NewsItem {
  source: string;
  title: string;
  link: string;
  published_iso: string;
  severity?: "info" | "warn" | "crit";
}

// ---------------------------------------------------------------------------
// Low-level fetch wrapper with timeout + structured error.
// ---------------------------------------------------------------------------

async function owlFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number; revalidate?: number } = {},
): Promise<T> {
  const { timeoutMs = 12_000, revalidate, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${OWL_API_BASE}${path}`, {
      ...rest,
      signal: ctrl.signal,
      // Server-component fetches: cache for `revalidate` seconds.
      // Default 60 s, which is fine for the Summary KPI strip.
      next: revalidate !== undefined ? { revalidate } : { revalidate: 60 },
      headers: {
        Accept: "application/json",
        "User-Agent": "owl-ui/1.0 (asos-tools-ui)",
        ...(rest.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(`OWL API ${path} returned ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public client surface — one function per endpoint.
// ---------------------------------------------------------------------------

/** Liveness + scan-state snapshot.  Cheap, called from the ops banner. */
export async function getHealth(): Promise<HealthSnapshot> {
  return owlFetch<HealthSnapshot>("/api/health", { revalidate: 30 });
}

/** Camera lookup near a lat/lon.  Used by the drill panel. */
export async function getCamerasNear(
  lat: number,
  lon: number,
  radiusNm = 25,
  limit = 4,
): Promise<WeatherCam[]> {
  const qs = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius_nm: String(radiusNm),
    limit: String(limit),
  });
  return owlFetch<WeatherCam[]>(`/api/webcams/near?${qs}`, { revalidate: 300 });
}

/** Aggregated NOAA / FAA / NTSB / AWC headlines for the news ticker. */
export async function getNews(limit = 30): Promise<NewsItem[]> {
  return owlFetch<NewsItem[]>(`/api/news?limit=${limit}`, { revalidate: 120 });
}

/** A list of source-of-truth records describing each upstream feed. */
export async function getSources(): Promise<unknown[]> {
  return owlFetch<unknown[]>("/api/sources", { revalidate: 3600 });
}
