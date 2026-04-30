/** Source-of-truth registry for every upstream feed OWL consumes.
 *  Surfaced on the Admin tab so operators can see provenance.
 *
 *  ``rate_limit`` mirrors lib/server/fetcher.ts HOST_LIMITS so the
 *  public registry shows exactly what bucket our fetcher enforces.
 *
 *  ``wired`` is truth-in-advertising: are we ACTUALLY reading from
 *  this source, or just listing it for context?
 *    - "live"       : code calls this source on user requests
 *    - "fallback"   : reserved as a backup if a primary fails (whether
 *                     wired or not — see notes per entry)
 *    - "documented" : listed for the operator's awareness, not yet
 *                     wired into a route
 *  The Admin tab uses this to render a green/dim status dot per
 *  source so operators don't get a false sense of redundancy.
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
  /** Truth-in-advertising flag — see file header. */
  wired: "live" | "fallback" | "documented";
}

export const SOURCES: Source[] = [
  {
    name: "Iowa Environmental Mesonet (IEM)",
    url: "https://mesonet.agron.iastate.edu",
    used_for: "Primary METAR + 1-minute ASOS fetch, network scans",
    auth: "none", cadence: "near real-time", trust: "mirror",
    rate_limit: "1 request / 5s; 10 min cooldown on IEM slow-down responses",
    notes: "Academic mirror of NCEI/NOAA archives. IP-based rate limit; OWL uses large batches and stale-cache fallback.",
    wired: "live",
  },
  {
    name: "NOAA NCEI Access Services",
    url: "https://www.ncei.noaa.gov/access/services/data/v1",
    used_for: "Authoritative cross-validation of IEM scan classifications",
    auth: "none", cadence: "hourly archive", trust: "agency",
    rate_limit: "≤5 req/s (doc); OWL paces to 3 req/s",
    notes: "Cross-check pass validates 30 disputed stations per scan-cycle. Maintenance-aware: respects NCEI_MAINT_START / NCEI_MAINT_END env vars.",
    wired: "live",
  },
  {
    name: "NOAA NCEI Climate Data Online",
    url: "https://www.ncei.noaa.gov/cdo-web/api/v2",
    used_for: "Normals, daily/monthly summaries, long-horizon climatology for reports",
    auth: "free token", cadence: "archive", trust: "agency",
    rate_limit: "5 req/s + 10,000 req/day per token (documented)",
    notes: "Keyed report lane; configure NCEI_CDO_TOKEN before live use.",
    wired: "documented",
  },
  {
    name: "NWS api.weather.gov",
    url: "https://api.weather.gov",
    used_for: "Current conditions + active CAP alerts",
    auth: "UA header required", cadence: "real-time", trust: "agency",
    rate_limit: "2 req/s conservative; official numeric limit is unpublished",
    notes: "Public API; User-Agent required; cache-friendly responses.",
    wired: "live",
  },
  {
    name: "Aviation Weather Center (AWC)",
    url: "https://aviationweather.gov/api/data",
    used_for: "METAR / TAF / SIGMET / AIRMET / PIREP / AFD",
    auth: "none", cadence: "real-time", trust: "agency",
    rate_limit: "2 req/s (conservative — no published limit)",
    notes: "FAA-supported public API. SIGMET feed cached 5 min in-process.",
    wired: "live",
  },
  {
    name: "NWS RIDGE NEXRAD",
    url: "https://radar.weather.gov/ridge/standard",
    used_for: "Per-station WSR-88D animated radar loops (159 sites)",
    auth: "none", cadence: "5 min", trust: "agency",
    rate_limit: "10 req/s (CDN, client-loaded images)",
    notes: "159 sites; nearest-neighbor pick; CONUS composite fallback.",
    wired: "live",
  },
  {
    name: "NESDIS GOES-19 East",
    url: "https://cdn.star.nesdis.noaa.gov/GOES19",
    used_for: "Satellite loops — CONUS + NE/SE/UMV/SMV/NR/SR/PR sectors",
    auth: "none", cadence: "5 min (CONUS), 1 min (MESO)", trust: "agency",
    rate_limit: "10 req/s (CDN, client-loaded images)",
    notes: "Pre-rendered animated GIF loops per sector.",
    wired: "live",
  },
  {
    name: "NESDIS GOES-18 West",
    url: "https://cdn.star.nesdis.noaa.gov/GOES18",
    used_for: "Satellite loops — AK / HI / PNW / PSW (Pacific coverage)",
    auth: "none", cadence: "5 min", trust: "agency",
    rate_limit: "10 req/s (CDN, client-loaded images)",
    notes: "Alaska sector ships at 1000x1000; HI/PNW/PSW at 600x600.",
    wired: "live",
  },
  {
    name: "USGS Earthquake Hazards",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary",
    used_for: "Per-site quake correlation for sensor dropouts",
    auth: "none", cadence: "~1 min", trust: "agency",
    rate_limit: "5 req/s (reasonable use policy)",
    notes: "CC0 data. Feeds: all_hour, 2.5_day, significant_week.",
    wired: "live",
  },
  {
    name: "NOAA NHC CurrentStorms",
    url: "https://www.nhc.noaa.gov/CurrentStorms.json",
    used_for: "Active tropical cyclones (Atl + E/C Pacific)",
    auth: "none", cadence: "as advisories issue", trust: "agency",
    rate_limit: "1 req/s (static JSON, polite default)",
    notes: "Empty in off-season.",
    wired: "live",
  },
  {
    name: "NOAA NDBC buoys",
    url: "https://www.ndbc.noaa.gov/data/realtime2",
    used_for: "Marine met obs — coastal ASOS cross-check",
    auth: "none", cadence: "10–30 min per station", trust: "agency",
    rate_limit: "1 req/s per station",
    notes: "402 met-enabled buoys bundled in-repo. Status feed comes from latest_obs.txt.",
    wired: "live",
  },
  {
    name: "NOAA CO-OPS Data + Metadata APIs",
    url: "https://api.tidesandcurrents.noaa.gov",
    used_for: "Nearest coastal water level, wind, pressure, temperature, and station metadata",
    auth: "none", cadence: "latest to 1 min", trust: "agency",
    rate_limit: "1 req/s sustained (safe default; station metadata cached 6h)",
    notes: "NOS NWLON/PORTS correlation for coastal ASOS investigations.",
    wired: "live",
  },
  {
    name: "FAA WeatherCams",
    url: "https://weathercams.faa.gov",
    used_for: "Nearest-cam still-image thumbnails & loops",
    auth: "browser headers", cadence: "10 min", trust: "agency",
    rate_limit: "10 req/s (CDN-safe)",
    notes: "Public imagery API; 260 FAA + ~530 hosted sites.",
    wired: "live",
  },
  {
    name: "NOAA SWPC",
    url: "https://services.swpc.noaa.gov",
    used_for: "Kp / X-ray flux / geomagnetic alerts",
    auth: "none", cadence: "1–3 min", trust: "agency",
    rate_limit: "1 req / 60 s per feed (SWPC's documented ceiling)",
    notes: "Space Weather Prediction Center product line.",
    wired: "live",
  },
  {
    name: "FAA NOTAM API",
    url: "https://external-api.faa.gov/notamapi/v1/notams",
    used_for: "Per-station planned-outage correlation",
    auth: "client_id + client_secret (FAA_NOTAM_CLIENT_ID / _SECRET)",
    cadence: "real-time", trust: "agency",
    rate_limit: "5 req/s per client (documented)",
    notes: "Optional; free FAA developer account required. Wired only when both env vars are set.",
    wired: "fallback",
  },
  {
    name: "NOAA NWPS",
    url: "https://api.water.noaa.gov/nwps/v1",
    used_for: "River observations, official streamflow forecasts, National Water Model, flood categories",
    auth: "none", cadence: "real-time + forecast", trust: "agency",
    rate_limit: "1 req/s (safe default)",
    notes: "Ready next for hydrology/flood proximity around inland ASOS sites.",
    wired: "documented",
  },
  {
    name: "NOAA NOMADS",
    url: "https://nomads.ncep.noaa.gov",
    used_for: "GFS / HRRR / RAP / NAM / GEFS / MOS model data via GRIB filters",
    auth: "none", cadence: "hourly to 6-hourly", trust: "agency",
    rate_limit: "0.5 req/s (large-file safe default)",
    notes: "Use point/subset manifests first; defer GRIB decoding to worker service.",
    wired: "documented",
  },
  {
    name: "NOAA MRMS",
    url: "https://mrms.ncep.noaa.gov/data",
    used_for: "Multi-radar multi-sensor reflectivity, QPE, hail, rotation and precipitation products",
    auth: "none", cadence: "real-time", trust: "agency",
    rate_limit: "0.5 req/s (large-file safe default)",
    notes: "Operational GRIB2 products from NCEP HTTP; report manifests before rendered products.",
    wired: "documented",
  },
  {
    name: "NOAA NEXRAD on NODD",
    url: "https://registry.opendata.aws/noaa-nexrad/",
    used_for: "NEXRAD Level II/III forensic object manifests and radar evidence reports",
    auth: "none", cadence: "as scans arrive", trust: "agency",
    rate_limit: "n/a (public cloud object storage; use no-sign requests)",
    notes: "Current buckets: unidata-nexrad-level2, unidata-nexrad-level2-chunks, unidata-nexrad-level3.",
    wired: "documented",
  },
  {
    name: "NOAA GOES-R on NODD",
    url: "https://registry.opendata.aws/noaa-goes/",
    used_for: "GOES-18/19 ABI and GLM raw product manifests for satellite evidence",
    auth: "none", cadence: "as products arrive", trust: "agency",
    rate_limit: "n/a (public cloud object storage)",
    notes: "Complements STAR CDN loops with raw product provenance.",
    wired: "documented",
  },
  {
    name: "NWS OGC / ArcGIS map services",
    url: "https://mapservices.weather.noaa.gov",
    used_for: "Radar mosaics, local storm reports, watches/warnings, QPE and map overlays",
    auth: "none", cadence: "time-enabled near real-time", trust: "agency",
    rate_limit: "2 req/s (safe default)",
    notes: "Active WWA polygons live on this host; powers /api/overlays/wwa.",
    wired: "live",
  },
  {
    name: "NOAA nowCOAST",
    url: "https://nowcoast.noaa.gov",
    used_for: "Coastal and marine observations, warnings, radar, satellite and ocean model map services",
    auth: "none", cadence: "near real-time", trust: "agency",
    rate_limit: "2 req/s (safe default)",
    notes: "Ready for coastal ASOS mode and integrated evidence maps.",
    wired: "documented",
  },
  {
    name: "NOAA MADIS",
    url: "https://madis-data.ncep.noaa.gov",
    used_for: "Public/guest QC observations and dense mesonet context around ASOS outages",
    auth: "public/guest + restricted tiers", cadence: "real-time + archive", trust: "agency",
    rate_limit: "0.5 req/s (safe default)",
    notes: "Research lane; use public surface dumps first, restricted feeds only if configured.",
    wired: "documented",
  },
  {
    name: "NASA GIBS / Worldview",
    url: "https://gibs.earthdata.nasa.gov",
    used_for: "MODIS / VIIRS true-color, fire/smoke, snow, SST snapshots per station",
    auth: "none", cadence: "daily", trust: "agency",
    rate_limit: "no published limit (CDN-served)",
    notes: "WMTS tiles + GetSnapshot bbox renderer; deep-link to Worldview viewer.",
    wired: "documented",
  },
  {
    name: "NASA EONET",
    url: "https://eonet.gsfc.nasa.gov/api/v3/events",
    used_for: "Near-real-time global natural event feed for command-center context",
    auth: "none", cadence: "near real-time", trust: "agency",
    rate_limit: "1 req/s sustained (safe default)",
    notes: "Open events include wildfires, severe storms, volcanoes, sea/lake ice, floods, dust, and related hazards.",
    wired: "live",
  },
  {
    name: "CelesTrak GP orbital elements",
    url: "https://celestrak.org/NORAD/elements/gp.php",
    used_for: "Live satellite positions and orbit propagation for ISS, NOAA, NASA, USGS and Copernicus assets",
    auth: "none", cadence: "updated multiple times daily", trust: "aggregator",
    rate_limit: "1 req/s sustained, cached 2h",
    notes: "Public GP/TLE data propagated with SGP4 via satellite.js. Imagery links route to mission/product pages where public instrument data exists.",
    wired: "live",
  },
  {
    name: "Element84 Earth-Search STAC",
    url: "https://earth-search.aws.element84.com/v1",
    used_for: "Sentinel-2 L2A + Landsat C2L2 SR latest cloud-filtered scenes",
    auth: "none", cadence: "as scenes ingest", trust: "aggregator",
    rate_limit: "no published limit",
    notes: "Public STAC catalog; cloud-cover filter applied at query time.",
    wired: "documented",
  },
  {
    name: "Copernicus Data Space Ecosystem",
    url: "https://dataspace.copernicus.eu",
    used_for: "Sentinel-2 + Sentinel-1 imagery viewer (deep-link only)",
    auth: "none for browser; ESA account for downloads",
    cadence: "as scenes ingest", trust: "agency",
    rate_limit: "n/a (deep-link)",
    notes: "EU equivalent of NASA Worldview for Sentinel data.",
    wired: "documented",
  },
  {
    name: "USGS Landsat Look + Earth Explorer",
    url: "https://landsatlook.usgs.gov",
    used_for: "Landsat-8/9 historical archive viewer (deep-link)",
    auth: "none for browser", cadence: "16-day repeat", trust: "agency",
    rate_limit: "n/a (deep-link)",
    notes: "STAC API also exposed at landsatlook.usgs.gov/stac-server.",
    wired: "documented",
  },
  {
    name: "Sentinel Hub EO Browser",
    url: "https://apps.sentinel-hub.com/eo-browser",
    used_for: "Sentinel-2 / Sentinel-1 / Landsat viewer (deep-link)",
    auth: "free Sentinel Hub account", cadence: "as scenes ingest",
    trust: "aggregator",
    rate_limit: "n/a (deep-link)",
    notes: "Free tier covers viewing; programmatic API requires API key.",
    wired: "documented",
  },
  {
    name: "Zoom Earth",
    url: "https://zoom.earth",
    used_for: "Live weather satellite mosaic viewer (deep-link)",
    auth: "none", cadence: "real-time", trust: "aggregator",
    rate_limit: "n/a (deep-link)",
    notes: "GOES + EUMETSAT + Himawari blended; no public API.",
    wired: "documented",
  },
  {
    name: "EOSDA LandViewer",
    url: "https://eos.com/landviewer",
    used_for: "Multi-source imagery viewer (deep-link)",
    auth: "free EOSDA account", cadence: "as scenes ingest",
    trust: "aggregator",
    rate_limit: "n/a (deep-link)",
    notes: "Aggregates Sentinel + Landsat + commercial sources; deep-link only.",
    wired: "documented",
  },
];
