/** GET /api/health — network-wide health snapshot.
 *  Compatible with the shape the HF Space emits so existing clients work.
 */

import { NextResponse } from "next/server";
import { getScan, getCachedScan } from "@/lib/server/scan-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Use cached if fresh; otherwise kick off a scan (caller awaits).
  let scan;
  try {
    scan = await getScan();
  } catch {
    scan = getCachedScan();
  }

  if (!scan) {
    return NextResponse.json({
      status: "unknown",
      now: new Date().toISOString(),
      scan_in_flight: false,
      status_counts: {
        CLEAN: 0, FLAGGED: 0, MISSING: 0, INTERMITTENT: 0, RECOVERED: 0, "NO DATA": 0,
      },
      last_tick_at: null,
      last_tick_ok: false,
      last_tick_stations: 0,
      last_tick_flagged: 0,
      last_tick_duration_s: null,
      last_error: "scan not yet initialised",
      data_stale: true,
      upstream_outage: false,
    });
  }

  const missingRate = (scan.counts.MISSING + scan.counts["NO DATA"]) / Math.max(1, scan.total);
  const status = missingRate > 0.30 ? "degraded" : "ok";

  return NextResponse.json({
    status,
    now: new Date().toISOString(),
    scan_in_flight: false,
    status_counts: scan.counts,
    last_tick_at: scan.scanned_at,
    last_tick_ok: true,
    last_tick_stations: scan.total,
    last_tick_flagged: scan.counts.FLAGGED,
    last_tick_duration_s: scan.duration_ms / 1000,
    last_error: null,
    data_stale: false,
    upstream_outage: false,
  });
}
