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

/** Outcome of a second-source validation against NCEI's authoritative
 *  archive (or AWC fallback when NCEI is in a maintenance window).
 *  Populated by the scan-cache cross-check pass. Most rows in any given
 *  scan won't have one — we rotate ~30 disputed stations per scan to
 *  stay inside NCEI's 5 req/s envelope. */
export interface CrossCheck {
  /** Where the second opinion came from. NCEI is authoritative; AWC
   *  is a faster fallback when NCEI is offline. */
  source: "ncei" | "awc" | "nws";
  /** Did the second source confirm IEM's bucket count?
   *  - true  : second source agrees → IEM classification is real
   *  - false : second source has data IEM doesn't → mirror artifact */
  agrees_with_iem: boolean;
  /** ISO timestamp of the cross-check. */
  checked_at: string;
  /** Number of hourly buckets the second source had data for. */
  buckets_seen: number;
  /** What status the second-source data WOULD imply, if different
   *  from IEM. UI surfaces both so disagreements are explicit. */
  suggested_status?: StationStatus;
  /** Set when the check was attempted but couldn't complete. Distinguishes
   *  "validated CLEAN" from "wasn't validated yet". */
  skipped?: "maintenance" | "rate_limit" | "no_data" | "error" | "unmapped";
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
  /** Optional second-source corroboration. Present only after the
   *  cross-check pass picked this row. */
  cross_check?: CrossCheck;
}
