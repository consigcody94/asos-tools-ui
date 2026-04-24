/** Shared types for OWL server modules. */

export type StationStatus =
  | "CLEAN"
  | "FLAGGED"
  | "MISSING"
  | "INTERMITTENT"
  | "RECOVERED"
  | "NO DATA";

export interface AomcStation {
  id: string;            // ICAO (4-letter)
  name: string;
  state: string;
  lat: number;
  lon: number;
  elevation_m?: number | null;
  network?: string;      // NWS / FAA / DOD
  operator?: string;
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
