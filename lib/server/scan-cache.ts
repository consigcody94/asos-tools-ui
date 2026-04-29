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

let _cache: ScanState | null = null;
let _inflight: Promise<ScanState> | null = null;

async function runScan(): Promise<ScanState> {
  const t0 = Date.now();
  const rows = await scanNetwork(4);
  const { counts, total } = scanSummary(rows);
  const duration = Date.now() - t0;
  observeMs("owl_scan_duration", duration);
  setGauge("owl_scan_rows", total);
  return {
    rows, counts, total,
    scanned_at: new Date().toISOString(),
    duration_ms: duration,
  };
}

function kickBackgroundRefresh(): void {
  if (_inflight) return;
  _inflight = runScan()
    .then((s) => { _cache = s; return s; })
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

/** Force-await the next scan. Used by the ai-brief endpoint, which
 *  legitimately needs fresh data regardless of cache age. */
export async function getScanFresh(): Promise<ScanState> {
  if (_inflight) return _inflight;
  kickBackgroundRefresh();
  return _inflight!;
}

export function getCachedScan(): ScanState | null { return _cache; }

export function flushScanCache(): void {
  _cache = null;
  _inflight = null;
}
