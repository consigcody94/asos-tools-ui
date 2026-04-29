import { NextResponse } from "next/server";
import { nexradOutages } from "@/lib/server/nexrad-outages";
import { wsr88dSites } from "@/lib/server/stations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Outages give us status + reason but no coordinates. The wsr88d
  // catalog has lat/lon per site. Join so the client can place markers
  // on the map. Sites in the catalog with no outage row are reported
  // as UP (operational).
  const outages = await nexradOutages();
  const byId = new Map(outages.map((o) => [o.station, o]));
  const catalog = wsr88dSites();

  const rows: Array<{
    station: string;
    name?: string;
    state?: string;
    lat: number;
    lon: number;
    status: "UP" | "DOWN" | "DEGRADED" | "UNKNOWN";
    reason: string | null;
    since: string | null;
  }> = [];

  for (const [id, site] of Object.entries(catalog)) {
    const o = byId.get(id);
    rows.push({
      station: id,
      name: site.name,
      state: o?.state ?? "",
      lat: site.lat,
      lon: site.lon,
      status: o?.status ?? "UP",
      reason: o?.reason ?? null,
      since: o?.since ?? null,
    });
  }

  return NextResponse.json({
    source: "weather.gov/nl2/NEXRADView + wsr88d catalog",
    count: rows.length,
    outage_count: outages.length,
    rows,
  });
}
