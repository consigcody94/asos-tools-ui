/** NHC active tropical cyclones.
 *  Single-file JSON; bucket caps at 1 req/s for politeness.
 */

import { haversineKm } from "./stations";
import { fetchJson } from "./fetcher";

const FEED = "https://www.nhc.noaa.gov/CurrentStorms.json";

const CLASS: Record<string, string> = {
  DB: "Disturbance", TD: "Tropical Depression", TS: "Tropical Storm",
  HU: "Hurricane", MH: "Major Hurricane", STD: "Subtropical Depression",
  STS: "Subtropical Storm", PTC: "Post-Tropical Cyclone", EX: "Extratropical",
  LO: "Low",
};

export interface Storm {
  id: string;
  name: string;
  classification: string;
  class_label: string;
  intensity_kt: string;
  pressure_mb: string;
  movement: string;
  lat: number;
  lon: number;
  public_advisory: string;
  forecast_cone: string;
  track_cone_graphic: string;
  distance_km?: number;
}

export async function fetchActiveStorms(): Promise<Storm[]> {
  const data = await fetchJson<{ activeStorms?: Array<Record<string, unknown>> }>(
    FEED, { timeoutMs: 15_000 },
  );
  const storms = data?.activeStorms || [];
  const out: Storm[] = [];
  for (const s of storms) {
    const lat = Number(s.latitudeNumeric);
    const lon = Number(s.longitudeNumeric);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const cls = String(s.classification || "");
    out.push({
      id: String(s.id || ""),
      name: String(s.name || ""),
      classification: cls,
      class_label: CLASS[cls.toUpperCase()] || cls,
      intensity_kt: String(s.intensity || ""),
      pressure_mb: String(s.pressure || ""),
      movement: String(s.latestMovement || ""),
      lat, lon,
      public_advisory: ((s.publicAdvisory as Record<string, unknown>) || {}).url as string || "",
      forecast_cone: ((s.forecastCone as Record<string, unknown>) || {}).zipFile as string || "",
      track_cone_graphic: ((s.trackCone as Record<string, unknown>) || {}).url as string || "",
    });
  }
  return out;
}

export async function stormsNear(
  lat: number, lon: number, radiusKm = 500,
): Promise<Storm[]> {
  const all = await fetchActiveStorms();
  const out: Storm[] = [];
  for (const s of all) {
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (d <= radiusKm) out.push({ ...s, distance_km: Math.round(d * 10) / 10 });
  }
  out.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
  return out;
}
