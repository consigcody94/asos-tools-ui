/** FAA WeatherCams — nearest-cam lookup + thumbnail URLs.
 *  Public search endpoint; bucket caps at 10 req/s (CDN-safe).
 */

import { fetchJson } from "./fetcher";

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

export async function camerasNear(
  lat: number,
  lon: number,
  radiusNm = 25,
  limit = 4,
): Promise<WeatherCam[]> {
  const raw = await fetchJson<unknown>("https://weathercams.faa.gov/map/search", {
    query: {
      latitude: String(lat),
      longitude: String(lon),
      radius: String(radiusNm),
      limit: String(limit),
    },
    timeoutMs: 15_000,
  });
  if (!raw) return [];
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
    thumbnail_url: (c.id ?? c.cameraId) ?
      `https://weathercams.faa.gov/cameras/${c.id ?? c.cameraId}/latestThumbnail` :
      undefined,
  }));
}

export function latestImageUrl(cameraId: number): string {
  return `https://weathercams.faa.gov/cameras/${cameraId}/latestImage`;
}
