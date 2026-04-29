/** In-process scan cache with stale-while-revalidate semantics.
 *
 *  Policy:
 *    - Fresh cache (<TTL_MS old) → return immediately.
 *    - Stale cache               → return stale + kick background refresh.
 *    - Cold (no cache ever)      → return null + kick background refresh;
 *                                   the caller renders a "warming" state
 *                                   so SSR never blocks on the first hit.
 *
 *  Crucially: a 100 s scan on a cold replica used to block `/` server-
 *  render, which in turn starved the ACA readiness probe and marked the
 *  replica Unavailable. With stale-while-revalidate, first page-load
 *  returns in <100 ms, the scan lands in the background, and subsequent
 *  requests get real data.
 *
 *  A single in-flight scan is serialised via `_inflight` so concurrent
 *  callers never fire duplicate IEM requests.
 */

import { scanNetwork, scanSummary } from "./iem";
import { observeMs, setGauge } from "./metrics";
import { redisGet, redisSet } from "./redis-cache";
import type { ScanRow, StationStatus } from "./types";

interface ScanState {
  rows: ScanRow[];
  counts: Record<StationStatus, number>;
  total: number;
  scanned_at: string;     // ISO
  duration_ms: number;
}

// A full scan touches IEM's IP-limited ASOS endpoint. Keep cached scans for
// 15 minutes so page traffic never translates into repeated upstream sweeps.
const TTL_MS = 15 * 60 * 1000;

// Redis key + TTL for warm-restore. ASOS METARs only update hourly so a
// 24h TTL keeps last-known statuses across restarts without serving
// stale-forever data; if we go a full day without a successful scan the
// platform is in a bigger crisis than fresh "NO DATA" labels.
const REDIS_KEY = "owl:scan:last";
const REDIS_TTL = 24 * 3600;

let _cache: ScanState | null = null;
let _inflight: Promise<ScanState> | null = null;
// `_lastKnown` is the per-station merge buffer: every scan updates only
// the rows it reports, preserving last-known status for stations the
// scan didn't return (e.g., AWC fallback returning a partial subset).
const _lastKnown: Map<string, ScanRow> = new Map();
let _lastKnownLoaded = false;
// Generation counter prevents an in-flight scan from overwriting a
// post-flush cache: a scan kicked before the flush bumps the counter
// will see its generation is stale and discard its result.
let _generation = 0;

async function runScan(): Promise<ScanState> {
  const t0 = Date.now();
  const freshRows = await scanNetwork(4);

  // Merge fresh rows into the per-station last-known buffer. This is
  // the core "no NO_DATA after restart" mechanism: if the new scan
  // didn't report station KXYZ but we've seen KXYZ before, keep its
  // previous row — operators only care that the status is correct
  // *the last time it was observable*.
  for (const r of freshRows) {
    if (r.station) _lastKnown.set(r.station, r);
  }
  const mergedRows = Array.from(_lastKnown.values());
  const { counts, total } = scanSummary(mergedRows);
  const duration = Date.now() - t0;
  observeMs("owl_scan_duration", duration);
  setGauge("owl_scan_rows", total);
  const state: ScanState = {
    rows: mergedRows,
    counts,
    total,
    scanned_at: new Date().toISOString(),
    duration_ms: duration,
  };
  // Persist to Redis so a process restart warm-restores last-known.
  // Non-blocking: never let a Redis hiccup fail the scan.
  redisSet(REDIS_KEY, JSON.stringify(state), REDIS_TTL).catch(() => undefined);
  return state;
}

async function loadFromRedis(): Promise<void> {
  if (_lastKnownLoaded) return;
  _lastKnownLoaded = true;
  try {
    const raw = await redisGet(REDIS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as ScanState;
    if (Array.isArray(parsed.rows)) {
      for (const r of parsed.rows) {
        if (r.station) _lastKnown.set(r.station, r);
      }
      if (!_cache) _cache = parsed;
      console.log(`[scan] warm-restored ${parsed.rows.length} stations from Redis`);
    }
  } catch (err) {
    console.warn("[scan] redis warm-restore failed:", (err as Error).message);
  }
}

function kickBackgroundRefresh(): void {
  if (_inflight) return;
  const myGeneration = _generation;
  _inflight = (async () => {
    await loadFromRedis();
    return runScan();
  })()
    .then((s) => {
      // Discard if a flush bumped the generation mid-flight.
      if (myGeneration !== _generation) return _cache ?? s;
      _cache = s;
      return s;
    })
    .catch((e) => {
      console.warn("[scan] background refresh failed; keeping previous cache:", e);
      if (_cache) return _cache;
      return {
        rows: [],
        counts: {
          CLEAN: 0, FLAGGED: 0, MISSING: 0, OFFLINE: 0,
          INTERMITTENT: 0, RECOVERED: 0, "NO DATA": 0,
        },
        total: 0,
        scanned_at: new Date().toISOString(),
        duration_ms: 0,
      };
    })
    .finally(() => { _inflight = null; });
  // Explicitly don't await.
}

/** Return the current scan state, kicking a background refresh when stale
 *  or cold. The caller never awaits a cold scan. */
export function getScan(): ScanState | null {
  const fresh = _cache && (Date.now() - Date.parse(_cache.scanned_at) < TTL_MS);
  if (!fresh) kickBackgroundRefresh();
  return _cache;
}

/** Awaitable variant: lets a caller block until the in-process cache is
 *  hydrated from Redis warm-restore, so the very first response after a
 *  process start doesn't ship an empty rows[] that re-paints all 918
 *  stations to NO DATA before the next tick arrives.
 *
 *  If Redis has nothing or is unavailable, this resolves quickly with
 *  whatever the cache holds (possibly null) — never blocks waiting on
 *  a real scan, which can take 30-60 seconds. */
export async function getScanReady(): Promise<ScanState | null> {
  if (_cache) return _cache;
  await loadFromRedis();
  if (_cache) return _cache;
  // No warm data — kick the background scan so subsequent polls fill in.
  kickBackgroundRefresh();
  return _cache;
}

// Kick warm-restore at module load so the FIRST request a client makes
// has a populated cache. Without this, the first /api/events SSE push
// fires before loadFromRedis completes, ships rows:[], and the frontend
// flashes every station to NO DATA for ~30s until the next tick.
loadFromRedis().catch(() => undefined);

/** Force-await the next scan. Used by the ai-brief endpoint, which
 *  legitimately needs fresh data regardless of cache age. */
export async function getScanFresh(): Promise<ScanState> {
  if (_inflight) return _inflight;
  // If we already have a fresh cache, return it immediately rather
  // than kicking another scan and awaiting an `_inflight` that may be
  // null again because runScan resolved synchronously enough that the
  // .finally cleared it.
  const fresh = _cache && (Date.now() - Date.parse(_cache.scanned_at) < TTL_MS);
  if (fresh) return _cache!;
  kickBackgroundRefresh();
  if (_inflight) return _inflight;
  // Last-resort: synthesize an empty result so callers always get a
  // ScanState (the alternative was a non-null assertion on _inflight!
  // which TypeScript happily passes through but races at runtime).
  return _cache ?? {
    rows: [],
    counts: { CLEAN: 0, FLAGGED: 0, MISSING: 0, OFFLINE: 0, INTERMITTENT: 0, RECOVERED: 0, "NO DATA": 0 },
    total: 0,
    scanned_at: new Date().toISOString(),
    duration_ms: 0,
  };
}

export function getCachedScan(): ScanState | null { return _cache; }

export function flushScanCache(): void {
  _cache = null;
  _inflight = null;
  _generation++;          // any in-flight scan now sees a stale generation
  // Note: _lastKnown intentionally retained — flushing the cache is for
  // forcing a fresh scan to re-classify with current data, not for
  // erasing the last-known buffer the operator UI relies on.
}
