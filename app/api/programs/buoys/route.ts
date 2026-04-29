import { NextResponse } from "next/server";
import { buoyStatuses } from "@/lib/server/ndbc-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await buoyStatuses();
  // NDBC feed already includes lat/lon per buoy, so no catalog join.
  return NextResponse.json({
    source: "ndbc.noaa.gov/data/latest_obs/latest_obs.txt",
    count: rows.length,
    rows,
  });
}
