/** GET /api/nifc/fires — currently-active wildfires. */

import { NextResponse } from "next/server";
import { fetchActiveFires, fireNear } from "@/lib/server/nifc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  const radiusKm = Number(url.searchParams.get("radiusKm") ?? "100");

  if (lat && lon) {
    const rows = await fireNear(Number(lat), Number(lon), radiusKm);
    return NextResponse.json({ fires: rows, count: rows.length });
  }
  const rows = await fetchActiveFires();
  return NextResponse.json({
    fires: rows,
    count: rows.length,
    fetched_at: new Date().toISOString(),
  });
}
