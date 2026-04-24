/** Shared types for OWL server modules. */

export type StationStatus =
  | "CLEAN"          // reporting normally, no $ flag
  | "FLAGGED"        // latest METAR has $ maintenance flag
  | "MISSING"        // silent 2+ hours but has reported recently enough to not be OFFLINE
  | "OFFLINE"        // silent for 2+ weeks, or catalog says archive_end is in the past
  | "INTERMITTENT"   // reporting but with gaps in the scan window
  | "RECOVERED"      // previously flagged/silent, latest report is clean
  | "NO DATA";       // pre-first-scan only; never emitted once a scan has completed

export interface AomcStation {
  id: string;            // ICAO (4-letter)
  name: string;
  state: string;
  lat: number;
  lon: number;
  elevation_m?: number | null;
  network?: string;      // NWS / FAA / DOD
  operator?: string;
  /** ISO date (from IEM catalog) when the station stopped archiving,
   *  used to flag OFFLINE stations. Null / undefined = still active. */
  archive_end?: string | null;
}

export interface WsrSite {
  name: string;
  lat: number;
  lon: number;
}

export interface BuoyStation {
  name: string;
  lat: number;
  lon: number;
  type?: string;
  owner?: string;
}

export interface ScanRow {
  station: string;
  name?: string;
  state?: string;
  lat?: number;
  lon?: number;
  status: StationStatus;
  minutes_since_last_report: number | null;
  last_metar: string | null;
  last_valid: string | null;
  probable_reason: string | null;
}
