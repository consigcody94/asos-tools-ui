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

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const station = aomcById(id);
  if (!station) {
    return NextResponse.json({ error: `unknown station ${id}` }, { status: 404 });
  }
  const { lat, lon } = station;
  const [quakes, storms, buoyPack, coopsPack, notamSummary] = await Promise.all([
    quakesNear(lat, lon, { radiusKm: 300, minMag: 2.5, feed: "day" }),
    stormsNear(lat, lon, 500),
    observationsNear(lat, lon, 200),
    coopsNear(lat, lon, 175),
    summarizeForDrill(station.id),
  ]);
  return NextResponse.json({
    station: { id: station.id, name: station.name, lat, lon, state: station.state },
    quakes,
    storms,
    buoy: buoyPack,
    coops: coopsPack,
    notams: notamSummary,
  });
}
