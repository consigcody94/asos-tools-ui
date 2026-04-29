/** GET /api/overlays/[type]
 *
 *  Proxies NWS / Esri public ArcGIS feature services to GeoJSON for
 *  MapLibre overlay rendering. Each `type` maps to a public REST
 *  endpoint; we forward a `queryFeatures` request asking for GeoJSON
 *  output and stream the response back.
 *
 *  We proxy server-side rather than calling these from the browser
 *  to keep the upstream URLs hidden, dodge CORS quirks, and centralise
 *  the per-host rate limit policy.
 */

import { NextResponse } from "next/server";
import { fetchJson } from "@/lib/server/fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OverlayDef {
  url: string;
  whereClause?: string;
}

// Each entry: an ArcGIS REST query URL that returns GeoJSON.
// Use `outFields=*` + `f=geojson` for FeatureServer / MapServer layers.
const OVERLAYS: Record<string, OverlayDef> = {
  // Active WWA polygons (warnings / watches / advisories) — operational hot.
  wwa: {
    url: "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query",
  },
  // WFO (Weather Forecast Office) county-warning-area boundaries.
  wfo: {
    url: "https://mapservices.weather.noaa.gov/static/rest/services/NWS_Reference_Maps/NWS_Reference_Map/MapServer/4/query",
  },
  // RFC (River Forecast Center) boundaries.
  rfc: {
    url: "https://mapservices.weather.noaa.gov/static/rest/services/NWS_Reference_Maps/NWS_Reference_Map/MapServer/5/query",
  },
  // CWSU (Center Weather Service Unit) boundaries.
  cwsu: {
    url: "https://mapservices.weather.noaa.gov/static/rest/services/NWS_Reference_Maps/NWS_Reference_Map/MapServer/3/query",
  },
  // World time zones (Esri Living Atlas).
  timezones: {
    url: "https://services.arcgis.com/iQ1dY19aHwbSDYIF/ArcGIS/rest/services/World_Time_Zones/FeatureServer/0/query",
  },
};

export async function GET(_req: Request, ctx: { params: Promise<{ type: string }> }) {
  const { type } = await ctx.params;
  const def = OVERLAYS[type];
  if (!def) return NextResponse.json({ error: `unknown overlay: ${type}` }, { status: 404 });

  const data = await fetchJson<unknown>(def.url, {
    timeoutMs: 25_000,
    query: {
      where: def.whereClause ?? "1=1",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
    },
  });

  return NextResponse.json(data ?? { type: "FeatureCollection", features: [] });
}
