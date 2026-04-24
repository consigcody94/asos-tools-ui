/** NDBC buoy realtime2 feed parser + nearest-buoy wrapper. */

import { nearestBuoy } from "./stations";

const BASE = "https://www.ndbc.noaa.gov";
const UA = "owl-ui/2.0 (asos-tools-ui)";

const COLS = [
  "yy","mm","dd","hh","mn","wind_dir_deg","wind_mps","gust_mps",
  "wave_ht_m","dom_period_s","avg_period_s","mean_wave_dir_deg",
  "pres_hpa","air_c","water_c","dew_c","vis_nm","ptdy_hpa","tide_ft",
] as const;

type ObsKey = typeof COLS[number] | "wind_kt" | "gust_kt" | "pres_inhg" | "air_f" | "water_f" | "dew_f";

export type BuoyObs = Partial<Record<ObsKey, number | null>>;

function parseRealtime2First(text: string): BuoyObs | null {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < COLS.length) continue;
    const row: BuoyObs = {};
    COLS.forEach((c, i) => {
      const v = parts[i];
      if (v === "MM") (row as Record<string, number | null>)[c] = null;
      else {
        const n = parseFloat(v);
        (row as Record<string, number | null>)[c] = Number.isFinite(n) ? n : null;
      }
    });
    if (row.wind_mps != null) row.wind_kt = Math.round(row.wind_mps * 1.94384 * 10) / 10;
    if (row.gust_mps != null) row.gust_kt = Math.round(row.gust_mps * 1.94384 * 10) / 10;
    if (row.pres_hpa != null) row.pres_inhg = Math.round((row.pres_hpa / 33.8639) * 100) / 100;
    if (row.air_c != null)   row.air_f   = Math.round((row.air_c   * 9/5 + 32) * 10) / 10;
    if (row.water_c != null) row.water_f = Math.round((row.water_c * 9/5 + 32) * 10) / 10;
    if (row.dew_c != null)   row.dew_f   = Math.round((row.dew_c   * 9/5 + 32) * 10) / 10;
    return row;
  }
  return null;
}

export async function fetchBuoyLatest(buoyId: string): Promise<BuoyObs | null> {
  if (!buoyId) return null;
  try {
    const r = await fetch(`${BASE}/data/realtime2/${buoyId.toUpperCase()}.txt`, {
      headers: { "User-Agent": UA, Accept: "text/plain" },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 600 },
    });
    if (!r.ok) return null;
    return parseRealtime2First(await r.text());
  } catch { return null; }
}

export async function observationsNear(
  lat: number, lon: number, maxKm = 200,
): Promise<{ buoy: { id: string; name: string; distance_km: number }; obs: BuoyObs | null } | null> {
  const near = nearestBuoy(lat, lon, maxKm);
  if (!near) return null;
  const obs = await fetchBuoyLatest(near.id);
  return {
    buoy: { id: near.id, name: near.meta.name, distance_km: near.km },
    obs,
  };
}
