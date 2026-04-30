/** GET /api/health — network-wide health snapshot.
 *  Compatible with the shape the HF Space emits so existing clients work.
 *
 *  Also exposes the build identifier so an operator (or a /loop in a
 *  monitor) can see at a glance whether the running process matches
 *  the latest commit on origin/main. We hit a torn-build incident
 *  where the SSR'd HTML referenced static chunks that didn't exist on
 *  disk; surfacing build_id makes that 30 s to diagnose instead of 5
 *  min of staring at HTML source.
 */

import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getScan } from "@/lib/server/scan-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read .next/BUILD_ID and the puller-stamped GIT_SHA once at module
// import. Next writes BUILD_ID to a stable path inside the build
// output; if it's missing the build is torn and the process should be
// restarted (puller does this on its next tick now). GIT_SHA is
// stamped by the puller right after `git reset --hard` so /api/health
// can prove which commit is actually running — no more guessing.
let _buildId: string | null = null;
let _gitSha: string | null = null;
try {
  _buildId = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
} catch { /* torn build */ }
try {
  _gitSha = readFileSync(join(process.cwd(), ".next", "GIT_SHA"), "utf8").trim();
} catch { /* puller hasn't stamped it yet */ }

export async function GET() {
  // Non-blocking: returns cached (possibly stale) data immediately and
  // kicks a background refresh when stale/cold. SSR never blocks.
  const scan = getScan();

  if (!scan) {
    return NextResponse.json({
      status: "unknown",
      now: new Date().toISOString(),
      scan_in_flight: false,
      status_counts: {
        CLEAN: 0, FLAGGED: 0, MISSING: 0, OFFLINE: 0,
        INTERMITTENT: 0, RECOVERED: 0, "NO DATA": 0,
      },
      last_tick_at: null,
      last_tick_ok: false,
      last_tick_stations: 0,
      last_tick_flagged: 0,
      last_tick_duration_s: null,
      last_error: "scan not yet initialised",
      data_stale: true,
      upstream_outage: false,
      build_id: _buildId,
      git_sha: _gitSha,
    });
  }

  // "degraded" when actively-problematic states (MISSING, NO DATA) exceed
  // 30% of the network. OFFLINE stations don't count — those are
  // expected/decommissioned, not a health problem.
  const activeTotal = Math.max(1, scan.total - scan.counts.OFFLINE);
  const missingRate = (scan.counts.MISSING + scan.counts["NO DATA"]) / activeTotal;
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
    build_id: _buildId,
    git_sha: _gitSha,
  });
}
