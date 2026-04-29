/** GET /api/scan-results — per-station status rows. */

import { NextResponse } from "next/server";
import { getScan, getScanReady } from "@/lib/server/scan-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  // Wait for warm-restore so a fresh-process poll never returns rows:[]
  // (which the frontend interprets as "everything is NO DATA").
  await getScanReady();
  const scan = getScan();
  if (!scan) {
    return NextResponse.json({
      scanned_at: null,
      duration_ms: null,
      total: 0,
      rows: [],
      warming: true,
    });
  }
  let rows = scan.rows;
  if (status) {
    const want = status.toUpperCase();
    rows = rows.filter((r) => r.status === want);
  }
  // Slim the response: the drill panel re-fetches the full METAR text +
  // decoded fields from /api/station/[id]/metar on click, so shipping
  // raw METAR strings to every client every poll is pure waste. Saves
  // ~30 KB / scan over the wire and keeps the SSE pulse small enough
  // for slow connections.
  const includeFull = url.searchParams.get("full") === "1";
  const projected = includeFull
    ? rows
    : rows.map((r) => ({
        station: r.station,
        status: r.status,
        minutes_since_last_report: r.minutes_since_last_report ?? null,
      }));
  return NextResponse.json({
    scanned_at: scan.scanned_at,
    duration_ms: scan.duration_ms,
    total: projected.length,
    rows: projected,
  });
}
