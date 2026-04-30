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

// ---- OFS (Operational Forecast System) Water Level ------------------------
//
// CO-OPS exposes OFS model nowcast/forecast guidance at most real-time
// water-level stations within an OFS domain (CBOFS Chesapeake Bay,
// LEOFS Lake Erie, NYOFS New York Harbor, GoMOFS Gulf of Maine,
// STOFS-3D Atlantic Coast, etc.). The product is `ofs_water_level` —
// 6-min interval values from "now" stretching ~48 h forward.
//
// Why operationally critical for ASOS: a coastal ASOS site reporting
// pressure/wind anomalies during a tropical or extratropical cyclone
// becomes much more meaningful when the OFS forecast shows surge
// already arriving at the nearest tide gauge. This is the closest
// thing NOAA has to "what's the storm surge going to do at this
// airport in the next 24 hours?"
//
// Data length limit per CO-OPS docs: 7 days for 6-min interval. We ask
// for "today" by default (24h history); callers can extend with
// daysBack/daysForward if needed.

interface OfsRawRow {
  t?: string;     // "YYYY-MM-DD HH:MM" GMT
  v?: string;     // value as string
  s?: string;     // sigma (forecast uncertainty)
  f?: string;     // flags
  q?: string;     // quality
}

interface OfsApiResponse {
  metadata?: { id?: string; name?: string; lat?: string; lon?: string };
  data?: OfsRawRow[];
  predictions?: OfsRawRow[];   // legacy field name on some endpoints
  error?: { message?: string };
}

export interface OfsWaterLevel {
  station_id: string;
  station_name: string;
  /** OFS values are an aggregate of recent obs + forecast horizon.
   *  We split them so the UI can label nowcast vs forecast distinctly. */
  rows: Array<{
    timestamp: string;     // ISO UTC
    value_ft: number | null;
    /** "nowcast" if t <= now, "forecast" if t > now. */
    kind: "nowcast" | "forecast";
  }>;
  /** Peak forecast height + when, lifted out of `rows` for quick UI use. */
  peak: { value_ft: number; timestamp: string } | null;
  /** Trough (lowest) forecast height + when. Useful for low-water ops. */
  trough: { value_ft: number; timestamp: string } | null;
  /** Source URL for "see more on tidesandcurrents.noaa.gov" deep links. */
  source_url: string;
}

/** Convert CO-OPS "YYYY-MM-DD HH:MM" GMT to ISO. */
function coopsToIso(t: string | undefined): string | null {
  if (!t) return null;
  return t.trim().replace(" ", "T") + "Z";
}

/** Fetch OFS Water Level (nowcast + forecast) for a single CO-OPS
 *  station. Returns null if the station is not within an OFS domain
 *  (most inland or remote coastal stations) or the call errors. */
export async function fetchOfsWaterLevel(
  stationId: string,
  hoursBack = 6,
  hoursForward = 36,
): Promise<OfsWaterLevel | null> {
  const id = stationId.trim();
  if (!id) return null;
  const now = new Date();
  const start = new Date(now.getTime() - hoursBack * 3_600_000);
  const end = new Date(now.getTime() + hoursForward * 3_600_000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(d.getUTCDate()).padStart(2, "0")} ` +
    `${String(d.getUTCHours()).padStart(2, "0")}:` +
    `${String(d.getUTCMinutes()).padStart(2, "0")}`;

  const data = await fetchJson<OfsApiResponse>(`${DATA_API}`, {
    query: {
      station: id,
      product: "ofs_water_level",
      datum: "MLLW",
      time_zone: "gmt",
      units: "english",
      begin_date: fmt(start),
      end_date: fmt(end),
      format: "json",
      application: APP_ID,
    },
    timeoutMs: 15_000,
    retries: 1,
  });
  if (!data || data.error || !Array.isArray(data.data) && !Array.isArray(data.predictions)) {
    // OFS isn't available at this station, or upstream is having a moment.
    return null;
  }
  const raw = data.data ?? data.predictions ?? [];
  if (raw.length === 0) return null;

  const nowMs = now.getTime();
  const rows: OfsWaterLevel["rows"] = [];
  let peak: { value_ft: number; timestamp: string } | null = null;
  let trough: { value_ft: number; timestamp: string } | null = null;

  for (const r of raw) {
    const iso = coopsToIso(r.t);
    if (!iso) continue;
    const v = r.v ? Number(r.v) : null;
    const kind: "nowcast" | "forecast" =
      Date.parse(iso) <= nowMs ? "nowcast" : "forecast";
    rows.push({ timestamp: iso, value_ft: v, kind });
    // Only forecast values feed peak/trough — nowcast is observation, not prediction.
    if (kind === "forecast" && v != null && Number.isFinite(v)) {
      if (!peak || v > peak.value_ft) peak = { value_ft: v, timestamp: iso };
      if (!trough || v < trough.value_ft) trough = { value_ft: v, timestamp: iso };
    }
  }

  return {
    station_id: data.metadata?.id ? String(data.metadata.id) : id,
    station_name: data.metadata?.name ? String(data.metadata.name) : id,
    rows,
    peak,
    trough,
    source_url: `https://tidesandcurrents.noaa.gov/ofs/ofs_station.html?stname=${id}`,
  };
}
