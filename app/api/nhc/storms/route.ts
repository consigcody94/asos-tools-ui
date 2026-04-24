import { NextResponse } from "next/server";
import { fetchActiveStorms, stormsNear } from "@/lib/server/nhc";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lon = parseFloat(url.searchParams.get("lon") || "");
  const radius = parseFloat(url.searchParams.get("radius_km") || "500");
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return NextResponse.json(await stormsNear(lat, lon, radius));
  }
  return NextResponse.json(await fetchActiveStorms());
}
