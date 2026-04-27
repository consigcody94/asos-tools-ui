/** Satellite imagery aggregator.
 *
 *  Combines several public, no-auth (or free-tier-public-asset) sources
 *  so each ASOS station drill gets a real archive of recent overhead
 *  imagery, beyond the live GOES animated loop we already render.
 *
 *  Sources wired in this module:
 *    - NASA GIBS WMTS / snapshot — same-day MODIS, VIIRS, etc.
 *    - Element84 Earth-Search STAC — Sentinel-2 L2A and Landsat C2L2 SR
 *      latest scenes by lat/lon, cloud-cover-filtered
 *    - NASA Worldview interactive viewer — deep-link with bbox + date
 *    - Zoom Earth — direct map link (no API; URL builder only)
 *    - Copernicus DataSpace browser deep-link
 *
 *  All bbox math wraps a station with a configurable degree-buffer so
 *  the STAC search hits scenes that overlap the airport itself.
 */

import { fetchJson } from "./fetcher";

// --- Helpers ---------------------------------------------------------------

const todayUtc = (): string => new Date().toISOString().slice(0, 10);
const yyyymmddDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Build a small bbox in degrees around a station coordinate.
 *  Default buffer ≈ 0.15° ≈ 16 km — enough to overlap any single
 *  Sentinel-2 / Landsat tile, small enough to keep STAC search fast. */
function stationBbox(lat: number, lon: number, deg = 0.15): [number, number, number, number] {
  return [lon - deg, lat - deg, lon + deg, lat + deg];
}

// --- 1. NASA GIBS (Global Imagery Browse Services) -------------------------
// WMTS served at gibs.earthdata.nasa.gov/wmts/epsg4326/best/{LAYER}/default/
// {DATE}/{TileMatrixSet}/{z}/{y}/{x}.{ext}. Free, no auth, instant.

export const GIBS_LAYERS = {
  /** True-color terrestrial reflectance (MODIS Terra). */
  modis_terra: { id: "MODIS_Terra_CorrectedReflectance_TrueColor", res: "250m", ext: "jpg" },
  /** True-color terrestrial reflectance (MODIS Aqua). */
  modis_aqua:  { id: "MODIS_Aqua_CorrectedReflectance_TrueColor",  res: "250m", ext: "jpg" },
  /** True-color terrestrial reflectance (VIIRS Suomi-NPP). */
  viirs_snpp:  { id: "VIIRS_SNPP_CorrectedReflectance_TrueColor",  res: "250m", ext: "jpg" },
  /** Bands 3-6-7 false-color — fires + smoke + clouds (VIIRS). */
  viirs_fire:  { id: "VIIRS_SNPP_CorrectedReflectance_BandsM11-I2-I1", res: "250m", ext: "jpg" },
  /** Snow/ice cover (MODIS). */
  modis_snow:  { id: "MODIS_Terra_NDSI_Snow_Cover", res: "500m", ext: "png" },
  /** Sea-surface temperature (VIIRS). */
  sst:         { id: "GHRSST_L4_MUR_Sea_Surface_Temperature", res: "1km",  ext: "png" },
} as const;

export type GibsLayerKey = keyof typeof GIBS_LAYERS;

/** WMTS tile URL — caller picks zoom + tile XY (typically just for tile maps). */
export function gibsTileUrl(
  layer: GibsLayerKey, date: string, z: number, y: number, x: number,
): string {
  const m = GIBS_LAYERS[layer];
  return `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${m.id}/default/${date}/${m.res}/${z}/${y}/${x}.${m.ext}`;
}

/** Single-image snapshot from the GIBS Snapshots service.
 *  Renders a bbox-clipped, dimensions-controlled JPEG/PNG of the layer
 *  for a date — perfect for embedding as a static <img>. */
export function gibsSnapshotUrl(
  layer: GibsLayerKey,
  bbox: [number, number, number, number],   // [west, south, east, north]
  date: string = todayUtc(),
  width = 720, height = 720,
): string {
  const m = GIBS_LAYERS[layer];
  const params = new URLSearchParams({
    REQUEST: "GetSnapshot",
    LAYERS: m.id,
    BBOX: bbox.join(","),
    CRS: "EPSG:4326",
    HEIGHT: String(height),
    WIDTH: String(width),
    FORMAT: m.ext === "png" ? "image/png" : "image/jpeg",
    TIME: date,
  });
  return `https://wvs.earthdata.nasa.gov/api/v1/snapshot?${params.toString()}`;
}

/** Open the NASA Worldview interactive viewer at a bbox + date. */
export function worldviewLink(
  bbox: [number, number, number, number], date: string = todayUtc(),
): string {
  // v=west,south,east,north;t=date;l=layers
  return `https://worldview.earthdata.nasa.gov/?v=${bbox.join(",")}&t=${date}-T12:00:00Z&l=MODIS_Terra_CorrectedReflectance_TrueColor,Reference_Labels_15m,Reference_Features_15m,Coastlines_15m`;
}

// --- 2. Element84 Earth-Search STAC ----------------------------------------
// https://earth-search.aws.element84.com/v1 — open STAC catalog for
// Sentinel-2 L2A + Landsat C2L2 SR + others. Free, no auth.

const STAC_BASE = "https://earth-search.aws.element84.com/v1";

export interface StacScene {
  id: string;
  collection: string;
  datetime: string;           // ISO
  cloud_cover: number | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  worldview_link: string;
  cog_visual_url: string | null;  // True-color GeoTIFF (Sentinel-2)
  platform: string | null;
}

async function searchStac(
  collection: "sentinel-2-l2a" | "landsat-c2l2-sr",
  bbox: [number, number, number, number],
  opts: { limit?: number; maxCloudPct?: number; daysBack?: number } = {},
): Promise<StacScene[]> {
  const { limit = 4, maxCloudPct = 30, daysBack = 60 } = opts;
  // Element84's index doesn't support sortby on `datetime` directly —
  // use `properties.datetime` and a date-range filter to keep results
  // fresh.
  const start = yyyymmddDaysAgo(daysBack);
  const data = await fetchJson<{ features?: StacFeature[] }>(
    `${STAC_BASE}/search`,
    {
      query: {
        collections: collection,
        bbox: bbox.join(","),
        datetime: `${start}T00:00:00Z/..`,
        limit: String(limit * 4),    // overfetch then filter
        sortby: "-properties.datetime",
      },
      timeoutMs: 20_000,
    },
  );
  if (!data?.features) return [];
  return data.features
    .filter((f) => {
      const cc = f.properties?.["eo:cloud_cover"];
      return typeof cc !== "number" || cc <= maxCloudPct;
    })
    .slice(0, limit)
    .map((f) => normaliseStac(f, collection, bbox));
}

interface StacFeature {
  id: string;
  collection?: string;
  properties: Record<string, unknown>;
  assets: Record<string, { href?: string; type?: string }>;
}

function normaliseStac(
  f: StacFeature, collection: string, bbox: [number, number, number, number],
): StacScene {
  const p = f.properties;
  const a = f.assets || {};
  const datetime = String(p.datetime ?? "");
  return {
    id: f.id,
    collection,
    datetime,
    cloud_cover: typeof p["eo:cloud_cover"] === "number" ? p["eo:cloud_cover"] : null,
    thumbnail_url: a.thumbnail?.href ?? a["thumbnail-jp2"]?.href ?? null,
    preview_url: a.preview?.href ?? a.thumbnail?.href ?? null,
    cog_visual_url: a.visual?.href ?? null,
    worldview_link: worldviewLink(bbox, datetime.slice(0, 10) || todayUtc()),
    platform: typeof p.platform === "string" ? p.platform : null,
  };
}

export async function latestSentinel2(
  lat: number, lon: number, opts?: { limit?: number; maxCloudPct?: number; daysBack?: number },
): Promise<StacScene[]> {
  return searchStac("sentinel-2-l2a", stationBbox(lat, lon), opts);
}

export async function latestLandsat(
  lat: number, lon: number, opts?: { limit?: number; maxCloudPct?: number; daysBack?: number },
): Promise<StacScene[]> {
  return searchStac("landsat-c2l2-sr", stationBbox(lat, lon), opts);
}

// --- 3. External viewer deep-links (no API; URL builders) ------------------

export function copernicusBrowserLink(lat: number, lon: number, date = todayUtc()): string {
  // Copernicus Browser opens at lat/lon/zoom with a default Sentinel-2 layer.
  return `https://browser.dataspace.copernicus.eu/?zoom=11&lat=${lat}&lng=${lon}&themeId=DEFAULT-THEME&datasetId=S2_L2A_CDAS&fromTime=${date}T00:00:00.000Z&toTime=${date}T23:59:59.999Z`;
}

export function zoomEarthLink(lat: number, lon: number): string {
  return `https://zoom.earth/maps/satellite/#view=${lat},${lon},10z`;
}

export function eosdaLandViewerLink(lat: number, lon: number): string {
  return `https://eos.com/landviewer/?lat=${lat}&lng=${lon}&z=11`;
}

export function sentinelHubEoBrowserLink(lat: number, lon: number, date = todayUtc()): string {
  // Free EO Browser on Sentinel Hub — same Sentinel-2 with a different UI.
  return `https://apps.sentinel-hub.com/eo-browser/?zoom=11&lat=${lat}&lng=${lon}&themeId=DEFAULT-THEME&visualizationUrl=https://services.sentinel-hub.com/ogc/wms/bd86bcc0-f318-402b-a145-015f85b9427e&datasetId=S2L2A&fromTime=${date}T00:00:00.000Z&toTime=${date}T23:59:59.999Z`;
}

// --- 4. Aggregated station imagery --------------------------------------

export interface StationImagery {
  station: { lat: number; lon: number };
  bbox: [number, number, number, number];
  /** GIBS daily snapshots — different layers, same bbox + today/yesterday. */
  gibs: Array<{
    layer: GibsLayerKey;
    label: string;
    date: string;
    url: string;
  }>;
  /** Latest cloud-filtered scenes from STAC. */
  sentinel2: StacScene[];
  landsat: StacScene[];
  /** External viewer deep-links the user can open in a new tab. */
  links: {
    nasa_worldview: string;
    copernicus_browser: string;
    zoom_earth: string;
    eosda_landviewer: string;
    sentinel_hub: string;
  };
}

export async function stationImagery(
  lat: number, lon: number,
  opts: { stacLimit?: number; maxCloudPct?: number } = {},
): Promise<StationImagery> {
  const bbox = stationBbox(lat, lon);
  const today = todayUtc();
  const yesterday = yyyymmddDaysAgo(1);

  const gibs: StationImagery["gibs"] = [
    { layer: "modis_terra", label: "MODIS Terra true-color (today)",          date: today,     url: gibsSnapshotUrl("modis_terra", bbox, today,     720, 720) },
    { layer: "modis_aqua",  label: "MODIS Aqua true-color (today)",           date: today,     url: gibsSnapshotUrl("modis_aqua",  bbox, today,     720, 720) },
    { layer: "viirs_snpp",  label: "VIIRS SNPP true-color (today)",           date: today,     url: gibsSnapshotUrl("viirs_snpp",  bbox, today,     720, 720) },
    { layer: "viirs_fire",  label: "VIIRS fire/smoke false-color (yesterday)", date: yesterday, url: gibsSnapshotUrl("viirs_fire",  bbox, yesterday, 720, 720) },
  ];

  const [sentinel2, landsat] = await Promise.all([
    latestSentinel2(lat, lon, { limit: opts.stacLimit ?? 3, maxCloudPct: opts.maxCloudPct ?? 30 }),
    latestLandsat(lat, lon, { limit: opts.stacLimit ?? 3, maxCloudPct: opts.maxCloudPct ?? 40 }),
  ]);

  return {
    station: { lat, lon },
    bbox,
    gibs,
    sentinel2,
    landsat,
    links: {
      nasa_worldview:     worldviewLink(bbox, today),
      copernicus_browser: copernicusBrowserLink(lat, lon, today),
      zoom_earth:         zoomEarthLink(lat, lon),
      eosda_landviewer:   eosdaLandViewerLink(lat, lon),
      sentinel_hub:       sentinelHubEoBrowserLink(lat, lon, today),
    },
  };
}
