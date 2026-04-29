/** NWS-style 4-bucket status reduction.
 *
 *  OWL's classifier emits 7 fine-grained ASOS labels (CLEAN, RECOVERED,
 *  INTERMITTENT, FLAGGED, MISSING, OFFLINE, NO DATA). Operations users
 *  in the NWS Status-Map idiom only think in 4 buckets:
 *
 *    Up        — operational, no signal needed
 *    Degraded  — partial / intermittent / sensor-flagged
 *    Down      — silent or decommissioned
 *    Patching  — in security patching window (not in OWL data yet;
 *                set explicitly by the AWIPS / NCO connector when
 *                that lands)
 *
 *  We keep the 7-label form everywhere it matters (drill panel,
 *  audit log, anomaly detector). The reduction is only used for the
 *  legend, counters, and Down-Sites grouping.
 */

export type RawStatus =
  | "CLEAN"
  | "RECOVERED"
  | "INTERMITTENT"
  | "FLAGGED"
  | "MISSING"
  | "OFFLINE"
  | "NO DATA"
  | "PATCHING";

export type ReducedStatus = "UP" | "DEGRADED" | "DOWN" | "PATCHING" | "UNKNOWN";

export const REDUCED_COLOR: Record<ReducedStatus, string> = {
  UP:       "#3fb27f",
  DEGRADED: "#e0a73a",
  DOWN:     "#e25c6b",
  PATCHING: "#5fa8e6",
  UNKNOWN:  "#5f6f8f",
};

export const REDUCED_LABEL: Record<ReducedStatus, string> = {
  UP:       "Up",
  DEGRADED: "Degraded",
  DOWN:     "Down",
  PATCHING: "Patching",
  UNKNOWN:  "No data",
};

/** Reduce one of OWL's raw classifier labels to the NWS 4-bucket form. */
export function reduceStatus(raw: string | null | undefined): ReducedStatus {
  const s = (raw ?? "").toUpperCase();
  if (s === "CLEAN" || s === "RECOVERED") return "UP";
  if (s === "INTERMITTENT" || s === "FLAGGED") return "DEGRADED";
  if (s === "MISSING" || s === "OFFLINE") return "DOWN";
  if (s === "PATCHING") return "PATCHING";
  return "UNKNOWN";
}

/** Aggregate counts across an array of raw rows. */
export function reduceCounts(rows: { status?: string | null }[]): Record<ReducedStatus, number> {
  const c: Record<ReducedStatus, number> = { UP: 0, DEGRADED: 0, DOWN: 0, PATCHING: 0, UNKNOWN: 0 };
  for (const r of rows) c[reduceStatus(r.status)]++;
  return c;
}
