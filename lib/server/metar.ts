/** Lightweight METAR parsing — just enough for network monitoring.
 *
 *  We do NOT implement a full METAR decoder here; the critical fields
 *  for OWL are:
 *    - maintenance flag (trailing `$`)
 *    - the timestamp (DDHHmmZ → UTC)
 *    - visibility / ceiling for flight-category rollups (optional)
 */

const UA = "owl-ui/2.0 (asos-tools-ui)";
export const METAR_UA = UA;

/** Detect the ASOS `$` maintenance-check indicator. */
export function hasMaintenanceFlag(metar: string | null | undefined): boolean {
  if (!metar) return false;
  return metar.trimEnd().endsWith("$") || metar.trimEnd().endsWith("$=");
}

/** Parse the DDHHmmZ token out of a METAR into a UTC Date.
 *  Returns null if unparseable. Uses `reference` (default now) to resolve
 *  the month/year for the DDHHmmZ (the year/month isn't in the METAR). */
export function parseMetarTime(
  metar: string,
  reference: Date = new Date(),
): Date | null {
  const m = metar.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const hh = parseInt(m[2], 10);
  const mm = parseInt(m[3], 10);
  if (!Number.isFinite(dd) || !Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  // Start from the reference's month/year.  If the parsed DD is greater
  // than today's DD (i.e. observation is newer than today), we crossed a
  // month boundary — back up one month.
  const y = reference.getUTCFullYear();
  const mo = reference.getUTCMonth();
  let d = new Date(Date.UTC(y, mo, dd, hh, mm, 0));
  const now = reference.getTime();
  if (d.getTime() > now + 6 * 3600 * 1000) {
    // Observation is more than 6 h in the future → rollback one month.
    d = new Date(Date.UTC(y, mo - 1, dd, hh, mm, 0));
  }
  return d;
}

/** Flight category from vis + ceiling. */
export function flightCategory(
  visibility_sm: number | null,
  ceiling_ft: number | null,
): "VFR" | "MVFR" | "IFR" | "LIFR" {
  const v = visibility_sm ?? 99;
  const c = ceiling_ft ?? 99_000;
  if (v < 1 || c < 500) return "LIFR";
  if (v < 3 || c < 1000) return "IFR";
  if (v <= 5 || c <= 3000) return "MVFR";
  return "VFR";
}
