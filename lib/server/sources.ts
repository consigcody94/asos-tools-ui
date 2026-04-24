/** Source-of-truth registry for every upstream feed OWL consumes.
 *  Surfaced on the Admin tab so operators can see provenance.
 *
 *  ``rate_limit`` mirrors lib/server/fetcher.ts HOST_LIMITS so the
 *  public registry shows exactly what bucket our fetcher enforces.
 */

export interface Source {
  name: string;
  url: string;
  used_for: string;
  auth: string;
  cadence: string;
  trust: "agency" | "mirror" | "aggregator" | "crowdsourced";
  notes: string;
  /** Published or empirical rate limit, as enforced by fetcher.ts. */
  rate_limit: string;
}

export const SOURCES: Source[] = [
  {
    name: "Iowa Environmental Mesonet (IEM)",
    url: "https://mesonet.agron.iastate.edu",
    used_for: "Primary METAR + 1-minute ASOS fetch, network scans",
    auth: "none", cadence: "near real-time", trust: "mirror",
    rate_limit: "3 req/s (empirical — asos.py stricter; bucket serialises batches)",
    notes: "Academic mirror of NCEI/NOAA archives. Free, fast, no API key.",
  },
  {
    name: "NOAA NCEI Access Services",
    url: "https://www.ncei.noaa.gov/access/services/data/v1",
    used_for: "Fallback when IEM is unavailable",
    auth: "none", cadence: "hourly", trust: "agency",
    rate_limit: "5 req/s (safe default)",
    notes: "Authoritative NCEI archive. Slower than IEM.",
  },
  {
    name: "NWS api.weather.gov",
    url: "https://api.weather.gov",
    used_for: "Current conditions + active CAP alerts",
    auth: "UA header required", cadence: "real-time", trust: "agency",
    rate_limit: "5 req/s (documented)",
    notes: "Public API; rate-limited to ~5 req/s per client.",
  },
  {
    name: "Aviation Weather Center (AWC)",
    url: "https://aviationweather.gov/api/data",
    used_for: "METAR / TAF / SIGMET / AIRMET / PIREP / AFD",
    auth: "none", cadence: "real-time", trust: "agency",
    rate_limit: "2 req/s (conservative — no published limit)",
    notes: "FAA-supported public API.",
  },
  {
    name: "NWS RIDGE NEXRAD",
    url: "https://radar.weather.gov/ridge/standard",
    used_for: "Per-station WSR-88D animated radar loops (159 sites)",
    auth: "none", cadence: "5 min", trust: "agency",
    rate_limit: "10 req/s (CDN, client-loaded images)",
    notes: "159 sites; nearest-neighbor pick; CONUS composite fallback.",
  },
  {
    name: "NESDIS GOES-19 East",
    url: "https://cdn.star.nesdis.noaa.gov/GOES19",
    used_for: "Satellite loops — CONUS + NE/SE/UMV/SMV/NR/SR/PR sectors",
    auth: "none", cadence: "5 min (CONUS), 1 min (MESO)", trust: "agency",
    rate_limit: "10 req/s (CDN, client-loaded images)",
    notes: "Pre-rendered animated GIF loops per sector.",
  },
  {
    name: "NESDIS GOES-18 West",
    url: "https://cdn.star.nesdis.noaa.gov/GOES18",
    used_for: "Satellite loops — AK / HI / PNW / PSW (Pacific coverage)",
    auth: "none", cadence: "5 min", trust: "agency",
    rate_limit: "10 req/s (CDN, client-loaded images)",
    notes: "Alaska sector ships at 1000x1000; HI/PNW/PSW at 600x600.",
  },
  {
    name: "USGS Earthquake Hazards",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary",
    used_for: "Per-site quake correlation for sensor dropouts",
    auth: "none", cadence: "~1 min", trust: "agency",
    rate_limit: "5 req/s (reasonable use policy)",
    notes: "CC0 data. Feeds: all_hour, 2.5_day, significant_week.",
  },
  {
    name: "NOAA NHC CurrentStorms",
    url: "https://www.nhc.noaa.gov/CurrentStorms.json",
    used_for: "Active tropical cyclones (Atl + E/C Pacific)",
    auth: "none", cadence: "as advisories issue", trust: "agency",
    rate_limit: "1 req/s (static JSON, polite default)",
    notes: "Empty in off-season.",
  },
  {
    name: "NOAA NDBC buoys",
    url: "https://www.ndbc.noaa.gov/data/realtime2",
    used_for: "Marine met obs — coastal ASOS cross-check",
    auth: "none", cadence: "10–30 min per station", trust: "agency",
    rate_limit: "1 req/s per station",
    notes: "402 met-enabled buoys bundled in-repo.",
  },
  {
    name: "FAA WeatherCams",
    url: "https://weathercams.faa.gov",
    used_for: "Nearest-cam still-image thumbnails & loops",
    auth: "browser headers", cadence: "10 min", trust: "agency",
    rate_limit: "10 req/s (CDN-safe)",
    notes: "Public imagery API; 260 FAA + ~530 hosted sites.",
  },
  {
    name: "NOAA SWPC",
    url: "https://services.swpc.noaa.gov",
    used_for: "Kp / X-ray flux / geomagnetic alerts",
    auth: "none", cadence: "1–3 min", trust: "agency",
    rate_limit: "1 req / 60 s per feed (SWPC's documented ceiling)",
    notes: "Space Weather Prediction Center product line.",
  },
  {
    name: "FAA NOTAM API",
    url: "https://external-api.faa.gov/notamapi/v1/notams",
    used_for: "Per-station planned-outage correlation",
    auth: "client_id + client_secret (FAA_NOTAM_CLIENT_ID / _SECRET)",
    cadence: "real-time", trust: "agency",
    rate_limit: "5 req/s per client (documented)",
    notes: "Optional; free FAA developer account required.",
  },
];
