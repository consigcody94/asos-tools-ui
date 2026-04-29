import { NextResponse } from "next/server";
import { upperAirStatuses } from "@/lib/server/upper-air";

export const runtime = "nodejs";
export const revalidate = 3600; // 1 h

export async function GET() {
  const rows = await upperAirStatuses();
  return NextResponse.json({ source: "nco.ncep.noaa.gov/status/data/thanks", count: rows.length, rows });
}
