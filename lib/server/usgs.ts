/** USGS Earthquake Hazards Program — GeoJSON summary feeds. */

import { haversineKm } from "./stations";

const UA = "owl-ui/2.0 (asos-tools-ui)";

const FEEDS = {
  hour:        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
  day:         "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
  day_all:     "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  week:        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
  significant: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson",
} as const;

export type UsgsFeed = keyof typeof FEEDS;

export interface Quake {
  id: string;
  mag: number | null;
  place: string;
  time_ms: number | null;
  url: string;
  tsunami: boolean;
  alert: string;
  lat: number;
  lon: number;
  depth_km: number | null;
  distance_km?: number;
}

async function fetchFeed(key: UsgsFeed): Promise<Quake[]> {
  try {
    const r = await fetch(FEEDS[key], {
      headers: { "User-Agent": UA, Accept: "application/geo+json" },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 300 },
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { features?: Array<{ id: string; properties: Record<string, unknown>; geometry: { coordinates: number[] } }> };
    if (!j?.features) return [];
    return j.features.map((f) => {
      const p = f.properties;
      const c = f.geometry?.coordinates || [];
      return {
        id:       String(f.id || p.code || ""),
        mag:      typeof p.mag === "number" ? p.mag : null,
        place:    String(p.place || ""),
        time_ms:  typeof p.time === "number" ? p.time : null,
        url:      String(p.url || ""),
        tsunami:  Boolean(p.tsunami),
        alert:    String(p.alert || ""),
        lat:      Number(c[1] ?? 0),
        lon:      Number(c[0] ?? 0),
        depth_km: typeof c[2] === "number" ? c[2] : null,
      };
    });
  } catch { return []; }
}

export async function fetchRecentQuakes(feed: UsgsFeed = "day"): Promise<Quake[]> {
  return fetchFeed(feed);
}

export async function quakesNear(
  lat: number, lon: number,
  opts: { radiusKm?: number; minMag?: number; feed?: UsgsFeed } = {},
): Promise<Quake[]> {
  const radius = opts.radiusKm ?? 300;
  const minMag = opts.minMag ?? 2.5;
  const feed = opts.feed ?? "day";
  const all = await fetchFeed(feed);
  const out: Quake[] = [];
  for (const q of all) {
    if (q.mag === null || q.mag < minMag) continue;
    const d = haversineKm(lat, lon, q.lat, q.lon);
    if (d <= radius) out.push({ ...q, distance_km: Math.round(d * 10) / 10 });
  }
  out.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
  return out;
}
