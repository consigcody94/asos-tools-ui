/** GET /api/nwps?lat=&lon=&radiusKm= — nearest NWPS gauge + flood data.
 *
 *  Backed by lib/server/nwps.ts. Drill panel calls this for inland
 *  ASOS stations to surface "is the nearest river flooding right now?"
 *  context — one of the most operationally relevant signals for
 *  ASOS-network impact prediction during a storm.
 */

import { NextResponse } from "next/server";
import { nearestNwpsGauge } from "@/lib/server/nwps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat") ?? "");
  const lon = Number(url.searchParams.get("lon") ?? "");
  const radiusKm = Number(url.searchParams.get("radiusKm") ?? "75");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { error: "lat and lon query params required (numeric)" },
      { status: 400 },
    );
  }
  const data = await nearestNwpsGauge(lat, lon, radiusKm);
  return NextResponse.json({ gauge: data, fetched_at: new Date().toISOString() });
}
