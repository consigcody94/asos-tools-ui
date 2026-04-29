/** Live public satellite positions via CelesTrak GP data + SGP4.
 *
 *  CelesTrak publishes current General Perturbations orbital elements. We
 *  propagate those elements server-side with satellite.js and expose a small
 *  operationally relevant catalog to the UI.
 */

import {
  eciToGeodetic,
  degreesLat,
  degreesLong,
  gstime,
  json2satrec,
  propagate,
} from "satellite.js";
import { fetchJson } from "./fetcher";

type OrbitGroup = "stations" | "weather" | "resource";

interface CelestrakGp {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  EPHEMERIS_TYPE: number;
  CLASSIFICATION_TYPE: string;
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
}

type SatelliteJsonInput = Parameters<typeof json2satrec>[0];

export interface OrbitTrackPoint {
  lat: number;
  lon: number;
  alt_km: number;
  at: string;
}

export interface LiveSatellite {
  id: string;
  name: string;
  norad_id: number;
  group: OrbitGroup;
  mission: string;
  epoch: string;
  lat: number;
  lon: number;
  altitude_km: number;
  velocity_km_s: number | null;
  inclination_deg: number;
  period_min: number;
  visual_altitude: number;
  updated_at: string;
  imagery_url: string | null;
  public_url: string;
  track: OrbitTrackPoint[];
}

const CELESTRAK = "https://celestrak.org/NORAD/elements/gp.php";

const CURATED = [
  {
    match: "ISS (ZARYA)",
    group: "stations" as const,
    mission: "Human spaceflight / low Earth orbit",
    imagery_url: "https://www.nasa.gov/international-space-station/space-station-live/",
    public_url: "https://spotthestation.nasa.gov/tracking_map.cfm",
  },
  {
    match: "GOES 19",
    group: "weather" as const,
    mission: "NOAA GOES East weather satellite",
    imagery_url: "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/GOES19-CONUS-GEOCOLOR-625x375.gif",
    public_url: "https://www.star.nesdis.noaa.gov/GOES/",
  },
  {
    match: "GOES 18",
    group: "weather" as const,
    mission: "NOAA GOES West weather satellite",
    imagery_url: "https://cdn.star.nesdis.noaa.gov/GOES18/ABI/FD/GEOCOLOR/GOES18-FD-GEOCOLOR-1808x1808.gif",
    public_url: "https://www.star.nesdis.noaa.gov/GOES/",
  },
  {
    match: "NOAA 21 (JPSS-2)",
    group: "weather" as const,
    mission: "NOAA JPSS polar weather satellite",
    imagery_url: "https://worldview.earthdata.nasa.gov/",
    public_url: "https://www.nesdis.noaa.gov/current-satellite-missions/currently-flying/joint-polar-satellite-system",
  },
  {
    match: "NOAA 20 (JPSS-1)",
    group: "weather" as const,
    mission: "NOAA JPSS polar weather satellite",
    imagery_url: "https://worldview.earthdata.nasa.gov/",
    public_url: "https://www.nesdis.noaa.gov/current-satellite-missions/currently-flying/joint-polar-satellite-system",
  },
  {
    match: "SUOMI NPP",
    group: "weather" as const,
    mission: "NOAA/NASA polar weather satellite",
    imagery_url: "https://worldview.earthdata.nasa.gov/",
    public_url: "https://www.nesdis.noaa.gov/current-satellite-missions/currently-flying/suomi-npp",
  },
  {
    match: "TERRA",
    group: "resource" as const,
    mission: "NASA EOS Terra Earth-observing satellite",
    imagery_url: "https://worldview.earthdata.nasa.gov/",
    public_url: "https://terra.nasa.gov/",
  },
  {
    match: "AQUA",
    group: "resource" as const,
    mission: "NASA EOS Aqua Earth-observing satellite",
    imagery_url: "https://worldview.earthdata.nasa.gov/",
    public_url: "https://aqua.nasa.gov/",
  },
  {
    match: "LANDSAT 9",
    group: "resource" as const,
    mission: "NASA/USGS Landsat Earth-observing satellite",
    imagery_url: "https://landsatlook.usgs.gov/",
    public_url: "https://www.usgs.gov/landsat-missions/landsat-9",
  },
  {
    match: "LANDSAT 8",
    group: "resource" as const,
    mission: "NASA/USGS Landsat Earth-observing satellite",
    imagery_url: "https://landsatlook.usgs.gov/",
    public_url: "https://www.usgs.gov/landsat-missions/landsat-8",
  },
  {
    match: "SENTINEL-2A",
    group: "resource" as const,
    mission: "Copernicus optical Earth-observing satellite",
    imagery_url: "https://browser.dataspace.copernicus.eu/",
    public_url: "https://sentiwiki.copernicus.eu/web/s2-mission",
  },
  {
    match: "SENTINEL-2B",
    group: "resource" as const,
    mission: "Copernicus optical Earth-observing satellite",
    imagery_url: "https://browser.dataspace.copernicus.eu/",
    public_url: "https://sentiwiki.copernicus.eu/web/s2-mission",
  },
];

let groupCache: Partial<Record<OrbitGroup, { at: number; rows: CelestrakGp[] }>> = {};
const GROUP_TTL_MS = 2 * 60 * 60_000;

async function groupElements(group: OrbitGroup): Promise<CelestrakGp[]> {
  const cached = groupCache[group];
  if (cached && Date.now() - cached.at < GROUP_TTL_MS) return cached.rows;

  const data = await fetchJson<CelestrakGp[]>(CELESTRAK, {
    query: { GROUP: group, FORMAT: "json" },
    timeoutMs: 20_000,
  });
  const rows = Array.isArray(data) ? data : [];
  groupCache[group] = { at: Date.now(), rows };
  return rows;
}

function stateAt(row: CelestrakGp, at: Date): {
  lat: number;
  lon: number;
  alt_km: number;
  velocity_km_s: number | null;
} | null {
  const satrec = json2satrec(row as unknown as SatelliteJsonInput);
  const pv = propagate(satrec, at);
  if (!pv.position || typeof pv.position === "boolean") return null;
  const gmst = gstime(at);
  const gd = eciToGeodetic(pv.position, gmst);
  const velocity =
    pv.velocity && typeof pv.velocity !== "boolean"
      ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z)
      : null;
  return {
    lat: Math.round(degreesLat(gd.latitude) * 1000) / 1000,
    lon: Math.round(degreesLong(gd.longitude) * 1000) / 1000,
    alt_km: Math.round(gd.height * 10) / 10,
    velocity_km_s: velocity != null ? Math.round(velocity * 100) / 100 : null,
  };
}

function trackFor(row: CelestrakGp, now: Date): OrbitTrackPoint[] {
  const periodMin = 1440 / row.MEAN_MOTION;
  const points: OrbitTrackPoint[] = [];
  for (let i = -6; i <= 12; i++) {
    const at = new Date(now.getTime() + (i * periodMin * 60_000) / 12);
    const state = stateAt(row, at);
    if (state) {
      points.push({
        lat: state.lat,
        lon: state.lon,
        alt_km: state.alt_km,
        at: at.toISOString(),
      });
    }
  }
  return points;
}

export async function liveSatellites(): Promise<LiveSatellite[]> {
  const now = new Date();
  const groups = await Promise.all([
    groupElements("stations"),
    groupElements("weather"),
    groupElements("resource"),
  ]);
  const all = groups.flat();

  const sats: LiveSatellite[] = [];
  for (const item of CURATED) {
    const row = all.find((r) => r.OBJECT_NAME === item.match);
    if (!row) continue;
    const state = stateAt(row, now);
    if (!state) continue;
    const periodMin = 1440 / row.MEAN_MOTION;
    sats.push({
      id: row.OBJECT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name: row.OBJECT_NAME,
      norad_id: row.NORAD_CAT_ID,
      group: item.group,
      mission: item.mission,
      epoch: row.EPOCH,
      lat: state.lat,
      lon: state.lon,
      altitude_km: state.alt_km,
      velocity_km_s: state.velocity_km_s,
      inclination_deg: row.INCLINATION,
      period_min: Math.round(periodMin * 10) / 10,
      visual_altitude: state.alt_km > 5000 ? 0.12 : 0.045,
      updated_at: now.toISOString(),
      imagery_url: item.imagery_url,
      public_url: item.public_url,
      track: trackFor(row, now),
    });
  }
  return sats.sort((a, b) => a.name.localeCompare(b.name));
}
