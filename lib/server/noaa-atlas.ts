/** NOAA / government / free-source integration atlas.
 *
 *  This is product data, not a scraper: it gives operators and maintainers a
 *  traceable map of what OWL consumes today, what can be wired next, and which
 *  older/open GitHub tools are useful modernization references.
 */

export type AtlasStatus = "live" | "ready" | "keyed" | "research";
export type AtlasDomain =
  | "surface"
  | "aviation"
  | "orbital"
  | "radar"
  | "satellite"
  | "marine"
  | "hydrology"
  | "models"
  | "hazards"
  | "climate"
  | "maps"
  | "quality-control";

export interface GovernmentApiSource {
  id: string;
  name: string;
  agency: string;
  domain: AtlasDomain;
  status: AtlasStatus;
  auth: string;
  cadence: string;
  endpoint: string;
  docs: string;
  usedFor: string;
  implementation: string;
}

export interface GithubModernizationTarget {
  name: string;
  url: string;
  license: string;
  stars: number;
  updated: string;
  usefulFor: string;
  modernization: string;
}

export interface ReportingProduct {
  name: string;
  output: string;
  sourceIds: string[];
  operatorValue: string;
  implementation: string;
}

export interface ProgramCoverage {
  program: string;
  office: string;
  coverage: string;
  nextLevel: string;
}

export const GOVERNMENT_API_ATLAS: GovernmentApiSource[] = [
  {
    id: "iem-asos",
    name: "Iowa Environmental Mesonet ASOS/AWOS archive",
    agency: "Iowa State / NOAA mirror",
    domain: "surface",
    status: "live",
    auth: "none",
    cadence: "1 min to hourly",
    endpoint: "https://mesonet.agron.iastate.edu/cgi-bin/request/asos1min.py",
    docs: "https://mesonet.agron.iastate.edu/request/asos/1min.phtml",
    usedFor: "Primary METAR and 1-minute ASOS evidence CSVs.",
    implementation: "Use large batches, 1 request / 5s pacing, and stale-cache fallback; pair with NCEI as authoritative fallback for report citations.",
  },
  {
    id: "nws-api",
    name: "NWS api.weather.gov",
    agency: "NOAA / National Weather Service",
    domain: "surface",
    status: "live",
    auth: "User-Agent header",
    cadence: "cache-friendly real time",
    endpoint: "https://api.weather.gov",
    docs: "https://www.weather.gov/documentation/services-web-api",
    usedFor: "Forecasts, observations, CAP alerts, zones, offices, and station metadata.",
    implementation: "Already rate-limited in owlFetch with a conservative unpublished-limit policy; expand report appendix with CAP alert history by station.",
  },
  {
    id: "awc-data",
    name: "Aviation Weather Center Data API",
    agency: "NOAA / NWS Aviation Weather Center",
    domain: "aviation",
    status: "live",
    auth: "none",
    cadence: "1 to 10 min product caches",
    endpoint: "https://aviationweather.gov/api/data",
    docs: "https://aviationweather.gov/data/api/",
    usedFor: "METAR, TAF, SIGMET, G-AIRMET, PIREP/AIREP, CWA, AFD, station info.",
    implementation: "Prefer cache files for national products; use station queries for drill-down and reports.",
  },
  {
    id: "ncei-access",
    name: "NCEI Access Data Service",
    agency: "NOAA / NCEI",
    domain: "climate",
    status: "ready",
    auth: "none",
    cadence: "archive",
    endpoint: "https://www.ncei.noaa.gov/access/services/data/v1",
    docs: "https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation",
    usedFor: "Authoritative historical station, daily, hourly, marine, and climate archive pulls.",
    implementation: "Add report fallback URLs so every CSV package has an agency archive citation.",
  },
  {
    id: "ncei-cdo",
    name: "Climate Data Online API",
    agency: "NOAA / NCEI",
    domain: "climate",
    status: "keyed",
    auth: "free token",
    cadence: "archive",
    endpoint: "https://www.ncei.noaa.gov/cdo-web/api/v2",
    docs: "https://www.ncdc.noaa.gov/cdo-web/webservices/v2",
    usedFor: "Normals, daily summaries, monthly summaries, and climate context.",
    implementation: "Gate behind NCEI_CDO_TOKEN; use for climatology in monthly ASOS performance reports.",
  },
  {
    id: "ridge-nexrad",
    name: "NWS RIDGE / radar.weather.gov",
    agency: "NOAA / NWS Radar Operations Center",
    domain: "radar",
    status: "live",
    auth: "none",
    cadence: "about 5 min",
    endpoint: "https://radar.weather.gov/ridge/standard",
    docs: "https://radar.weather.gov/",
    usedFor: "Fast visual radar loops in station drill panels.",
    implementation: "Keep for operator glance; add Level II/III cloud objects when reports need forensic radar evidence.",
  },
  {
    id: "nexrad-nodd",
    name: "NEXRAD Level II/III on NOAA Open Data Dissemination",
    agency: "NOAA / NCEI / Unidata",
    domain: "radar",
    status: "ready",
    auth: "none for public S3/HTTP listing",
    cadence: "as scans arrive",
    endpoint: "s3://unidata-nexrad-level2, s3://unidata-nexrad-level2-chunks, s3://unidata-nexrad-level3",
    docs: "https://registry.opendata.aws/noaa-nexrad/",
    usedFor: "Forensic radar sweeps around ASOS outages, hail/wind correlation, and report attachments.",
    implementation: "Implement object index + selected product links first; render Level II server-side later with Py-ART/Radx service.",
  },
  {
    id: "mrms",
    name: "Multi-Radar Multi-Sensor (MRMS)",
    agency: "NOAA / NSSL / NCEP",
    domain: "radar",
    status: "ready",
    auth: "none for HTTP GRIB2",
    cadence: "real time",
    endpoint: "https://mrms.ncep.noaa.gov/data/",
    docs: "https://www.nssl.noaa.gov/projects/mrms/MRMS_data.php",
    usedFor: "QPE, reflectivity mosaics, hail, rotation tracks, and precipitation context.",
    implementation: "Start with MRMS product links by nearest grid/time; defer GRIB2 decoding to a worker service.",
  },
  {
    id: "goes-star",
    name: "NESDIS STAR GOES-19 East / GOES-18 West imagery",
    agency: "NOAA / NESDIS / STAR",
    domain: "satellite",
    status: "live",
    auth: "none",
    cadence: "1 to 5 min",
    endpoint: "https://cdn.star.nesdis.noaa.gov/",
    docs: "https://www.star.nesdis.noaa.gov/",
    usedFor: "Per-station GOES loops auto-routed by region.",
    implementation: "Keep as low-latency visual layer; add ABI product catalog links for report provenance.",
  },
  {
    id: "goes-nodd",
    name: "GOES-R Series ABI/GLM on NOAA Open Data Dissemination",
    agency: "NOAA / NESDIS",
    domain: "satellite",
    status: "ready",
    auth: "none for public cloud buckets",
    cadence: "as products arrive",
    endpoint: "s3://noaa-goes18, s3://noaa-goes19",
    docs: "https://registry.opendata.aws/noaa-goes/",
    usedFor: "Raw ABI/GLM scene evidence, cloud tops, lightning, fog/low stratus, fire hot spots.",
    implementation: "Add latest ABI/GLM object links per station sector; keep imagery rendering client-friendly.",
  },
  {
    id: "gibs-worldview",
    name: "NASA GIBS / Worldview",
    agency: "NASA EOSDIS",
    domain: "satellite",
    status: "live",
    auth: "none",
    cadence: "daily to sub-daily by layer",
    endpoint: "https://wvs.earthdata.nasa.gov/api/v1/snapshot",
    docs: "https://nasa-gibs.github.io/gibs-api-docs/",
    usedFor: "MODIS/VIIRS true color, false color, snow, smoke, and SST snapshots.",
    implementation: "Already in station imagery; add snapshot URLs to report package manifests.",
  },
  {
    id: "eonet",
    name: "NASA EONET v3",
    agency: "NASA Earth Observatory / EOSDIS",
    domain: "hazards",
    status: "live",
    auth: "none",
    cadence: "near real time",
    endpoint: "https://eonet.gsfc.nasa.gov/api/v3/events",
    docs: "https://eonet.gsfc.nasa.gov/docs/v3",
    usedFor: "Global natural event feed: wildfires, severe storms, volcanoes, sea/lake ice, floods, dust, and related hazards.",
    implementation: "Live Summary command-center panel and /api/eonet/events JSON route.",
  },
  {
    id: "celestrak-gp",
    name: "CelesTrak GP orbital elements",
    agency: "CelesTrak / U.S. Space Force source data",
    domain: "orbital",
    status: "live",
    auth: "none",
    cadence: "updated multiple times daily",
    endpoint: "https://celestrak.org/NORAD/elements/gp.php",
    docs: "https://celestrak.org/NORAD/documentation/gp-data-formats.php",
    usedFor: "Live satellite position propagation for ISS, NOAA, NASA, USGS, and Copernicus assets.",
    implementation: "Live Summary orbital panel and /api/satellites/live JSON route using satellite.js SGP4.",
  },
  {
    id: "coops",
    name: "CO-OPS Data + Metadata APIs",
    agency: "NOAA / NOS Center for Operational Oceanographic Products and Services",
    domain: "marine",
    status: "live",
    auth: "none",
    cadence: "latest to 1 min depending on product",
    endpoint: "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter",
    docs: "https://api.tidesandcurrents.noaa.gov/api/prod/",
    usedFor: "Coastal water level, wind, pressure, temperature, currents, PORTS/NWLON station context.",
    implementation: "Live nearest-station correlation now appears in station hazards; expand reports with tide/current windows.",
  },
  {
    id: "ndbc",
    name: "National Data Buoy Center realtime2",
    agency: "NOAA / NWS / NDBC",
    domain: "marine",
    status: "live",
    auth: "none",
    cadence: "10 to 30 min",
    endpoint: "https://www.ndbc.noaa.gov/data/realtime2",
    docs: "https://www.ndbc.noaa.gov/",
    usedFor: "Nearest buoy wind, pressure, air/water temperature, visibility, wave context.",
    implementation: "Already in hazards; add wave and visibility fields to coastal station reports.",
  },
  {
    id: "nhc",
    name: "National Hurricane Center CurrentStorms",
    agency: "NOAA / NWS / NHC",
    domain: "hazards",
    status: "live",
    auth: "none",
    cadence: "advisory cycle",
    endpoint: "https://www.nhc.noaa.gov/CurrentStorms.json",
    docs: "https://www.nhc.noaa.gov/gis/",
    usedFor: "Active tropical cyclone proximity to ASOS sites.",
    implementation: "Add cone/wind-radius GIS links to station and incident reports.",
  },
  {
    id: "swpc",
    name: "Space Weather Prediction Center JSON services",
    agency: "NOAA / NWS / SWPC",
    domain: "hazards",
    status: "live",
    auth: "none",
    cadence: "1 to 60 min",
    endpoint: "https://services.swpc.noaa.gov/",
    docs: "https://www.swpc.noaa.gov/products-and-data",
    usedFor: "Kp, X-ray flux, geomagnetic alerts, aviation comms/radio context.",
    implementation: "Already available; include active alerts in shift-change and incident reports.",
  },
  {
    id: "nwps",
    name: "National Water Prediction Service API",
    agency: "NOAA / NWS Office of Water Prediction",
    domain: "hydrology",
    status: "ready",
    auth: "none",
    cadence: "real time and forecast",
    endpoint: "https://api.water.noaa.gov/nwps/v1",
    docs: "https://water.noaa.gov/about/api",
    usedFor: "Stream observations, official forecasts, National Water Model output, flood categories.",
    implementation: "Add nearest NWPS location to hazards for riverine flood context around ASOS sites.",
  },
  {
    id: "nomads",
    name: "NCEP NOMADS GRIB filters",
    agency: "NOAA / NCEP / NCO",
    domain: "models",
    status: "ready",
    auth: "none",
    cadence: "hourly to 6-hourly",
    endpoint: "https://nomads.ncep.noaa.gov/",
    docs: "https://nomads.ncep.noaa.gov/",
    usedFor: "GFS, HRRR, RAP, NAM, GEFS, MOS, and other model slices.",
    implementation: "Use point/subset links first; add worker-side GRIB extraction for ceiling/visibility forecast reports.",
  },
  {
    id: "mapservices-weather",
    name: "NWS OGC / ArcGIS map services",
    agency: "NOAA / NWS",
    domain: "maps",
    status: "ready",
    auth: "none",
    cadence: "time-enabled near real time",
    endpoint: "https://mapservices.weather.noaa.gov/",
    docs: "https://radar.weather.gov/",
    usedFor: "Radar mosaics, local storm reports, watches/warnings, QPE, map overlays.",
    implementation: "Use as a web-map overlay layer for the globe and station drill evidence maps.",
  },
  {
    id: "nowcoast",
    name: "nowCOAST / coastal web map services",
    agency: "NOAA / NOS Office of Coast Survey",
    domain: "maps",
    status: "ready",
    auth: "none",
    cadence: "near real time",
    endpoint: "https://nowcoast.noaa.gov/",
    docs: "https://www.nauticalcharts.noaa.gov/learn/nowcoast.html",
    usedFor: "Coastal observations, weather radar, warnings, ocean model guidance, marine forecasts.",
    implementation: "Add coastal ASOS mode with warning, tide, radar, and OFS overlays.",
  },
  {
    id: "madis",
    name: "MADIS public observation universe",
    agency: "NOAA / NCEP",
    domain: "quality-control",
    status: "research",
    auth: "public/guest plus restricted tiers",
    cadence: "real time and archive",
    endpoint: "https://madis-data.ncep.noaa.gov/",
    docs: "https://madis-data.ncep.noaa.gov/madis_api_descrip.shtml",
    usedFor: "QC flags and dense mesonet/aircraft/surface observations around ASOS failures.",
    implementation: "Use public text/XML dumps for nearby QC evidence; keep restricted datasets behind admin configuration.",
  },
  {
    id: "faa-weathercams",
    name: "FAA WeatherCams",
    agency: "FAA",
    domain: "aviation",
    status: "live",
    auth: "browser-compatible headers",
    cadence: "about 10 min",
    endpoint: "https://weathercams.faa.gov/",
    docs: "https://weathercams.faa.gov/",
    usedFor: "Nearest visual evidence for ceiling, visibility, precipitation, smoke, and terrain obscuration.",
    implementation: "Already in drill panel; add frame manifest and camera direction metadata to reports.",
  },
  {
    id: "faa-notam",
    name: "FAA NOTAM API",
    agency: "FAA",
    domain: "aviation",
    status: "keyed",
    auth: "free FAA developer client credentials",
    cadence: "real time",
    endpoint: "https://external-api.faa.gov/notamapi/v1/notams",
    docs: "https://api.faa.gov/",
    usedFor: "Planned outage and equipment-unserviceable correlation.",
    implementation: "Already optional; add incident report section when credentials are configured.",
  },
  {
    id: "usgs-quakes",
    name: "USGS Earthquake Hazards GeoJSON",
    agency: "U.S. Geological Survey",
    domain: "hazards",
    status: "live",
    auth: "none",
    cadence: "about 1 min",
    endpoint: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary",
    docs: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
    usedFor: "Nearby earthquake correlation for station outages and sensor anomalies.",
    implementation: "Already in hazards; add map pins in future evidence map.",
  },
];

export const GITHUB_MODERNIZATION_QUEUE: GithubModernizationTarget[] = [
  {
    name: "Unidata/MetPy",
    url: "https://github.com/Unidata/MetPy",
    license: "BSD-3-Clause",
    stars: 1417,
    updated: "2026-04-28",
    usefulFor: "Meteorological calculations, unit handling, station plots, sounding/math references.",
    modernization: "Port report calculations to small TypeScript helpers now; use a Python worker only for advanced plots.",
  },
  {
    name: "Unidata/siphon",
    url: "https://github.com/Unidata/siphon",
    license: "BSD-3-Clause",
    stars: 241,
    updated: "2026-04-27",
    usefulFor: "THREDDS/TDS data discovery and subsetting patterns.",
    modernization: "Mirror the catalog-discovery UX in OWL without adding a Python dependency to the Next.js runtime.",
  },
  {
    name: "blaylockbk/Herbie",
    url: "https://github.com/blaylockbk/Herbie",
    license: "MIT",
    stars: 734,
    updated: "2026-04-28",
    usefulFor: "HRRR, RAP, GFS, IFS, NOMADS, NODD, and cloud archive access patterns.",
    modernization: "Use its product matrix as a guide for a model-source picker; keep OWL's first release to links/manifests.",
  },
  {
    name: "aarande/nexradaws",
    url: "https://github.com/aarande/nexradaws",
    license: "MIT",
    stars: 48,
    updated: "2026-04-13",
    usefulFor: "NEXRAD AWS query/download workflow.",
    modernization: "Update bucket targets to the 2025+ Unidata NEXRAD buckets and expose object manifests in reports.",
  },
  {
    name: "ARM-DOE/pyart",
    url: "https://github.com/ARM-DOE/pyart",
    license: "BSD-like",
    stars: 582,
    updated: "2026-04-22",
    usefulFor: "Radar file reading, gridding, and scientific visualization.",
    modernization: "Use in an optional worker for Level II/III images; do not bundle it into the UI container.",
  },
  {
    name: "akrherz/pyIEM",
    url: "https://github.com/akrherz/pyIEM",
    license: "MIT",
    stars: 51,
    updated: "2026-04-28",
    usefulFor: "IEM/ASOS workflows, decoding, and weather-processing utilities.",
    modernization: "Audit decoding/report edge cases against OWL's TypeScript METAR parser.",
  },
  {
    name: "GClunies/noaa_coops",
    url: "https://github.com/GClunies/noaa_coops",
    license: "Apache-2.0",
    stars: 96,
    updated: "2026-04-22",
    usefulFor: "CO-OPS data/metadata API wrapper behavior and station/product ergonomics.",
    modernization: "Use as a product-list reference while keeping OWL's CO-OPS integration native TypeScript.",
  },
  {
    name: "stactools-packages/noaa-hrrr",
    url: "https://github.com/stactools-packages/noaa-hrrr",
    license: "Apache-2.0",
    stars: 0,
    updated: "2026-01-24",
    usefulFor: "STAC metadata patterns for HRRR assets across cloud providers.",
    modernization: "Adopt STAC-like manifests for model/radar/satellite evidence packages.",
  },
  {
    name: "soos3d/chat-gpt-aerodex-plugin",
    url: "https://github.com/soos3d/chat-gpt-aerodex-plugin",
    license: "Apache-2.0",
    stars: 2,
    updated: "2026-01-08",
    usefulFor: "Simple aviationweather.gov API routing and assistant-facing schemas.",
    modernization: "Borrow the idea of structured aviation products, not code; OWL should generate auditable JSON/Markdown reports.",
  },
  {
    name: "nasa-gibs/worldview",
    url: "https://github.com/nasa-gibs/worldview",
    license: "Other",
    stars: 990,
    updated: "2026-04-28",
    usefulFor: "Production-grade satellite browsing interface and layer/event coordination patterns.",
    modernization: "Use as the imagery interaction benchmark; keep OWL focused on operational station evidence.",
  },
  {
    name: "WFP-VAM/prism-app",
    url: "https://github.com/WFP-VAM/prism-app",
    license: "MIT",
    stars: 71,
    updated: "2026-04-23",
    usefulFor: "Map-based hazard impact dashboard patterns combining live hazard layers with vulnerability context.",
    modernization: "Borrow the layered impact-analysis model for ASOS station risk overlays, not the whole stack.",
  },
  {
    name: "awesomedata/awesome-public-datasets",
    url: "https://github.com/awesomedata/awesome-public-datasets",
    license: "MIT",
    stars: 74648,
    updated: "2026-04-29",
    usefulFor: "Broad discovery list for public climate, GIS, transport, public-safety, and government datasets.",
    modernization: "Use as an intake source for the atlas; promote only feeds with stable docs and operational value.",
  },
];

export const REPORTING_PRODUCTS: ReportingProduct[] = [
  {
    name: "Station Outage Evidence Package",
    output: "CSV + Markdown + JSON manifest",
    sourceIds: ["iem-asos", "nws-api", "awc-data", "faa-notam", "faa-weathercams"],
    operatorValue: "One-click packet for missing/flagged ASOS, including last good METAR, decoded failure hints, NOTAMs, and nearby visual evidence.",
    implementation: "Native client download now; server PDF/DOCX later when persistent storage is available.",
  },
  {
    name: "Coastal Cross-Check Report",
    output: "Station report section",
    sourceIds: ["coops", "ndbc", "nhc", "nowcoast"],
    operatorValue: "Correlates ASOS wind/pressure/visibility anomalies with independent coastal water-level and marine observations.",
    implementation: "CO-OPS is live in hazards; add time-window charts and tide/current products next.",
  },
  {
    name: "Radar Forensics Manifest",
    output: "NEXRAD/MRMS object index",
    sourceIds: ["ridge-nexrad", "nexrad-nodd", "mrms", "mapservices-weather"],
    operatorValue: "Captures radar products around a station and timestamp without forcing operators to download large GRIB/Level II files.",
    implementation: "Start by listing exact public object URLs; render products in a worker once storage exists.",
  },
  {
    name: "Forecast Reliability Appendix",
    output: "Model/source appendix",
    sourceIds: ["nomads", "nwps", "ncei-access", "ncei-cdo"],
    operatorValue: "Adds model, hydrology, and climate context to longer investigations or monthly performance reviews.",
    implementation: "Use NOMADS/NWPS/NCEI as opt-in report lanes so routine outage reporting stays fast.",
  },
  {
    name: "Shift-Change Federal Brief",
    output: "Markdown + copy-to-clipboard",
    sourceIds: ["nws-api", "awc-data", "swpc", "nhc", "usgs-quakes", "eonet"],
    operatorValue: "Concise operational handoff with only authoritative source citations.",
    implementation: "Extend the existing AI Brief with a non-AI deterministic manifest and citations.",
  },
  {
    name: "Global Natural Event Watch",
    output: "Live table + JSON feed",
    sourceIds: ["eonet", "gibs-worldview", "goes-nodd", "nhc", "usgs-quakes"],
    operatorValue: "Keeps open global wildfires, storms, volcanoes, ice, floods, and dust events visible next to network status.",
    implementation: "Live Summary panel now polls /api/eonet/events every 5 minutes.",
  },
  {
    name: "Orbital Asset Watch",
    output: "3D globe + JSON feed",
    sourceIds: ["celestrak-gp", "goes-star", "gibs-worldview"],
    operatorValue: "Shows live ISS, NOAA, NASA, USGS, Copernicus and GOES satellite positions with public imagery/mission links.",
    implementation: "Live Summary panel now polls /api/satellites/live every 60 seconds.",
  },
];

export const NOAA_PROGRAM_COVERAGE: ProgramCoverage[] = [
  {
    program: "Surface aviation observations",
    office: "NWS / FAA / DOD / AWC / NCEI",
    coverage: "Live METAR, 1-minute ASOS CSV, TAF, AFD, PIREP, SIGMET/G-AIRMET.",
    nextLevel: "NCEI authoritative archive fallback and MADIS QC-side observations.",
  },
  {
    program: "Radar",
    office: "NWS ROC / NSSL / NCEP / NCEI",
    coverage: "RIDGE loops and WSR-88D nearest-site routing.",
    nextLevel: "NODD Level II/III manifests, MRMS products, time-enabled map-service overlays.",
  },
  {
    program: "Satellites",
    office: "NESDIS / STAR / NODD plus NASA EOSDIS",
    coverage: "GOES East/West loops, NASA GIBS snapshots, Sentinel/Landsat STAC deep links.",
    nextLevel: "GOES-19/18 ABI and GLM raw object manifests by sector/time.",
  },
  {
    program: "Marine and coastal",
    office: "NOS CO-OPS / NDBC / NHC / nowCOAST",
    coverage: "NDBC buoy observations, active tropical cyclone proximity, CO-OPS nearest-station latest products.",
    nextLevel: "Tide/current windows, PORTS station products, coastal map overlays.",
  },
  {
    program: "Hydrology",
    office: "NWS Office of Water Prediction",
    coverage: "Not yet in the primary UI.",
    nextLevel: "Nearest NWPS location, flood category, official forecast, National Water Model output.",
  },
  {
    program: "Forecast models",
    office: "NCEP / NCO / NODD",
    coverage: "Not yet decoded in the UI.",
    nextLevel: "NOMADS/NODD point/subset manifests for HRRR, RAP, GFS, GEFS, NBM/MOS context.",
  },
  {
    program: "Space weather",
    office: "SWPC",
    coverage: "Kp, X-ray flux, and active alert feeds.",
    nextLevel: "Include comms/radio-relevance notes in shift-change reports.",
  },
  {
    program: "Global natural events",
    office: "NASA Earth Observatory / EOSDIS",
    coverage: "Open EONET natural events now stream on the Summary page and JSON API.",
    nextLevel: "Correlate EONET events to nearest ASOS/NDBC/CO-OPS stations and Worldview imagery.",
  },
  {
    program: "Orbital assets",
    office: "CelesTrak / NOAA / NASA / USGS / ESA",
    coverage: "Curated live satellite positions now stream on the Summary page and JSON API.",
    nextLevel: "Draw orbit tracks, add pass predictions by station, and link event-specific imagery layers.",
  },
];

export function atlasCounts() {
  return GOVERNMENT_API_ATLAS.reduce(
    (acc, src) => {
      acc.total++;
      acc[src.status]++;
      return acc;
    },
    { total: 0, live: 0, ready: 0, keyed: 0, research: 0 } as Record<AtlasStatus | "total", number>,
  );
}
