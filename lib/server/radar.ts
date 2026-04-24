/** NEXRAD RIDGE + NESDIS GOES-19 East / GOES-18 West URL builders. */

import { nearestWsr88d, wsr88dSites } from "./stations";

// --- NEXRAD -----------------------------------------------------------------
export function ridgeLoopUrl(site: string): string {
  return `https://radar.weather.gov/ridge/standard/${site.toUpperCase()}_loop.gif`;
}
export function ridgeStillUrl(site: string): string {
  return `https://radar.weather.gov/ridge/standard/${site.toUpperCase()}_0.gif`;
}

export function stationRadarLoop(
  lat: number, lon: number, maxKm = 400,
): { url: string; site?: string; siteName?: string; km?: number; fallback: boolean } {
  const near = nearestWsr88d(lat, lon);
  if (!near || near.km > maxKm) {
    return {
      url: "https://radar.weather.gov/ridge/standard/CONUS_0.gif",
      fallback: true,
    };
  }
  const meta = wsr88dSites()[near.id];
  return {
    url: ridgeLoopUrl(near.id),
    site: near.id,
    siteName: meta?.name,
    km: near.km,
    fallback: false,
  };
}

// --- GOES satellite ---------------------------------------------------------
function goes19Conus(band = "GEOCOLOR", size = "625x375") {
  return `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/${band}/GOES19-CONUS-${band}-${size}.gif`;
}
function goes19Sector(sector: string, band = "GEOCOLOR", size = "600x600") {
  return `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/${sector}/${band}/GOES19-${sector.toUpperCase()}-${band}-${size}.gif`;
}
function goes18Sector(sector: string, band = "GEOCOLOR", size = "600x600") {
  return `https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/${sector}/${band}/GOES18-${sector.toUpperCase()}-${band}-${size}.gif`;
}

export function goesLoopForStation(lat: number, lon: number): { url: string; label: string } {
  // PR/USVI → GOES-19 pr sector
  if (lat >= 16 && lat <= 20 && lon >= -68 && lon <= -63)
    return { url: goes19Sector("pr"), label: "GOES-19 PR" };
  // Hawaii → GOES-18 HI
  if (lat >= 18 && lat <= 23 && lon >= -162 && lon <= -154)
    return { url: goes18Sector("hi"), label: "GOES-18 HI" };
  // Alaska → GOES-18 AK (1000x1000)
  if (lat >= 50 && lon <= -130)
    return { url: goes18Sector("ak", "GEOCOLOR", "1000x1000"), label: "GOES-18 AK" };
  // PNW → GOES-18 PNW
  if (lat >= 40 && lat <= 50 && lon >= -130 && lon <= -116)
    return { url: goes18Sector("pnw"), label: "GOES-18 PNW" };
  // PSW → GOES-18 PSW
  if (lat >= 30 && lat <= 40 && lon >= -125 && lon <= -114)
    return { url: goes18Sector("psw"), label: "GOES-18 PSW" };
  // NE CONUS
  if (lat >= 36 && lat <= 48 && lon >= -85 && lon <= -65)
    return { url: goes19Sector("ne"), label: "GOES-19 NE" };
  // SE CONUS
  if (lat >= 24 && lat <= 37 && lon >= -92 && lon <= -75)
    return { url: goes19Sector("se"), label: "GOES-19 SE" };
  // Upper / Southern MS Valley + Rockies
  if (lat >= 38 && lat <= 50 && lon >= -100 && lon <= -85)
    return { url: goes19Sector("umv"), label: "GOES-19 UMV" };
  if (lat >= 28 && lat <= 38 && lon >= -100 && lon <= -85)
    return { url: goes19Sector("smv"), label: "GOES-19 SMV" };
  if (lat >= 40 && lat <= 50 && lon >= -120 && lon <= -100)
    return { url: goes19Sector("nr"), label: "GOES-19 NR" };
  if (lat >= 30 && lat <= 40 && lon >= -120 && lon <= -100)
    return { url: goes19Sector("sr"), label: "GOES-19 SR" };
  return { url: goes19Conus(), label: "GOES-19 CONUS" };
}
