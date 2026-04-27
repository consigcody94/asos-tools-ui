/** GET /api/station/[id]/imagery — overhead-imagery archive for one station.
 *
 *  Bundles NASA GIBS snapshots, Element84 STAC Sentinel-2 + Landsat
 *  scenes, and external viewer deep-links (Worldview, Copernicus,
 *  Zoom Earth, EOSDA, Sentinel Hub) into a single JSON payload that
 *  the drill panel renders as an "Overhead Imagery" tile row.
 */

import { NextResponse } from "next/server";
import { aomcById } from "@/lib/server/stations";
import { stationImagery } from "@/lib/server/satellite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const url = new URL(req.url);
  const { id } = await ctx.params;
  const station = aomcById(id);
  if (!station) {
    return NextResponse.json({ error: `unknown station ${id}` }, { status: 404 });
  }
  const stacLimit = parseInt(url.searchParams.get("limit") || "3", 10);
  const maxCloudPct = parseFloat(url.searchParams.get("max_cloud") || "30");
  const data = await stationImagery(station.lat, station.lon, { stacLimit, maxCloudPct });
  // `data.station` already carries lat/lon from the satellite module; merge
  // the AOMC catalog fields (name + state + ICAO) into one normalised block.
  return NextResponse.json({
    ...data,
    station: { id: station.id, name: station.name, state: station.state, lat: station.lat, lon: station.lon },
  });
}
