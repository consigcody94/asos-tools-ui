/** GET /api/station/[id]/hazards — combined quakes + tropical + buoy +
 *  coastal water-level/met + NOTAMs for one station, scoped to its
 *  coordinates. Used by the drill panel's Site Hazards block.
 */

import { NextResponse } from "next/server";
import { aomcById } from "@/lib/server/stations";
import { quakesNear } from "@/lib/server/usgs";
import { stormsNear } from "@/lib/server/nhc";
import { observationsNear } from "@/lib/server/ndbc";
import { coopsNear } from "@/lib/server/coops";
import { summarizeForDrill } from "@/lib/server/notams";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const qLat = url.searchParams.get("lat");
  const qLon = url.searchParams.get("lon");

  // Catalog lookup first (ASOS path), with lat/lon override for non-
  // catalog click targets (NEXRAD radar, NDBC buoys, satellites). The
  // override means the drill panel's hazard fetch never 404s on a
  // legitimate click — even a non-ASOS site gets nearby quakes,
  // tropical storms, buoy obs, water-level context.
  const station = aomcById(id);
  let lat: number, lon: number, name: string, state: string | undefined;
  if (station) {
    lat = station.lat; lon = station.lon;
    name = station.name; state = station.state;
  } else if (qLat && qLon) {
    const a = Number(qLat), b = Number(qLon);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return NextResponse.json(
        { error: "lat/lon must be numeric when station is not in catalog" },
        { status: 400 },
      );
    }
    lat = a; lon = b; name = id; state = undefined;
  } else {
    return NextResponse.json({ error: `unknown station ${id}` }, { status: 404 });
  }
  // NOTAMs are only meaningful for catalog ASOS stations; skip for
  // non-catalog clicks since the FAA NOTAM lookup is keyed by ICAO.
  const [quakes, storms, buoyPack, coopsPack, notamSummary] = await Promise.all([
    quakesNear(lat, lon, { radiusKm: 300, minMag: 2.5, feed: "day" }),
    stormsNear(lat, lon, 500),
    observationsNear(lat, lon, 200),
    coopsNear(lat, lon, 175),
    station ? summarizeForDrill(station.id) : Promise.resolve({
      configured: false, count: 0, equipment_out: 0, asos_related: 0, items: [],
    }),
  ]);
  return NextResponse.json({
    station: { id: station?.id ?? id, name, lat, lon, state },
    quakes,
    storms,
    buoy: buoyPack,
    coops: coopsPack,
    notams: notamSummary,
  });
}
