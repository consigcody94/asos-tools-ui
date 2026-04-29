/** Centralised rate-limited fetcher for every upstream source.
 *
 *  Each public data source we consume has a documented or empirical
 *  rate limit. Without a global coordinator, different modules (running
 *  in the same Node process) can easily burst past the per-host limit
 *  and eat 429s. This module keeps one token-bucket per *hostname* so
 *  every `owlFetch()` respects the same budget regardless of caller.
 *
 *  Behaviours:
 *    - Token bucket wait → at-or-below the per-host RPS limit.
 *    - 429 / 5xx → exponential backoff, honouring ``Retry-After``.
 *    - Explicit timeout via AbortController.
 *    - Sensible defaults (User-Agent, timeout, retries).
 *    - Never throws; failed fetches return `{ ok: false, status, text? }`.
 */

export type FetchOk<T> = { ok: true; status: number; data: T; headers: Headers };
export type FetchErr = { ok: false; status: number; error?: string };
export type FetchResult<T> = FetchOk<T> | FetchErr;
import { inc, observeMs } from "./metrics";

const DEFAULT_UA = "owl-ui/2.0 (asos-tools-ui; github.com/consigcody94/asos-tools-ui)";

/** Published / empirical per-host rate limits used by OWL.
 *  Capacity = burst size, refillPerSec = sustained rate.
 *  Entries annotated with their source:
 *    - `doc:`  from published docs
 *    - `emp:`  derived empirically from observed 429 behaviour
 *    - `safe:` conservative guess where no doc exists
 */
interface HostLimit {
  capacity: number;
  refillPerSec: number;
  note: string;
  cooldownOnRateLimitMs?: number;
}

export const HOST_LIMITS: Record<string, HostLimit> = {
  // IEM ASOS CGI documents an IP-based abuse limit but not a numeric quota.
  // Use fewer large station batches and pace them hard; if IEM returns its
  // text-body "slow down" response, cool the whole host for 10 minutes.
  "mesonet.agron.iastate.edu":    { capacity: 1,  refillPerSec: 0.2,  note: "doc: IP-based rate limit; OWL paces to 1 req/5s", cooldownOnRateLimitMs: 10 * 60_000 },

  // NWS documents reasonable rate limits but intentionally does not publish
  // the number. Keep a real UA and stay conservative.
  "api.weather.gov":                { capacity: 2,  refillPerSec: 2,    note: "doc: unpublished reasonable limits; UA required" },

  // AWC: no doc; be gentle to keep PIREP + SIGMET + METAR chunked calls clean.
  "aviationweather.gov":            { capacity: 2,  refillPerSec: 2,    note: "safe: 2 req/s (undocumented)"     },

  // USGS: no hard limit, but "reasonable use" policy.
  "earthquake.usgs.gov":            { capacity: 5,  refillPerSec: 5,    note: "doc: reasonable use, 5 req/s safe"},

  // NHC: single static JSON; one call every few minutes is plenty.
  "www.nhc.noaa.gov":               { capacity: 1,  refillPerSec: 1,    note: "static JSON, 1 req/s"             },

  // NDBC: one .txt per buoy; avoid hammering the realtime2 endpoint.
  "www.ndbc.noaa.gov":              { capacity: 1,  refillPerSec: 1,    note: "1 req/s per station"              },

  // NOAA CO-OPS data + metadata APIs. Keep station metadata cached and pace
  // per-product latest calls to avoid bursty coastal drill-panel loads.
  "api.tidesandcurrents.noaa.gov":  { capacity: 1,  refillPerSec: 0.5,  note: "doc: throttle under load; sleep between calls" },

  // NOAA SWPC — strict: docs say not more than ~1/min per feed.
  "services.swpc.noaa.gov":         { capacity: 1,  refillPerSec: 1/60, note: "doc: ≤1 req/min per feed (strict)"},

  // FAA NOTAM: documented 5 req/s per client.
  "external-api.faa.gov":           { capacity: 5,  refillPerSec: 5,    note: "doc: 5 req/s per client"          },

  // FAA WeatherCams public search API.
  "weathercams.faa.gov":            { capacity: 10, refillPerSec: 10,   note: "CDN-safe, 10 req/s"               },

  // CDN image hosts — server-side we only HEAD these rarely; still cap.
  "radar.weather.gov":              { capacity: 10, refillPerSec: 10,   note: "NWS RIDGE CDN"                    },
  "cdn.star.nesdis.noaa.gov":       { capacity: 10, refillPerSec: 10,   note: "NESDIS CDN"                       },
  "eonet.gsfc.nasa.gov":            { capacity: 2,  refillPerSec: 1,    note: "NASA EONET API"                   },
  "celestrak.org":                  { capacity: 2,  refillPerSec: 1,    note: "CelesTrak GP orbital elements"    },

  // RSS / news feeds. Generally a single call per feed per scan.
  "www.noaa.gov":                   { capacity: 1,  refillPerSec: 1,    note: "RSS; 1 req/s"                     },
  "www.faa.gov":                    { capacity: 1,  refillPerSec: 1,    note: "RSS; 1 req/s"                     },
  "www.ntsb.gov":                   { capacity: 1,  refillPerSec: 1,    note: "RSS; 1 req/s"                     },
  "www.weather.gov":                { capacity: 1,  refillPerSec: 1,    note: "RSS; 1 req/s"                     },
  "water.noaa.gov":                 { capacity: 1,  refillPerSec: 1,    note: "NWPS docs/static metadata"        },
  "api.water.noaa.gov":             { capacity: 2,  refillPerSec: 1,    note: "safe: NWPS API"                   },
  "nomads.ncep.noaa.gov":           { capacity: 1,  refillPerSec: 0.5,  note: "safe: NOMADS GRIB filters"        },
  "mrms.ncep.noaa.gov":             { capacity: 1,  refillPerSec: 0.5,  note: "safe: MRMS HTTP GRIB2"            },
  "mapservices.weather.noaa.gov":   { capacity: 4,  refillPerSec: 2,    note: "NWS OGC/ArcGIS map services"      },
  "madis-data.ncep.noaa.gov":       { capacity: 1,  refillPerSec: 0.5,  note: "MADIS web services"               },
};

const DEFAULT_LIMIT: HostLimit = { capacity: 1, refillPerSec: 1, note: "safe default" };

// ---- Token bucket per host -------------------------------------------------

interface Bucket { tokens: number; last: number; cap: number; refill: number; }
const buckets = new Map<string, Bucket>();
const hostQueues = new Map<string, Promise<void>>();
const hostCooldownUntil = new Map<string, number>();

function getBucket(host: string): Bucket {
  const b = buckets.get(host);
  if (b) return b;
  const cfg = HOST_LIMITS[host] ?? DEFAULT_LIMIT;
  const fresh: Bucket = {
    tokens: cfg.capacity, last: Date.now(),
    cap: cfg.capacity, refill: cfg.refillPerSec,
  };
  buckets.set(host, fresh);
  return fresh;
}

function drip(b: Bucket): void {
  const now = Date.now();
  const elapsed = (now - b.last) / 1000;
  if (elapsed > 0) {
    b.tokens = Math.min(b.cap, b.tokens + elapsed * b.refill);
    b.last = now;
  }
}

async function takeToken(host: string): Promise<void> {
  // Per-host serial queue: keep requests against the same origin from
  // leap-frogging each other and blowing past the token bucket.
  const prev = hostQueues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  hostQueues.set(host, prev.then(() => gate));
  await prev;
  try {
    const cooldownUntil = hostCooldownUntil.get(host) ?? 0;
    const cooldownWaitMs = cooldownUntil - Date.now();
    if (cooldownWaitMs > 0) {
      await new Promise((r) => setTimeout(r, cooldownWaitMs));
    }

    for (;;) {
      const b = getBucket(host);
      drip(b);
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return;
      }
      const wait = Math.max(50, Math.ceil(((1 - b.tokens) / b.refill) * 1000));
      await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    release();
  }
}

export function applyHostCooldown(host: string, ms: number, reason = "rate limit"): void {
  if (!host || ms <= 0) return;
  const until = Date.now() + ms;
  const current = hostCooldownUntil.get(host) ?? 0;
  if (until > current) {
    hostCooldownUntil.set(host, until);
    console.warn(`[owl-fetch] ${host} cooldown ${Math.ceil(ms / 1000)}s (${reason})`);
  }
}

// ---- Public API -----------------------------------------------------------

export interface OwlFetchOpts {
  timeoutMs?: number;
  retries?: number;              // default 3
  acceptStatus?: number[];       // extra 2xx-equivalent statuses (e.g. [404])
  parse?: "json" | "text" | "arrayBuffer";
  headers?: Record<string, string>;
  query?: Record<string, string | string[]>;
  method?: "GET" | "POST" | "HEAD";
  body?: string;
  /** Override the default UA on a per-call basis if a source wants a specific string. */
  userAgent?: string;
}

function buildUrl(url: string, query?: Record<string, string | string[]>): string {
  if (!query || Object.keys(query).length === 0) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) for (const vv of v) u.searchParams.append(k, vv);
    else u.searchParams.set(k, v);
  }
  return u.toString();
}

export async function owlFetch<T = unknown>(
  url: string,
  opts: OwlFetchOpts = {},
): Promise<FetchResult<T>> {
  const {
    timeoutMs = 30_000,
    retries = 3,
    acceptStatus = [],
    parse = "json",
    headers = {},
    query,
    method = "GET",
    body,
    userAgent = DEFAULT_UA,
  } = opts;

  const finalUrl = buildUrl(url, query);
  const host = (() => { try { return new URL(finalUrl).host; } catch { return ""; } })();
  const retryable = new Set([408, 425, 429, 500, 502, 503, 504]);

  for (let attempt = 0; attempt < retries; attempt++) {
    if (host) await takeToken(host);

    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const r = await fetch(finalUrl, {
        method,
        body,
        signal: ctrl.signal,
        headers: {
          "User-Agent": userAgent,
          Accept: parse === "json" ? "application/json" : "text/plain, */*",
          ...headers,
        },
      });

      if (r.ok || acceptStatus.includes(r.status)) {
        let data: unknown;
        try {
          data = parse === "json"        ? await r.json()
               : parse === "arrayBuffer" ? await r.arrayBuffer()
               :                            await r.text();
        } catch {
          data = null;
        }
        observeMs("owl_api_latency", Date.now() - started, { host, status: r.status });
        return { ok: true, status: r.status, data: data as T, headers: r.headers };
      }

      if (!retryable.has(r.status)) {
        inc("owl_api_errors_total", { host, status: r.status });
        observeMs("owl_api_latency", Date.now() - started, { host, status: r.status });
        return { ok: false, status: r.status, error: r.statusText };
      }

      const retryAfterRaw = r.headers.get("retry-after") || "";
      const retryAfter = parseFloat(retryAfterRaw);
      // Cap at 30s — longer than that starves the 60s server-response budget.
      const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(30_000, retryAfter * 1000)
        : Math.min(15_000, 500 * Math.pow(2, attempt));
      const policyCooldown = HOST_LIMITS[host]?.cooldownOnRateLimitMs ?? 0;
      if (r.status === 429 || r.status === 503) {
        applyHostCooldown(host, Math.max(policyCooldown, backoffMs), `${r.status}`);
      }
      console.warn(`[owl-fetch] ${host} ${r.status}; attempt ${attempt + 1}/${retries}; backoff ${backoffMs}ms`);
      inc("owl_api_errors_total", { host, status: r.status });
      observeMs("owl_api_latency", Date.now() - started, { host, status: r.status });
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[owl-fetch] ${host} error on attempt ${attempt + 1}/${retries}: ${msg}`);
      inc("owl_api_errors_total", { host, status: "exception" });
      observeMs("owl_api_latency", Date.now() - started, { host, status: "exception" });
      const backoffMs = Math.min(10_000, 400 * Math.pow(2, attempt));
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0, error: "retries exhausted" };
}

// ---- Convenience JSON / text helpers with sensible defaults ----------------

export async function fetchJson<T = unknown>(url: string, opts: Omit<OwlFetchOpts, "parse"> = {}): Promise<T | null> {
  const r = await owlFetch<T>(url, { ...opts, parse: "json" });
  return r.ok ? r.data : null;
}

export async function fetchText(url: string, opts: Omit<OwlFetchOpts, "parse"> = {}): Promise<string | null> {
  const r = await owlFetch<string>(url, { ...opts, parse: "text" });
  return r.ok ? r.data : null;
}
