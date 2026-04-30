/** Operator-name normalization for the AOMC station catalog.
 *
 *  The baked AOMC catalog stores operator IDs verbatim from the AOMC
 *  source — most rows carry "FAA", "DOD", or "—" (em-dash, U+2014)
 *  for stations that don't have an explicit external operator. The
 *  em-dash isn't a missing value, it's the AOMC convention for "this
 *  is a standard NWS / NOAA station operated under the SUAD program."
 *
 *  Rendering raw "—" in the UI confused operators ("is that data
 *  missing?"). This helper resolves it once, used by every consumer:
 *
 *    - app/stations/page.tsx        operator counter strip
 *    - app/stations/stations-table  search + cell render
 *    - app/aomc/aomc-dashboard.tsx  filter chips + meta cell
 *    - app/aomc/page.tsx            per-operator aggregation
 *    - app/forecasters/...          drill display
 *
 *  Keep this list in sync with any future AOMC operator additions.
 */

const NWS_SUAD_TOKENS = new Set([
  "—",       // U+2014 em-dash — AOMC convention for "NOAA/SUAD"
  "--",      // double-hyphen variant occasionally seen in re-imported sheets
  "---",     // triple-hyphen variant (sometimes from CSV exports)
  "",        // empty string fallback
  "NWS",     // already-NWS rows get explicit branding too
  "NOAA",    // pre-existing NOAA rows align with the SUAD program
]);

/** Translate a raw operator field into the display string operators
 *  expect. NWS / NOAA / em-dash all collapse to "NOAA/SUAD" — the
 *  formal program name. FAA and DOD pass through unchanged. */
export function displayOperator(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  if (NWS_SUAD_TOKENS.has(v)) return "NOAA/SUAD";
  return v;
}

/** Aggregate-friendly variant. Returns the same display string but
 *  preserves the FAA/DOD/NOAA-SUAD bucketing for counter strips. */
export function operatorBucket(raw: string | undefined | null): string {
  return displayOperator(raw);
}
