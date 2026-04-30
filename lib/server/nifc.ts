/** NIFC (National Interagency Fire Center) wildfire perimeters.
 *
 *  NIFC publishes the authoritative active-wildfire perimeter and
 *  incident dataset via a public ArcGIS FeatureServer. This is the
 *  same source NWS / NIFC dashboards / state EOCs use for the active
 *  fire footprint — covers federal + state + tribal fires across CONUS,
 *  Alaska, and Hawaii.
 *
 *  Two layers we care about:
 *    - WFIGS Interagency Perimeters (Current)  — fire-perimeter polygons
 *    - WFIGS Interagency Incident Locations    — fire-of-origin points
 *
 *  No auth, no published rate limit beyond Esri's general "reasonable
 *  use." We cache for 5 minutes — wildfires don't update perimeter
 *  faster than that.
 *
 *  For the map overlay we expose just the perimeter feature service URL;
 *  MapLibre fetches it directly via /api/overlays/[type]?type=nifc-fires.
 */

import { fetchJson } from "./fetcher";

const PERIM_BASE =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/" +
  "WFIGS_Interagency_Perimeters_Current/FeatureServer/0";
const INCIDENT_BASE =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/" +
  "WFIGS_Incident_Locations_Current/FeatureServer/0";

export interface FireIncident {
  id: string;
  name: string;
  state: string;
  /** Acres burned per the latest situation report. NIFC names this
   *  `IncidentSize` or `DailyAcres` depending on layer; we surface
   *  whichever is populated. */
  acres: number | null;
  containment_pct: number | null;
  cause: string | null;
  discovery_date: string | null;
  status: string | null;     // "Active" | "Contained" | etc.
  lat: number;
  lon: number;
  /** Distance from the query point in km, when fetched via fireNear(). */
  distance_km?: number;
  source: "nifc-wfigs";
}

let _cache: { at: number; rows: FireIncident[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

interface ArcGisFeature {
  attributes?: Record<string, unknown>;
  geometry?: { x?: number; y?: number };
}

interface ArcGisResponse {
  features?: ArcGisFeature[];
  exceededTransferLimit?: boolean;
}

/** Fetch all currently-active wildfires nationally. Used by the
 *  Hazards tab summary + the map overlay tooltip. */
export async function fetchActiveFires(): Promise<FireIncident[]> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  try {
    const data = await fetchJson<ArcGisResponse>(`${INCIDENT_BASE}/query`, {
      query: {
        where: "FireOutDateTime IS NULL",  // still active
        outFields: [
          "IrwinID", "IncidentName", "POOState", "IncidentSize",
          "PercentContained", "FireCause", "FireDiscoveryDateTime",
          "IncidentStatusCategory", "FireBehaviorGeneral",
        ].join(","),
        returnGeometry: "true",
        outSR: "4326",
        f: "json",
      },
      timeoutMs: 25_000,
      retries: 1,
    });
    const features = data?.features ?? [];
    const rows: FireIncident[] = features.map((f) => {
      const a = f.attributes ?? {};
      return {
        id:        String(a.IrwinID ?? a.OBJECTID ?? ""),
        name:      String(a.IncidentName ?? "Unknown"),
        state:     String(a.POOState ?? ""),
        acres:     a.IncidentSize != null ? Number(a.IncidentSize) : null,
        containment_pct: a.PercentContained != null ? Number(a.PercentContained) : null,
        cause:     a.FireCause != null ? String(a.FireCause) : null,
        discovery_date: a.FireDiscoveryDateTime != null
          ? new Date(Number(a.FireDiscoveryDateTime)).toISOString()
          : null,
        status: a.IncidentStatusCategory != null ? String(a.IncidentStatusCategory) : null,
        lat: Number(f.geometry?.y ?? 0),
        lon: Number(f.geometry?.x ?? 0),
        source: "nifc-wfigs" as const,
      };
    }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.id);
    _cache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn("[nifc] fetch failed:", (err as Error).message);
    return _cache?.rows ?? [];
  }
}

/** Haversine distance in km. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Fires within `radiusKm` of a point, sorted nearest-first. Used by
 *  the station drill panel — answers "is there a wildfire near KXYZ?" */
export async function fireNear(
  lat: number,
  lon: number,
  radiusKm = 100,
): Promise<FireIncident[]> {
  const all = await fetchActiveFires();
  const tagged = all
    .map((f) => ({ ...f, distance_km: haversineKm(lat, lon, f.lat, f.lon) }))
    .filter((f) => f.distance_km <= radiusKm);
  tagged.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
  return tagged;
}

/** ArcGIS FeatureServer URL pattern for the perimeter polygons —
 *  consumed by /api/overlays/[type] (type=nifc-fires) for map rendering. */
export const NIFC_PERIMETER_URL = `${PERIM_BASE}/query`;
