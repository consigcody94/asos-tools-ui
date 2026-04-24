/** GET /api/webcams/near?lat=...&lon=...&radius_nm=25&limit=4 */

import { NextResponse } from "next/server";
import { camerasNear } from "@/lib/server/webcams";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lon = parseFloat(url.searchParams.get("lon") || "");
  const radius = parseFloat(url.searchParams.get("radius_nm") || "25");
  const limit = parseInt(url.searchParams.get("limit") || "4", 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon required" }, { status: 400 });
  }
  const cams = await camerasNear(lat, lon, radius, limit);
  return NextResponse.json(cams);
}
