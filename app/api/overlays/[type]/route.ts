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
  /** Hard cap on returned features. NWS WWA in particular can balloon
   *  to thousands of polygons on active weather days; the cap is a
   *  safety belt against the response exceeding the proxy buffer. */
  resultRecordCount?: number;
  /** Decimal places of geometry precision. ArcGIS rounds coordinates
   *  to this many digits, dropping ~95% of the bytes of a typical
   *  detailed polygon with no visible loss at zoom 4–7. WWA's raw
   *  6-digit coordinates produce 45 MB; precision=2 (~1 km) is
   *  visually identical at the operator's typical CONUS view and
   *  drops the response to a few hundred KB. */
  geometryPrecision?: number;
  /** Douglas–Peucker simplification tolerance in degrees (lat/lon).
   *  0.05° ≈ 5.5 km — collapses near-collinear vertices that the
   *  human eye can't resolve at the rendered scale. */
  maxAllowableOffset?: number;
}

// Each entry: an ArcGIS REST query URL that returns GeoJSON.
// Use `outFields=*` + `f=geojson` for FeatureServer / MapServer layers.
const OVERLAYS: Record<string, OverlayDef> = {
  // Active WWA polygons (warnings / watches / advisories) — operational hot.
  // Filter to currently-active records via the EXPIRATION column the
  // NWS WWA service exposes; cap at 500 features so the response
  // stays under ~2 MB even on heavy-weather days. The full feature
  // class is ~41 MB without filtering.
  wwa: {
    url: "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query",
    // Field is lowercase `expiration` in the layer schema; it's a
    // datetime in the future for currently-active alerts. We tried
    // adding geometryPrecision + maxAllowableOffset to shrink the
    // ~45 MB response but the upstream returns 400 on that param
    // combo with this layer — leaving raw and relying on the
    // resultRecordCount cap (500) for size control.
    whereClause: "expiration>CURRENT_TIMESTAMP",
    resultRecordCount: 500,
  },
  // World time zones (Esri Living Atlas) — already lightweight.
  timezones: {
    url: "https://services.arcgis.com/iQ1dY19aHwbSDYIF/ArcGIS/rest/services/World_Time_Zones/FeatureServer/0/query",
  },
};

// NWS API zones — known-broken for our use case. The bulk
// `/zones?type=...&include_geometry=true` endpoint returns
// `geometry: null` for every feature regardless of the flag, and
// the per-zone endpoint requires ~700 separate API calls (~30 s).
// Until we ship a build-time snapshot under public/boundaries/
// we leave these types unmapped so the UI clearly disables them.
const NWS_API_ZONES: Record<string, string> = {};

export async function GET(_req: Request, ctx: { params: Promise<{ type: string }> }) {
  const { type } = await ctx.params;

  // NWS API path (different shape than ArcGIS — no query params needed,
  // response is already a GeoJSON FeatureCollection).
  const nwsUrl = NWS_API_ZONES[type];
  if (nwsUrl) {
    const data = await fetchJson<unknown>(nwsUrl, {
      timeoutMs: 25_000,
      headers: { Accept: "application/geo+json" },
    });
    return NextResponse.json(data ?? { type: "FeatureCollection", features: [] });
  }

  // ArcGIS REST path.
  const def = OVERLAYS[type];
  if (!def) return NextResponse.json({ error: `unknown overlay: ${type}` }, { status: 404 });

  const query: Record<string, string> = {
    where: def.whereClause ?? "1=1",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  };
  if (def.resultRecordCount) query.resultRecordCount = String(def.resultRecordCount);
  if (def.geometryPrecision != null) query.geometryPrecision = String(def.geometryPrecision);
  if (def.maxAllowableOffset != null) query.maxAllowableOffset = String(def.maxAllowableOffset);

  const data = await fetchJson<unknown>(def.url, {
    timeoutMs: 25_000,
    query,
  });

  return NextResponse.json(data ?? { type: "FeatureCollection", features: [] });
}
