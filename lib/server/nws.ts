/** NWS api.weather.gov — current conditions + active CAP alerts.
 *  Documented limit: 5 req/s per client with descriptive User-Agent.
 */

import { fetchJson } from "./fetcher";

const BASE = "https://api.weather.gov";

const cToF = (c: number | null | undefined) =>
  typeof c === "number" ? Math.round((c * 9 / 5 + 32) * 10) / 10 : null;
const mpsToKt = (v: number | null | undefined) =>
  typeof v === "number" ? Math.round(v * 1.94384 * 10) / 10 : null;
const mToMi = (v: number | null | undefined) =>
  typeof v === "number" ? Math.round((v / 1609.344) * 10) / 10 : null;
const paToInhg = (v: number | null | undefined) =>
  typeof v === "number" ? Math.round((v / 3386.39) * 100) / 100 : null;

function pickValue(v: unknown): number | null {
  if (v && typeof v === "object" && "value" in v) {
    const val = (v as { value: unknown }).value;
    return typeof val === "number" ? val : null;
  }
  return null;
}

export interface CurrentConditions {
  station: string;
  timestamp: string;
  description: string;
  temp_f: number | null;
  dewpoint_f: number | null;
  wind_speed_kt: number | null;
  wind_direction: number | null;
  wind_gust_kt: number | null;
  visibility_mi: number | null;
  pressure_inhg: number | null;
  sky: string;
  raw_metar: string;
  icon_url: string;
}

export async function getCurrentConditions(stationId: string): Promise<CurrentConditions | null> {
  const icao = stationId.trim().toUpperCase();
  const data = await fetchJson<{ properties: Record<string, unknown> }>(
    `${BASE}/stations/${icao}/observations/latest`,
    { headers: { Accept: "application/geo+json" }, timeoutMs: 15_000 },
  );
  if (!data?.properties) return null;
  const p = data.properties;
  return {
    station: icao,
    timestamp: String(p.timestamp || ""),
    description: String(p.textDescription || ""),
    temp_f: cToF(pickValue(p.temperature)),
    dewpoint_f: cToF(pickValue(p.dewpoint)),
    wind_speed_kt: mpsToKt(pickValue(p.windSpeed)),
    wind_direction: pickValue(p.windDirection),
    wind_gust_kt: mpsToKt(pickValue(p.windGust)),
    visibility_mi: mToMi(pickValue(p.visibility)),
    pressure_inhg: paToInhg(pickValue(p.barometricPressure)),
    sky: String(p.textDescription || ""),
    raw_metar: String(p.rawMessage || ""),
    icon_url: String(p.icon || ""),
  };
}

export interface CapAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  area_desc: string;
  sent: string;
  expires: string;
  sender: string;
  headline: string;
}

export async function getActiveAlerts(): Promise<CapAlert[]> {
  const data = await fetchJson<{ features: Array<{ properties: Record<string, unknown> }> }>(
    `${BASE}/alerts/active`,
    { headers: { Accept: "application/geo+json" }, timeoutMs: 15_000 },
  );
  if (!data?.features) return [];
  return data.features.map((f) => {
    const p = f.properties;
    return {
      id:        String(p.id || ""),
      event:     String(p.event || ""),
      severity:  String(p.severity || "Unknown"),
      urgency:   String(p.urgency || ""),
      area_desc: String(p.areaDesc || ""),
      sent:      String(p.sent || ""),
      expires:   String(p.expires || ""),
      sender:    String(p.senderName || ""),
      headline:  String(p.headline || ""),
    };
  });
}
