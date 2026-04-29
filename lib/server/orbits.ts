/** Live public satellite positions via TLE elements + SGP4.
 *
 *  We fetch each curated satellite's current Two-Line Element by NORAD ID
 *  from tle.ivanstanojevic.me (a clean, free, no-auth public TLE mirror)
 *  and propagate with satellite.js. CelesTrak is the authoritative source
 *  but blocks server IPs aggressively (IIS 403); this mirror tracks
 *  CelesTrak and serves the same data without an IP allow-list.
 */

import {
  eciToGeodetic,
  degreesLat,
  degreesLong,
  gstime,
  twoline2satrec,
  propagate,
} from "satellite.js";
import { fetchJson } from "./fetcher";

type OrbitGroup = "stations" | "weather" | "resource";

interface TleApiResp {
  satelliteId: number;
  name: string;
  date: string;
  line1: string;
  line2: string;
}

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

const TLE_API = "https://tle.ivanstanojevic.me/api/tle";

interface CuratedEntry {
  norad: number;
  group: OrbitGroup;
  mission: string;
  imagery_url: string | null;
  public_url: string;
}

const CURATED: CuratedEntry[] = [
  { norad: 25544, group: "stations", mission: "Human spaceflight / low Earth orbit",
    imagery_url: "https://www.nasa.gov/international-space-station/space-station-live/",
    public_url: "https://spotthestation.nasa.gov/tracking_map.cfm" },
  { norad: 60133, group: "weather", mission: "NOAA GOES East weather satellite",
    imagery_url: "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/GOES19-CONUS-GEOCOLOR-625x375.gif",
    public_url: "https://www.star.nesdis.noaa.gov/GOES/" },
  { norad: 51850, group: "weather", mission: "NOAA GOES West weather satellite",
    imagery_url: "https://cdn.star.nesdis.noaa.gov/GOES18/ABI/FD/GEOCOLOR/GOES18-FD-GEOCOLOR-1808x1808.gif",
    public_url: "https://www.star.nesdis.noaa.gov/GOES/" },
  { norad: 54234, group: "weather", mission: "NOAA JPSS polar weather satellite",
    imagery_url: null,
    public_url: "https://www.nesdis.noaa.gov/current-satellite-missions/currently-flying/joint-polar-satellite-system" },
  { norad: 43013, group: "weather", mission: "NOAA JPSS polar weather satellite",
    imagery_url: null,
    public_url: "https://www.nesdis.noaa.gov/current-satellite-missions/currently-flying/joint-polar-satellite-system" },
  { norad: 37849, group: "weather", mission: "NOAA/NASA polar weather satellite",
    imagery_url: null,
    public_url: "https://www.nesdis.noaa.gov/current-satellite-missions/currently-flying/suomi-npp" },
  { norad: 25994, group: "resource", mission: "NASA EOS Terra Earth-observing satellite",
    imagery_url: null, public_url: "https://terra.nasa.gov/" },
  { norad: 27424, group: "resource", mission: "NASA EOS Aqua Earth-observing satellite",
    imagery_url: null, public_url: "https://aqua.nasa.gov/" },
  { norad: 49260, group: "resource", mission: "NASA/USGS Landsat Earth-observing satellite",
    imagery_url: null, public_url: "https://www.usgs.gov/landsat-missions/landsat-9" },
  { norad: 39084, group: "resource", mission: "NASA/USGS Landsat Earth-observing satellite",
    imagery_url: null, public_url: "https://www.usgs.gov/landsat-missions/landsat-8" },
  { norad: 40697, group: "resource", mission: "Copernicus optical Earth-observing satellite",
    imagery_url: null, public_url: "https://sentiwiki.copernicus.eu/web/s2-mission" },
  { norad: 42063, group: "resource", mission: "Copernicus optical Earth-observing satellite",
    imagery_url: null, public_url: "https://sentiwiki.copernicus.eu/web/s2-mission" },
];

interface TleCacheEntry { at: number; tle: TleApiResp }
const tleCache: Map<number, TleCacheEntry> = new Map();
const TLE_TTL_MS = 2 * 60 * 60_000;

async function fetchTle(norad: number): Promise<TleApiResp | null> {
  const cached = tleCache.get(norad);
  if (cached && Date.now() - cached.at < TLE_TTL_MS) return cached.tle;
  try {
    const data = await fetchJson<TleApiResp>(`${TLE_API}/${norad}`, { timeoutMs: 12_000 });
    if (data && data.line1 && data.line2) {
      tleCache.set(norad, { at: Date.now(), tle: data });
      return data;
    }
  } catch (err) {
    console.warn(`[orbits] TLE fetch failed for NORAD ${norad}:`, (err as Error).message);
  }
  // Serve stale rather than empty if we have it.
  return cached ? cached.tle : null;
}

function stateAt(satrec: ReturnType<typeof twoline2satrec>, at: Date): {
  lat: number;
  lon: number;
  alt_km: number;
  velocity_km_s: number | null;
} | null {
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

function trackFor(satrec: ReturnType<typeof twoline2satrec>, periodMin: number, now: Date): OrbitTrackPoint[] {
  const points: OrbitTrackPoint[] = [];
  for (let i = -6; i <= 12; i++) {
    const at = new Date(now.getTime() + (i * periodMin * 60_000) / 12);
    const state = stateAt(satrec, at);
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
  const tles = await Promise.all(CURATED.map((c) => fetchTle(c.norad)));

  const sats: LiveSatellite[] = [];
  for (let i = 0; i < CURATED.length; i++) {
    const tle = tles[i];
    if (!tle) continue;
    const item = CURATED[i];
    const satrec = twoline2satrec(tle.line1, tle.line2);
    const state = stateAt(satrec, now);
    if (!state) continue;
    // satellite.js's SatRec has internal fields (no, inclo) accessible as untyped.
    const sr = satrec as unknown as { no: number; inclo: number };
    // sr.no is mean motion in radians/minute. Period (min) = 2π / no.
    const periodMin = sr.no > 0 ? (2 * Math.PI) / sr.no : 90;
    const inclinationDeg = (sr.inclo * 180) / Math.PI;

    sats.push({
      id: tle.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      name: tle.name,
      norad_id: item.norad,
      group: item.group,
      mission: item.mission,
      epoch: tle.date,
      lat: state.lat,
      lon: state.lon,
      altitude_km: state.alt_km,
      velocity_km_s: state.velocity_km_s,
      inclination_deg: Math.round(inclinationDeg * 10) / 10,
      period_min: Math.round(periodMin * 10) / 10,
      visual_altitude: state.alt_km > 5000 ? 0.12 : 0.045,
      updated_at: now.toISOString(),
      imagery_url: item.imagery_url,
      public_url: item.public_url,
      track: trackFor(satrec, periodMin, now),
    });
  }
  return sats.sort((a, b) => a.name.localeCompare(b.name));
}
