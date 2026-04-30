/** GET /api/intermittent — dedicated INTERMITTENT-station endpoint.
 *
 *  Per the SUAD/ASOS team request, INTERMITTENT gets its own section
 *  in the UI separate from the main status counter strip. This
 *  endpoint feeds that section. Includes:
 *    - The full definition (so the UI doesn't have to hardcode it)
 *    - The list of currently-INTERMITTENT stations with details:
 *      * state_log (the rolling state history that triggered the label)
 *      * minutes_since_last_report
 *      * evidence_quality (buckets seen vs expected)
 *      * cross_check (NCEI second opinion when available)
 */

import { NextResponse } from "next/server";
import { getScan, getScanReady } from "@/lib/server/scan-cache";
import { STATUS_DEFINITIONS } from "@/lib/server/status-definitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await getScanReady();
  const scan = getScan();
  if (!scan) {
    return NextResponse.json({
      definition: STATUS_DEFINITIONS.INTERMITTENT,
      stations: [],
      count: 0,
      scanned_at: null,
      warming: true,
    });
  }
  const stations = scan.rows
    .filter((r) => r.status === "INTERMITTENT")
    .map((r) => ({
      station: r.station,
      name: r.name,
      state: r.state,
      lat: r.lat,
      lon: r.lon,
      minutes_since_last_report: r.minutes_since_last_report,
      last_metar: r.last_metar,
      last_valid: r.last_valid,
      probable_reason: r.probable_reason,
      evidence_quality: r.evidence_quality,
      state_log: r.state_log,
      cross_check: r.cross_check,
    }))
    // Sort by longest-silent-bucket-run first so the worst offenders
    // are at the top of the table.
    .sort((a, b) => {
      const ai = a.state_log?.filter((e) => e.state === "MISSING").length ?? 0;
      const bi = b.state_log?.filter((e) => e.state === "MISSING").length ?? 0;
      if (bi !== ai) return bi - ai;
      return (b.minutes_since_last_report ?? 0) - (a.minutes_since_last_report ?? 0);
    });

  return NextResponse.json({
    definition: STATUS_DEFINITIONS.INTERMITTENT,
    stations,
    count: stations.length,
    scanned_at: scan.scanned_at,
  });
}
