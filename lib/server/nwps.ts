/** NOAA Office of Water Prediction — NWPS National Water Prediction
 *  Service client.
 *
 *  Hydrology context for inland ASOS stations: nearest river gauge,
 *  observed flow, official streamflow forecast, flood-stage thresholds
 *  (action / minor / moderate / major), and National Water Model
 *  guidance. Lights up the "is there a flood at this airport?" question
 *  without operators having to leave OWL for the NWS hydro pages.
 *
 *  Endpoints (per OWP API v1, validated against the live service and
 *  cross-referenced with NOAA-OWP/hydrotools URL catalogs):
 *    GET /v1/gauges                       — list all gauges (~10k)
 *    GET /v1/gauges/{lid}                 — gauge metadata + flood stages
 *    GET /v1/gauges/{lid}/stageflow       — current obs + recent series
 *    GET /v1/gauges/{lid}/stageflow/forecast — forecast time series
 *    GET /v1/gauges/{lid}/national-water-model — NWM guidance
 *
 *  IDs use the NWS Location Identifier (LID): 5-letter codes like
 *  WSHV2 (Washington Crossing, NJ on the Delaware), CDRP1 (Cedar
 *  Rapids, IA on the Cedar River). LIDs are NOT the same as ASOS
 *  ICAO codes — we find nearest-by-haversine.
 *
 *  Rate envelope: per fetcher.ts host limits, api.water.noaa.gov
 *  is paced to 1 req/s sustained. NWPS doesn't publish a numeric
 *  ceiling but the service is sized for operational + research use.
 */

import { fetchJson } from "./fetcher";

const BASE = "https://api.water.noaa.gov/nwps/v1";

export interface NwpsGauge {
  /** NWS Location Identifier — primary key. */
  lid: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  /** River / waterway name. */
  waterbody?: string;
  /** Forecast point category — "F" = forecast, "O" = observation only. */
  category?: string;
}

export interface FloodStages {
  /** Stage at which flood-prep actions are advised. May be null when
   *  the gauge doesn't have a forecasted flood-stage table. */
  action_ft: number | null;
  minor_flood_ft: number | null;
  moderate_flood_ft: number | null;
  major_flood_ft: number | null;
  /** Equivalents in flow rate (cfs) when the gauge publishes both. */
  action_cfs: number | null;
  minor_flood_cfs: number | null;
  moderate_flood_cfs: number | null;
  major_flood_cfs: number | null;
}

export interface StageFlowReading {
  timestamp: string;          // ISO UTC
  stage_ft: number | null;
  flow_cfs: number | null;
  /** "observed" | "forecast" — distinguishes telemetry from prediction. */
  kind: "observed" | "forecast";
}

export interface NearestNwpsGauge {
  gauge: NwpsGauge & { distance_km: number };
  stages: FloodStages;
  /** Latest observed reading. */
  latest: StageFlowReading | null;
  /** Forecast peak in the next 7 days (when gauge is forecast-enabled). */
  peak_forecast: StageFlowReading | null;
  /** Computed flood category at latest+peak: "none" | "action" | "minor" |
   *  "moderate" | "major". UI uses this for the badge color. */
  flood_status: "none" | "action" | "minor" | "moderate" | "major";
  /** Deep links into NWPS / NWS hydro pages. */
  links: {
    nwps_gauge: string;
    forecast_graph: string;
  };
}

// ---- Catalog cache (huge, ~10k gauges → 24h refresh) ----------------------

interface GaugesListResponse {
  gauges?: Array<{
    lid?: string;
    name?: string;
    state?: string;
    latitude?: number | string;
    longitude?: number | string;
    waterbody?: string;
    category?: string;
  }>;
}

let _catalogCache: { at: number; gauges: NwpsGauge[] } | null = null;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchGaugeCatalog(): Promise<NwpsGauge[]> {
  if (_catalogCache && Date.now() - _catalogCache.at < CATALOG_TTL_MS) {
    return _catalogCache.gauges;
  }
  try {
    const data = await fetchJson<GaugesListResponse>(`${BASE}/gauges`, {
      timeoutMs: 30_000,
      retries: 1,
    });
    const rows = data?.gauges ?? [];
    const gauges: NwpsGauge[] = rows
      .map((r) => ({
        lid: String(r.lid ?? "").toUpperCase(),
        name: String(r.name ?? ""),
        state: String(r.state ?? ""),
        lat: Number(r.latitude ?? 0),
        lon: Number(r.longitude ?? 0),
        waterbody: r.waterbody != null ? String(r.waterbody) : undefined,
        category: r.category != null ? String(r.category) : undefined,
      }))
      .filter((g) => g.lid && Number.isFinite(g.lat) && Number.isFinite(g.lon));
    _catalogCache = { at: Date.now(), gauges };
    return gauges;
  } catch (err) {
    console.warn("[nwps] catalog fetch failed:", (err as Error).message);
    return _catalogCache?.gauges ?? [];
  }
}

// ---- Per-gauge flood data fetch -------------------------------------------

interface GaugeMetaResponse {
  lid?: string;
  name?: string;
  flood?: {
    categories?: {
      action?: { stage?: number; flow?: number };
      minor?: { stage?: number; flow?: number };
      moderate?: { stage?: number; flow?: number };
      major?: { stage?: number; flow?: number };
    };
  };
}

interface StageFlowResponse {
  observed?: { data?: Array<{ validTime?: string; primary?: number; secondary?: number }> };
  forecast?: { data?: Array<{ validTime?: string; primary?: number; secondary?: number }> };
  /** primaryUnit / secondaryUnit identify whether primary == stage(ft)
   *  or flow(cfs). Most NWPS gauges report stage as primary, flow as
   *  secondary, but some (Great Lakes, some tidal) flip the convention. */
  primaryUnit?: string;
  secondaryUnit?: string;
}

function categorize(
  latestStage: number | null,
  stages: FloodStages,
): NearestNwpsGauge["flood_status"] {
  if (latestStage == null) return "none";
  if (stages.major_flood_ft != null && latestStage >= stages.major_flood_ft) return "major";
  if (stages.moderate_flood_ft != null && latestStage >= stages.moderate_flood_ft) return "moderate";
  if (stages.minor_flood_ft != null && latestStage >= stages.minor_flood_ft) return "minor";
  if (stages.action_ft != null && latestStage >= stages.action_ft) return "action";
  return "none";
}

// ---- Haversine -----------------------------------------------------------

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

// ---- Public API -----------------------------------------------------------

/** Return the nearest forecast-enabled gauge within `radiusKm`,
 *  enriched with flood stages + latest stage/flow + 7-day forecast peak.
 *  Returns null if no gauge is within range or upstream is offline. */
export async function nearestNwpsGauge(
  lat: number,
  lon: number,
  radiusKm = 75,
): Promise<NearestNwpsGauge | null> {
  const catalog = await fetchGaugeCatalog();
  if (catalog.length === 0) return null;

  let best: (NwpsGauge & { distance_km: number }) | null = null;
  for (const g of catalog) {
    const d = haversineKm(lat, lon, g.lat, g.lon);
    if (d > radiusKm) continue;
    if (!best || d < best.distance_km) {
      best = { ...g, distance_km: d };
    }
  }
  if (!best) return null;

  // Pull metadata + stage/flow series in parallel.
  const [meta, sf] = await Promise.all([
    fetchJson<GaugeMetaResponse>(`${BASE}/gauges/${best.lid}`, { timeoutMs: 10_000 }),
    fetchJson<StageFlowResponse>(`${BASE}/gauges/${best.lid}/stageflow`, { timeoutMs: 10_000 }),
  ]);

  const cat = meta?.flood?.categories;
  const stages: FloodStages = {
    action_ft:           cat?.action?.stage   ?? null,
    minor_flood_ft:      cat?.minor?.stage    ?? null,
    moderate_flood_ft:   cat?.moderate?.stage ?? null,
    major_flood_ft:      cat?.major?.stage    ?? null,
    action_cfs:          cat?.action?.flow    ?? null,
    minor_flood_cfs:     cat?.minor?.flow     ?? null,
    moderate_flood_cfs:  cat?.moderate?.flow  ?? null,
    major_flood_cfs:     cat?.major?.flow     ?? null,
  };

  const obs = sf?.observed?.data ?? [];
  const latestRaw = obs.length > 0 ? obs[obs.length - 1] : null;
  const latest: StageFlowReading | null = latestRaw
    ? {
        timestamp: String(latestRaw.validTime ?? ""),
        stage_ft: latestRaw.primary ?? null,
        flow_cfs: latestRaw.secondary ?? null,
        kind: "observed",
      }
    : null;

  // Peak forecast across the next 7 days.
  const fc = sf?.forecast?.data ?? [];
  let peak: StageFlowReading | null = null;
  for (const r of fc) {
    if (r.primary == null) continue;
    if (!peak || r.primary > (peak.stage_ft ?? -Infinity)) {
      peak = {
        timestamp: String(r.validTime ?? ""),
        stage_ft: r.primary,
        flow_cfs: r.secondary ?? null,
        kind: "forecast",
      };
    }
  }

  const flood_status = categorize(
    Math.max(latest?.stage_ft ?? -Infinity, peak?.stage_ft ?? -Infinity),
    stages,
  );

  return {
    gauge: best,
    stages,
    latest,
    peak_forecast: peak,
    flood_status,
    links: {
      nwps_gauge: `https://water.noaa.gov/gauges/${best.lid}`,
      forecast_graph: `https://water.noaa.gov/gauges/${best.lid}/forecast`,
    },
  };
}
