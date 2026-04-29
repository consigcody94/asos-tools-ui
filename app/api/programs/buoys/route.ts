import { NextResponse } from "next/server";
import { buoyStatuses } from "@/lib/server/ndbc-status";

export const runtime = "nodejs";
export const revalidate = 900; // 15 min

export async function GET() {
  const rows = await buoyStatuses();
  return NextResponse.json({ source: "ndbc.noaa.gov/data/latest_obs/latest_obs.txt", count: rows.length, rows });
}
