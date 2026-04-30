/** US Drought Monitor (USDM) — weekly drought-severity GeoJSON.
 *
 *  Source: https://droughtmonitor.unl.edu (a partnership of NDMC at
 *  Univ. of Nebraska-Lincoln, USDA, NOAA). Updated every Thursday;
 *  classifies CONUS + Alaska/Hawaii/Puerto Rico into 5 categories:
 *    D0 — Abnormally Dry      (orange-yellow)
 *    D1 — Moderate Drought    (light orange)
 *    D2 — Severe Drought      (orange)
 *    D3 — Extreme Drought     (dark red)
 *    D4 — Exceptional Drought (deep red)
 *
 *  We use it for two things:
 *    1. Per-station drought tag in the drill panel ("KAMA: D2 Severe").
 *    2. CONUS overlay layer on the map (toggle in sidebar).
 *
 *  The current-week GeoJSON is published at a stable URL — no key,
 *  no rate limit beyond reasonable use. We cache for 24 hours since
 *  the dataset only ticks weekly.
 */

import { fetchJson } from "./fetcher";

const CURRENT_GEOJSON =
  "https://droughtmonitor.unl.edu/data/json/usdm_current.json";

export type DroughtCategory = "D0" | "D1" | "D2" | "D3" | "D4";

const LABELS: Record<DroughtCategory, string> = {
  D0: "Abnormally Dry",
  D1: "Moderate Drought",
  D2: "Severe Drought",
  D3: "Extreme Drought",
  D4: "Exceptional Drought",
};

const COLORS: Record<DroughtCategory, string> = {
  D0: "#FFFF00",
  D1: "#FCD37F",
  D2: "#FFAA00",
  D3: "#E60000",
  D4: "#730000",
};

interface UsdmFeature {
  type: "Feature";
  properties?: { DM?: number | string; OBJECTID?: number };
  geometry?: { type: string; coordinates: unknown };
}

interface UsdmCollection {
  type?: "FeatureCollection";
  features?: UsdmFeature[];
  /** Some USDM products also include a `metadata` block with the
   *  validity date — we surface it for the UI. */
  metadata?: { date?: string };
}

let _cache: { at: number; data: UsdmCollection | null } | null = null;
const TTL_MS = 24 * 60 * 60 * 1000;  // weekly product, 24h cache is fine

/** Fetch the current-week USDM GeoJSON. Returns the raw FeatureCollection. */
export async function fetchUsdmCurrent(): Promise<UsdmCollection | null> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.data;
  try {
    const data = await fetchJson<UsdmCollection>(CURRENT_GEOJSON, {
      timeoutMs: 25_000,
      retries: 1,
    });
    _cache = { at: Date.now(), data: data ?? null };
    return data ?? null;
  } catch (err) {
    console.warn("[usdm] fetch failed:", (err as Error).message);
    return _cache?.data ?? null;
  }
}

/** Point-in-polygon test (ray casting) for a single ring. */
function pointInRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i][0], ring[i][1]];
    const [xj, yj] = [ring[j][0], ring[j][1]];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lat: number, lon: number, geom: UsdmFeature["geometry"]): boolean {
  if (!geom) return false;
  if (geom.type === "Polygon") {
    const rings = geom.coordinates as number[][][];
    return pointInRing(lat, lon, rings[0]);
  }
  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates as number[][][][];
    for (const poly of polys) {
      if (pointInRing(lat, lon, poly[0])) return true;
    }
  }
  return false;
}

/** Look up the drought category at a single point. Returns null when
 *  the point is not within any USDM polygon (ocean, outside CONUS+
 *  HI/AK/PR). */
export async function droughtAt(lat: number, lon: number): Promise<{
  category: DroughtCategory;
  label: string;
  color: string;
  effective_date: string | null;
} | null> {
  const fc = await fetchUsdmCurrent();
  if (!fc?.features) return null;
  for (const f of fc.features) {
    if (!pointInGeometry(lat, lon, f.geometry)) continue;
    const dmRaw = f.properties?.DM;
    const dm = typeof dmRaw === "string" ? Number(dmRaw) : (dmRaw as number);
    if (!Number.isFinite(dm) || dm < 0 || dm > 4) continue;
    const cat = (`D${dm}`) as DroughtCategory;
    return {
      category: cat,
      label: LABELS[cat],
      color: COLORS[cat],
      effective_date: fc.metadata?.date ?? null,
    };
  }
  return null;
}
