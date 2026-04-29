/** NOAA CO-OPS coastal water-level + meteorological correlation.
 *
 *  CO-OPS is useful for coastal ASOS investigations: a coastal airport can
 *  show pressure/wind issues while a nearby NWLON/PORTS station confirms
 *  water level, wind, pressure, and temperature context from an independent
 *  NOAA observing network.
 */

import { fetchJson } from "./fetcher";
import { haversineKm } from "./stations";

const MDAPI = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";
const DATA_API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const APP_ID = "OWL_ASOS_TOOLS";

interface CoopsStationRaw {
  id?: string;
  name?: string;
  lat?: number | string;
  lng?: number | string;
  lon?: number | string;
  state?: string;
  affiliations?: string;
  tidal?: boolean;
  greatlakes?: boolean;
}

interface CoopsStationsResponse {
  count?: number;
  stations?: CoopsStationRaw[];
  stationList?: CoopsStationRaw[];
}

export interface CoopsStation {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  affiliations: string;
  tidal: boolean;
  greatlakes: boolean;
}

interface CoopsDatumResponse {
  metadata?: { id?: string; name?: string; lat?: string; lon?: string };
  data?: Array<Record<string, string>>;
  error?: { message?: string };
}

export interface CoopsObservation {
  observed_at: string | null;
  water_level_ft: number | null;
  water_level_quality: string | null;
  wind_kt: number | null;
  wind_dir_deg: number | null;
  wind_cardinal: string | null;
  gust_kt: number | null;
  air_temp_f: number | null;
  air_pressure_hpa: number | null;
}

export interface CoopsPack {
  station: CoopsStation & { distance_km: number };
  obs: CoopsObservation | null;
  links: {
    station: string;
    data_api: string;
  };
}

let stationCache: { at: number; rows: CoopsStation[] } | null = null;
const STATION_TTL_MS = 6 * 60 * 60_000;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normaliseStation(s: CoopsStationRaw): CoopsStation | null {
  const id = String(s.id ?? "").trim();
  const lat = num(s.lat);
  const lon = num(s.lng ?? s.lon);
  if (!id || lat === null || lon === null) return null;
  return {
    id,
    name: String(s.name ?? id),
    state: String(s.state ?? ""),
    lat,
    lon,
    affiliations: String(s.affiliations ?? ""),
    tidal: Boolean(s.tidal),
    greatlakes: Boolean(s.greatlakes),
  };
}

export async function coopsStations(): Promise<CoopsStation[]> {
  if (stationCache && Date.now() - stationCache.at < STATION_TTL_MS) {
    return stationCache.rows;
  }

  const data = await fetchJson<CoopsStationsResponse>(
    `${MDAPI}/stations.json`,
    {
      query: { type: "waterlevelsandmet", units: "english" },
      timeoutMs: 20_000,
    },
  );
  const rows = (data?.stations ?? data?.stationList ?? [])
    .map(normaliseStation)
    .filter(Boolean) as CoopsStation[];
  stationCache = { at: Date.now(), rows };
  return rows;
}

async function latestProduct(
  stationId: string,
  product: "water_level" | "wind" | "air_temperature" | "air_pressure",
): Promise<Record<string, string> | null> {
  const query: Record<string, string> = {
    date: "latest",
    station: stationId,
    product,
    time_zone: "gmt",
    units: "english",
    format: "json",
    application: APP_ID,
  };
  if (product === "water_level") query.datum = "MLLW";
  const data = await fetchJson<CoopsDatumResponse>(
    DATA_API,
    {
      query,
      timeoutMs: 15_000,
      retries: 2,
    },
  );
  return data?.data?.[0] ?? null;
}

function coopsStationLink(id: string): string {
  return `https://tidesandcurrents.noaa.gov/stationhome.html?id=${encodeURIComponent(id)}`;
}

function coopsDataApiLink(id: string): string {
  const params = new URLSearchParams({
    date: "latest",
    station: id,
    product: "water_level",
    datum: "MLLW",
    time_zone: "gmt",
    units: "english",
    format: "json",
    application: APP_ID,
  });
  return `${DATA_API}?${params.toString()}`;
}

export async function coopsNear(
  lat: number,
  lon: number,
  maxKm = 175,
): Promise<CoopsPack | null> {
  const stations = await coopsStations();
  let best: (CoopsStation & { distance_km: number }) | null = null;
  for (const s of stations) {
    const km = Math.round(haversineKm(lat, lon, s.lat, s.lon) * 10) / 10;
    if (!best || km < best.distance_km) best = { ...s, distance_km: km };
  }
  if (!best || best.distance_km > maxKm) return null;

  const [water, wind, temp, pressure] = await Promise.all([
    latestProduct(best.id, "water_level"),
    latestProduct(best.id, "wind"),
    latestProduct(best.id, "air_temperature"),
    latestProduct(best.id, "air_pressure"),
  ]);

  const obs: CoopsObservation | null =
    water || wind || temp || pressure
      ? {
          observed_at: water?.t ?? wind?.t ?? temp?.t ?? pressure?.t ?? null,
          water_level_ft: num(water?.v),
          water_level_quality: water?.q ?? null,
          wind_kt: num(wind?.s),
          wind_dir_deg: num(wind?.d),
          wind_cardinal: wind?.dr ?? null,
          gust_kt: num(wind?.g),
          air_temp_f: num(temp?.v),
          air_pressure_hpa: num(pressure?.v),
        }
      : null;

  return {
    station: best,
    obs,
    links: {
      station: coopsStationLink(best.id),
      data_api: coopsDataApiLink(best.id),
    },
  };
}
