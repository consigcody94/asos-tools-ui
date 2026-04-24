/** FAA WeatherCams — nearest-cam lookup + thumbnail URLs.
 *
 *  FAA exposes a public JSON catalog at weathercams.faa.gov for the search
 *  map. For our purposes we just hit their spatial-search endpoint.
 */

const UA = "owl-ui/2.0 (asos-tools-ui)";

export interface WeatherCam {
  id: number;
  site_name: string;
  direction: string;
  distance_nm: number;
  lat: number;
  lon: number;
  thumbnail_url?: string;
}

interface FaaCamHit {
  cameraId?: number;
  id?: number;
  siteName?: string;
  site_name?: string;
  direction?: string;
  distanceNm?: number;
  distance_nm?: number;
  latitude?: number;
  longitude?: number;
}

/** Query FAA's public weathercams.faa.gov search API for cams near a lat/lon.
 *  FAA exposes a public geospatial search at `weathercams.faa.gov/map/search`
 *  that accepts lat / lon / radius — no auth.  Field names have shifted
 *  twice over the years; we normalise both camelCase and snake_case. */
export async function camerasNear(
  lat: number,
  lon: number,
  radiusNm = 25,
  limit = 4,
): Promise<WeatherCam[]> {
  // Public search endpoint — returns JSON list of cameras within a radius.
  const url =
    `https://weathercams.faa.gov/map/search?latitude=${lat}&longitude=${lon}` +
    `&radius=${radiusNm}&limit=${limit}`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 600 },
    });
    if (!r.ok) return [];
    const raw = await r.json();
    const list: FaaCamHit[] = Array.isArray(raw) ? raw :
      Array.isArray((raw as { cameras?: unknown }).cameras) ? (raw as { cameras: FaaCamHit[] }).cameras :
      Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: FaaCamHit[] }).results :
      [];
    return list.slice(0, limit).map((c) => ({
      id: Number(c.cameraId ?? c.id ?? 0),
      site_name: String(c.siteName ?? c.site_name ?? ""),
      direction: String(c.direction ?? ""),
      distance_nm: Number(c.distanceNm ?? c.distance_nm ?? 0),
      lat: Number(c.latitude ?? 0),
      lon: Number(c.longitude ?? 0),
      thumbnail_url: c.id ?
        `https://weathercams.faa.gov/cameras/${c.id ?? c.cameraId}/latestThumbnail` :
        undefined,
    }));
  } catch {
    return [];
  }
}

export function latestImageUrl(cameraId: number): string {
  return `https://weathercams.faa.gov/cameras/${cameraId}/latestImage`;
}
