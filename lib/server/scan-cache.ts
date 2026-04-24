/** In-process scan cache.
 *
 *  The first request after cold-start pays the 10–20 s IEM round trip;
 *  subsequent requests within ``TTL_MS`` return the memoised result.
 *  When the cache is cold or stale, **all** concurrent callers await a
 *  single in-flight scan (``_inflight``) so 50 simultaneous page loads
 *  don't fire 50 identical scans against IEM.
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

export async function getScan(force = false): Promise<ScanState> {
  const fresh = _cache && (Date.now() - Date.parse(_cache.scanned_at) < TTL_MS);
  if (fresh && !force) return _cache!;
  if (_inflight) return _inflight;
  _inflight = runScan().then((s) => { _cache = s; _inflight = null; return s; })
    .catch((e) => { _inflight = null; throw e; });
  return _inflight;
}

export function getCachedScan(): ScanState | null { return _cache; }
