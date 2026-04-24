/** Maintenance-reason decoder for the ASOS `$` flag.
 *
 *  Ported 1:1 from ``asos_tools/metars.py::decode_maintenance_reasons``
 *  (Python) so the TS and Python sides always return identical reason
 *  lists for the same METAR input.
 *
 *  The ``$`` terminator on an ASOS METAR means "internal self-test has
 *  detected an out-of-tolerance condition." The remarks block sometimes
 *  (but not always) says *which* sensor is misbehaving via a specific
 *  NO-code. This module walks the body + remarks and returns the list of
 *  concrete reasons it could decode, falling back to a generic "ASOS
 *  internal tolerance check" when no specific code is found.
 */

export interface MaintenanceReason {
  sensor: string;
  reason: string;
}

/** Sensor-down codes that appear in METAR remarks when a specific
 *  sensor or subsystem is fully offline. */
export const SENSOR_INDICATORS: Record<string, [sensor: string, reason: string]> = {
  RVRNO:  ["RVR sensor",          "Runway Visual Range data not available"],
  PWINO:  ["Precip ID sensor",    "Present weather identification not available"],
  PNO:    ["Precip gauge",        "Precipitation amount not available"],
  FZRANO: ["Freezing rain sensor","Freezing rain detection not available"],
  TSNO:   ["Lightning sensor",    "Thunderstorm / lightning detection not available"],
  SLPNO:  ["Pressure sensor",     "Sea-level pressure not available"],
};

/** Location-qualified codes: "VISNO RWY06", "CHINO RWY24L". */
const LOCATION_INDICATORS: Record<string, [sensor: string, template: string]> = {
  VISNO: ["Visibility sensor", "Visibility at {loc} not available"],
  CHINO: ["Ceilometer",        "Cloud height at {loc} not available"],
};

/** Return true if the METAR ends with the `$` maintenance flag
 *  (optionally followed by a trailing `=` terminator). */
export function hasMaintenanceFlag(metar: string | null | undefined): boolean {
  if (!metar) return false;
  const s = metar.trimEnd().replace(/=+$/, "").trimEnd();
  return s.endsWith("$");
}

/** Decode the concrete sensor-down reasons in a METAR.
 *
 *  Always returns an array. Returns `[]` when the METAR has no `$` flag
 *  AND no NO-code indicators. Returns a generic "Internal check" reason
 *  when `$` is present but no specific code could be located — this is
 *  the common case (most flags are drift / calibration age / wear).
 */
export function decodeMaintenanceReasons(metar: string | null | undefined): MaintenanceReason[] {
  if (!metar) return [];
  const upper = metar.toUpperCase();
  const reasons: MaintenanceReason[] = [];

  // 1. Explicit sensor-down codes.
  for (const [code, [sensor, desc]] of Object.entries(SENSOR_INDICATORS)) {
    if (upper.includes(code)) reasons.push({ sensor, reason: desc });
  }

  // 2. Location-qualified codes (VISNO RWY06, CHINO RWY24L).
  for (const [code, [sensor, template]] of Object.entries(LOCATION_INDICATORS)) {
    const re = new RegExp(`${code}\\s+(\\S+)`);
    const m = upper.match(re);
    if (m) {
      const loc = m[1].replace(/[$=]+$/, "").trim() || "secondary location";
      reasons.push({ sensor, reason: template.replace("{loc}", loc) });
    } else if (upper.includes(code)) {
      reasons.push({ sensor, reason: template.replace("{loc}", "secondary location") });
    }
  }

  // 3. Missing data fields — clues from the observation body.
  if (/\bM\/M\b/.test(upper)) {
    reasons.push({
      sensor: "Temp/Dew sensor",
      reason: "Temperature and dewpoint both missing (M/M)",
    });
  }
  if (upper.includes(" A////") || upper.includes(" AM")) {
    reasons.push({ sensor: "Altimeter", reason: "Altimeter setting missing" });
  }
  if (upper.includes("/////KT")) {
    reasons.push({ sensor: "Wind sensor", reason: "Wind data missing" });
  }

  // 4. Generic fallback when $ is set but no specific code was found.
  if (hasMaintenanceFlag(metar) && reasons.length === 0) {
    reasons.push({
      sensor: "Internal check",
      reason: "ASOS self-test detected out-of-tolerance condition; " +
              "specific sensor not identified in METAR remarks",
    });
  }
  return reasons;
}

/** One-line summary for table display. Mirrors Python's
 *  `decode_reasons_short(metar, wxcodes)`. */
export function decodeReasonsShort(
  metar: string | null | undefined,
  wxcodes?: string | null,
): string {
  const reasons = decodeMaintenanceReasons(metar);
  if (!reasons.length) return "";
  let summary = reasons.map((r) => r.sensor).join(" · ");

  if (wxcodes) {
    const wx = wxcodes.trim();
    if (wx) {
      const URGENT = new Set(["TS", "FZRA", "FZDZ", "SN", "PL", "GR", "FG", "BLSN", "+RA"]);
      const codes = new Set(wx.replace(/,/g, " ").split(/\s+/).filter(Boolean));
      const urgent = [...codes].filter((c) => URGENT.has(c));
      if (urgent.length > 0) summary = `[${wx}] ${summary}`;
    }
  }
  return summary;
}
