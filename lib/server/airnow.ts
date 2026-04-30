/** EPA AirNow — air-quality observations + forecasts.
 *
 *  AirNow is the federal AQI authority. We use it to add an Air-Quality
 *  badge to every ASOS drill panel: "AQI 152 (Unhealthy for Sensitive
 *  Groups) — PM2.5 dominant." Pulls observations from the AirNow
 *  network (EPA + state agencies + tribes + air districts), with the
 *  most recent hour available.
 *
 *  Auth: a free API key. Set AIRNOW_API_KEY in env. If unset, this
 *  module returns null politely — feature simply doesn't render in
 *  the drill panel rather than crashing the page.
 *
 *  Rate envelope: AirNow's docs describe their service as "moderate
 *  use" without a published numeric ceiling. We pace conservatively
 *  (1 req/s), which is far below typical thresholds for any operational
 *  consumer.
 *
 *  Reference: https://docs.airnowapi.org
 */

import { fetchJson } from "./fetcher";

const BASE = "https://www.airnowapi.org";
const KEY = process.env.AIRNOW_API_KEY || "";

interface AirNowObservation {
  DateObserved?: string;
  HourObserved?: number;
  LocalTimeZone?: string;
  ReportingArea?: string;
  StateCode?: string;
  Latitude?: number;
  Longitude?: number;
  ParameterName?: string;   // "PM2.5" | "PM10" | "OZONE" | "CO" | "NO2" | "SO2"
  AQI?: number;
  Category?: { Number?: number; Name?: string };
}

export interface AirQualitySnapshot {
  area: string;
  state: string;
  observed_at: string;          // ISO local time
  aqi: number;
  category: string;             // "Good" | "Moderate" | "Unhealthy for Sensitive Groups" | "Unhealthy" | "Very Unhealthy" | "Hazardous"
  category_color: string;       // EPA AQI color hex
  dominant_parameter: string;
  parameters: Array<{ name: string; aqi: number; category: string }>;
  source: "epa-airnow";
}

const AQI_COLORS: Record<string, string> = {
  Good: "#00e400",
  Moderate: "#ffff00",
  "Unhealthy for Sensitive Groups": "#ff7e00",
  Unhealthy: "#ff0000",
  "Very Unhealthy": "#8f3f97",
  Hazardous: "#7e0023",
};

/** Current AQI by lat/lon (radius in miles, default 25). Returns null
 *  when AIRNOW_API_KEY is unset or no station within radius. */
export async function fetchAirQualityNear(
  lat: number,
  lon: number,
  radiusMi = 25,
): Promise<AirQualitySnapshot | null> {
  if (!KEY) return null;
  const data = await fetchJson<AirNowObservation[]>(
    `${BASE}/aq/observation/latLong/current/`,
    {
      query: {
        format: "application/json",
        latitude: String(lat),
        longitude: String(lon),
        distance: String(radiusMi),
        API_KEY: KEY,
      },
      timeoutMs: 10_000,
      retries: 1,
    },
  );
  if (!Array.isArray(data) || data.length === 0) return null;

  // AirNow returns one row per parameter (PM2.5, OZONE, etc.). Take the
  // worst AQI as the headline number; preserve all parameters for the UI.
  const params = data
    .filter((r) => typeof r.AQI === "number")
    .map((r) => ({
      name: String(r.ParameterName || ""),
      aqi: Number(r.AQI ?? 0),
      category: String(r.Category?.Name || "Unknown"),
    }));
  if (params.length === 0) return null;
  const worst = params.reduce((a, b) => (a.aqi >= b.aqi ? a : b));

  const first = data[0];
  const dateLocal = first.DateObserved
    ? `${first.DateObserved.trim()} ${String(first.HourObserved ?? 0).padStart(2, "0")}:00 ${first.LocalTimeZone ?? ""}`
    : "";

  return {
    area: String(first.ReportingArea || ""),
    state: String(first.StateCode || ""),
    observed_at: dateLocal,
    aqi: worst.aqi,
    category: worst.category,
    category_color: AQI_COLORS[worst.category] ?? "#666666",
    dominant_parameter: worst.name,
    parameters: params,
    source: "epa-airnow" as const,
  };
}
