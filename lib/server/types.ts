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

/** One entry in a station's rolling state log. Driven off the live
 *  classifier output — the scan-cache maintains the last ~6 hours of
 *  these per station so the classifier can detect *flapping* (bad→good→
 *  bad→good) rather than just labeling current-window gaps. */
export interface StateLogEntry {
  /** ISO timestamp of when this entry was logged (start of the bucket). */
  at: string;
  /** Coarse-grained state: "OK" if CLEAN/RECOVERED, "FLAGGED" if $-flag,
   *  "MISSING" if station was silent or no data was received. */
  state: "OK" | "FLAGGED" | "MISSING";
}

/** Underlying-signal-density readout, populated by classify(). Surfaces
 *  the bucket math so operators see WHY a station was classified the way
 *  it was — "INTERMITTENT (1/4 buckets seen)" vs "INTERMITTENT (3/4)"
 *  is the difference between "really degraded" and "one delayed report."
 *  This was added after a data audit revealed bucket-edge classification
 *  ambiguity on stations reporting at :51 vs :54. */
export interface EvidenceQuality {
  /** How many hourly buckets in the scan window had at least one METAR. */
  buckets_seen: number;
  /** How many buckets were expected (= scan window in hours, with the
   *  most recent bucket excluded if it's still within the 15-min grace
   *  period for late reports). */
  buckets_expected: number;
  /** Convenience ratio (0..1). UI uses this to colour the badge. */
  fraction: number;
  /** Number of $-flagged METARs in the window. Surfacing this helps
   *  distinguish "one transient flag" from "consistently flagged." */
  flagged_in_window: number;
  /** Total METARs received in the window. Lets the UI show
   *  "5 reports / 4 buckets" — flags special-obs frequency too. */
  reports_seen: number;
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
  /** Underlying-signal-density readout. Present on every classified
   *  row (not just disputed ones). */
  evidence_quality?: EvidenceQuality;
  /** Rolling state log — last ~6 hourly snapshots. Used by the
   *  intermittent-detection refiner to identify flapping vs single-
   *  window gaps. Persisted in the scan-cache merge buffer. */
  state_log?: StateLogEntry[];
}
