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
import type { ScanRow, StationStatus } from "./types";

interface ScanState {
  rows: ScanRow[];
  counts: Record<StationStatus, number>;
  total: number;
  scanned_at: string;     // ISO
  duration_ms: number;
}

const TTL_MS = 5 * 60 * 1000;  // 5 minutes — matches the upstream 5-min cron

let _cache: ScanState | null = null;
let _inflight: Promise<ScanState> | null = null;

async function runScan(): Promise<ScanState> {
  const t0 = Date.now();
  const rows = await scanNetwork(4);
  const { counts, total } = scanSummary(rows);
  return {
    rows, counts, total,
    scanned_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
  };
}

function kickBackgroundRefresh(): void {
  if (_inflight) return;
  _inflight = runScan()
    .then((s) => { _cache = s; return s; })
    .catch((e) => { console.warn("[scan] background refresh failed:", e); throw e; })
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
