/** Station catalog loaders + geo helpers.
 *
 *  Three bundled JSONs:
 *    - aomc_stations.json    — 920 AOMC-tracked stations (NWS / FAA / DOD)
 *    - asos_stations.json    — 2,929 IEM-catalog ASOS stations (superset)
 *    - wsr88d_sites.json     — 159 WSR-88D radars
 *    - ndbc_met_stations.json — 402 met-enabled NDBC buoys
 */

import type { AomcStation, BuoyStation, WsrSite } from "./types";

// These imports are inlined at build time via Next.js webpack JSON loader.
import aomcRaw from "@/lib/data/aomc_stations.json";
import asosRaw from "@/lib/data/asos_stations.json";
import wsrRaw from "@/lib/data/wsr88d_sites.json";
import ndbcRaw from "@/lib/data/ndbc_met_stations.json";

type RawRow = Record<string, unknown>;

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---- AOMC 920-station catalog -----------------------------------------------
// The JSON ships as ``{source, fetched_utc, record_count, stations: [...]}``.
let _aomc: AomcStation[] | null = null;
export function aomcStations(): AomcStation[] {
  if (_aomc) return _aomc;
  const wrap = aomcRaw as unknown as { stations?: RawRow[] };
  const rows: RawRow[] = Array.isArray(wrap) ? (wrap as unknown as RawRow[]) : wrap.stations ?? [];
  // Feet → metres for the bundled AOMC catalog (elev_ft).
  const ftToM = (ft: number | null) => ft == null ? null : Math.round(ft * 0.3048 * 10) / 10;
  _aomc = rows
    .map((r) => {
      const id = String(r.id ?? r.icao ?? r.call ?? "").toUpperCase();
      const lat = toNumberOrNull(r.lat ?? r.latitude);
      const lon = toNumberOrNull(r.lon ?? r.longitude ?? r.lng);
      if (!id || lat === null || lon === null) return null;
      const elevFt = toNumberOrNull(r.elev_ft);
      const elevM = elevFt !== null ? ftToM(elevFt) :
        toNumberOrNull(r.elevation_m ?? r.elev_m ?? r.elev ?? r.elevation);
      return {
        id,
        name: String(r.name ?? r.station_name ?? ""),
        state: String(r.state ?? r.ST ?? ""),
        lat,
        lon,
        elevation_m: elevM,
        network: String(r.station_types ?? r.network ?? r.net ?? ""),
        operator: String(r.operator ?? r.agency ?? ""),
      } as AomcStation;
    })
    .filter(Boolean) as AomcStation[];
  return _aomc;
}

export function aomcById(id: string): AomcStation | undefined {
  const up = id.trim().toUpperCase();
  return aomcStations().find((s) => s.id === up);
}

// ---- Full ASOS catalog (2,929 sites) ---------------------------------------
let _asos: AomcStation[] | null = null;
export function allAsosStations(): AomcStation[] {
  if (_asos) return _asos;
  const rows = asosRaw as unknown as RawRow[] | Record<string, RawRow>;
  const iter: RawRow[] = Array.isArray(rows) ? rows : Object.values(rows);
  _asos = iter
    .map((r) => {
      const id = String(r.id ?? r.icao ?? r.ICAO ?? r.station ?? "").toUpperCase();
      const lat = toNumberOrNull(r.lat ?? r.latitude);
      const lon = toNumberOrNull(r.lon ?? r.longitude);
      if (!id || lat === null || lon === null) return null;
      const archive_end_raw = r.archive_end;
      const archive_end = archive_end_raw == null || archive_end_raw === "" ?
        null : String(archive_end_raw);
      return {
        id,
        name: String(r.name ?? ""),
        state: String(r.state ?? ""),
        lat,
        lon,
        elevation_m: toNumberOrNull(r.elevation ?? r.elevation_m),
        network: String(r.network ?? ""),
        archive_end,
      } as AomcStation;
    })
    .filter(Boolean) as AomcStation[];
  return _asos;
}

// ---- Geo ------------------------------------------------------------------
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---- WSR-88D --------------------------------------------------------------
export function wsr88dSites(): Record<string, WsrSite> {
  return wsrRaw as Record<string, WsrSite>;
}

export function nearestWsr88d(
  lat: number,
  lon: number,
): { id: string; site: WsrSite; km: number } | null {
  const sites = wsr88dSites();
  let bestId = "", bestKm = Infinity, bestSite: WsrSite | null = null;
  for (const [id, site] of Object.entries(sites)) {
    const km = haversineKm(lat, lon, site.lat, site.lon);
    if (km < bestKm) { bestKm = km; bestId = id; bestSite = site; }
  }
  return bestSite ? { id: bestId, site: bestSite, km: Math.round(bestKm * 10) / 10 } : null;
}

// ---- NDBC -----------------------------------------------------------------
export function buoyCatalog(): Record<string, BuoyStation> {
  return ndbcRaw as Record<string, BuoyStation>;
}

export function nearestBuoy(
  lat: number,
  lon: number,
  maxKm = 200,
): { id: string; meta: BuoyStation; km: number } | null {
  const cat = buoyCatalog();
  let best: { id: string; meta: BuoyStation; km: number } | null = null;
  for (const [id, meta] of Object.entries(cat)) {
    const km = haversineKm(lat, lon, meta.lat, meta.lon);
    if (!best || km < best.km) best = { id, meta, km: Math.round(km * 10) / 10 };
  }
  if (!best || best.km > maxKm) return null;
  return best;
}

// ---- Search ---------------------------------------------------------------
export function searchStations(q: string, limit = 20): AomcStation[] {
  const s = q.trim().toUpperCase();
  if (!s) return [];
  const all = aomcStations();
  const exact = all.filter((x) => x.id === s);
  const prefix = all.filter((x) => x.id !== s && x.id.startsWith(s));
  const name = all.filter((x) =>
    x.id !== s && !x.id.startsWith(s) && x.name.toUpperCase().includes(s),
  );
  return [...exact, ...prefix, ...name].slice(0, limit);
}
