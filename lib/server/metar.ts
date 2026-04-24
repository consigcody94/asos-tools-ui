/** Light-weight METAR utilities + re-exports of the full decoder.
 *
 *  This module predates `metar-decode.ts` and `metar-reasons.ts`; it
 *  exposes the cheap helpers that the scan hot-path uses and re-exports
 *  the full decoder for anything that needs structured fields.
 */

export { hasMaintenanceFlag, decodeMaintenanceReasons, decodeReasonsShort, SENSOR_INDICATORS } from "./metar-reasons";
export type { MaintenanceReason } from "./metar-reasons";
export { decodeMetar } from "./metar-decode";
export type {
  DecodedMetar, WindGroup, CloudLayer, CloudCoverage, WeatherGroup,
  WeatherIntensity, FlightCategory,
} from "./metar-decode";

const UA = "owl-ui/2.0 (asos-tools-ui)";
export const METAR_UA = UA;

/** Parse the DDHHmmZ token out of a METAR into a UTC Date.
 *  Used by the scan loop for the fast silent-station calculation. */
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
  const y = reference.getUTCFullYear();
  const mo = reference.getUTCMonth();
  let d = new Date(Date.UTC(y, mo, dd, hh, mm, 0));
  const now = reference.getTime();
  if (d.getTime() > now + 6 * 3600 * 1000) {
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
