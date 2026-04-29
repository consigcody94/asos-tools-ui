import { NextResponse } from "next/server";
import { upperAirStatuses } from "@/lib/server/upper-air";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await upperAirStatuses();
  return NextResponse.json({
    source: "nco.ncep.noaa.gov/status/data/thanks/?loc=usa",
    count: rows.length,
    rows,
  });
}
