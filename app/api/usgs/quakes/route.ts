import { NextResponse } from "next/server";
import { fetchRecentQuakes, quakesNear, type UsgsFeed } from "@/lib/server/usgs";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const feed = (url.searchParams.get("feed") || "day") as UsgsFeed;
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lon = parseFloat(url.searchParams.get("lon") || "");
  const radius = parseFloat(url.searchParams.get("radius_km") || "300");
  const minMag = parseFloat(url.searchParams.get("min_mag") || "2.5");
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return NextResponse.json(await quakesNear(lat, lon, { radiusKm: radius, minMag, feed }));
  }
  return NextResponse.json(await fetchRecentQuakes(feed));
}
