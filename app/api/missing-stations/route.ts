/** GET /api/missing-stations — auto-exit MISSING buckets.
 *
 *  Splits the live scan rows into two buckets:
 *    - over_3_days  : minutes_since_last_report > 4320 (3d) AND <= 10080 (1wk)
 *    - over_1_week  : minutes_since_last_report > 10080 (1wk)
 *
 *  Auto-exit: stations re-enter the active rotation the moment IEM sees
 *  a fresh METAR — the field is computed from the live scan cache so
 *  there's nothing to maintain manually. A station that was in
 *  over_1_week yesterday and reports today simply drops out of both
 *  lists.
 *
 *  This endpoint is what the Admin tab's "Missing > 3 days" and
 *  "Missing > 1 week" panels poll.
 */

import { NextResponse } from "next/server";
import { getScan, getScanReady } from "@/lib/server/scan-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THREE_DAYS_MIN = 3 * 24 * 60;   // 4320
const ONE_WEEK_MIN   = 7 * 24 * 60;   // 10080

export async function GET() {
  await getScanReady();
  const scan = getScan();
  if (!scan) {
    return NextResponse.json({
      scanned_at: null,
      over_3_days: [],
      over_1_week: [],
      counts: { over_3_days: 0, over_1_week: 0 },
      warming: true,
    });
  }

  const over3 = [];
  const over7 = [];

  for (const row of scan.rows) {
    const m = row.minutes_since_last_report;
    if (m == null) continue;            // never seen → handled by OFFLINE bucket
    if (m <= THREE_DAYS_MIN) continue;  // recovered or actively reporting
    const slim = {
      station: row.station,
      name: row.name,
      state: row.state,
      lat: row.lat,
      lon: row.lon,
      status: row.status,
      minutes_since_last_report: m,
      last_valid: row.last_valid,
      probable_reason: row.probable_reason,
      cross_check: row.cross_check,
    };
    if (m > ONE_WEEK_MIN) over7.push(slim);
    else over3.push(slim);
  }

  // Sort each list newest-silent-last so operators see the longest-out
  // stations first.
  over3.sort((a, b) =>
    (b.minutes_since_last_report ?? 0) - (a.minutes_since_last_report ?? 0));
  over7.sort((a, b) =>
    (b.minutes_since_last_report ?? 0) - (a.minutes_since_last_report ?? 0));

  return NextResponse.json({
    scanned_at: scan.scanned_at,
    over_3_days: over3,
    over_1_week: over7,
    counts: { over_3_days: over3.length, over_1_week: over7.length },
  });
}
