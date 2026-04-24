/** Full ICAO METAR decoder.
 *
 *  Parses the standard METAR/SPECI format into a typed structure —
 *  station, time, wind, visibility, weather phenomena, clouds, temp/
 *  dewpoint, altimeter, and the remarks block. Shape is designed to be
 *  roughly interchangeable with `avwx-engine`'s output so the UI can
 *  render either side-by-side.
 *
 *  Coverage target: 95% of well-formed US ASOS METARs. Non-standard
 *  formats (BECMG, TEMPO groups from TAFs, military ROD reports) are
 *  skipped — those aren't emitted by ASOS so it's not a concern.
 */

import { decodeMaintenanceReasons, type MaintenanceReason } from "./metar-reasons";

export type CloudCoverage =
  | "SKC" | "CLR" | "NCD" | "NSC"
  | "FEW" | "SCT" | "BKN" | "OVC"
  | "VV";           // vertical visibility (obscured)

export interface WindGroup {
  direction: number | "VRB" | null;     // 000-360 or "VRB" (variable < 3 kt)
  speed_kt: number | null;
  gust_kt: number | null;
  variable_from: number | null;          // Vddd{from}Vddd{to} range
  variable_to: number | null;
}

export interface CloudLayer {
  coverage: CloudCoverage;
  height_ft: number | null;              // AGL in feet (METAR reports 100-ft increments)
  type: "TCU" | "CB" | null;             // towering cumulus / cumulonimbus
}

export type WeatherIntensity = "light" | "moderate" | "heavy" | "in the vicinity";

export interface WeatherGroup {
  raw: string;
  intensity: WeatherIntensity;
  descriptor: string | null;
  phenomena: string[];
  text: string;                          // human-readable phrase
}

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";

export interface DecodedMetar {
  raw: string;
  station: string;
  /** "DDHHmmZ" → ISO 8601. Month/year inferred from parse-time. */
  observed_at: string | null;
  modifier: "AUTO" | "COR" | null;
  wind: WindGroup | null;
  visibility_sm: number | null;
  visibility_text: string | null;         // human: "10 SM", "1 1/2 SM", "CAVOK"
  weather: WeatherGroup[];
  clouds: CloudLayer[];
  sky_summary: string | null;             // "Overcast 2500 ft", "Clear", etc.
  temperature_c: number | null;
  temperature_f: number | null;
  dewpoint_c: number | null;
  dewpoint_f: number | null;
  altimeter_inhg: number | null;
  altimeter_hpa: number | null;
  ceiling_ft: number | null;              // lowest BKN/OVC/VV layer
  flight_category: FlightCategory | null;
  remarks: string | null;                 // everything after "RMK"
  has_maintenance: boolean;
  maintenance_reasons: MaintenanceReason[];
}

// --- Dictionaries (avwx-compatible wording) --------------------------------

const WEATHER_INTENSITY: Record<string, WeatherIntensity> = {
  "+":  "heavy",
  "-":  "light",
  "":   "moderate",
  VC:   "in the vicinity",
};

const WEATHER_DESCRIPTOR: Record<string, string> = {
  MI: "shallow", PR: "partial", BC: "patches of", DR: "low-drifting",
  BL: "blowing", SH: "showers of", TS: "thunderstorm with",
  FZ: "freezing",
};

const WEATHER_PHENOMENA: Record<string, string> = {
  // Precipitation
  DZ: "drizzle", RA: "rain", SN: "snow", SG: "snow grains",
  IC: "ice crystals", PL: "ice pellets", GR: "hail", GS: "small hail",
  UP: "unknown precipitation",
  // Obscuration
  BR: "mist", FG: "fog", FU: "smoke", VA: "volcanic ash",
  DU: "widespread dust", SA: "sand", HZ: "haze",
  PY: "spray",
  // Other
  PO: "dust whirls", SQ: "squall", FC: "funnel cloud",
  SS: "sandstorm", DS: "duststorm",
};

const CLOUD_COVERAGE_LABEL: Record<CloudCoverage, string> = {
  SKC: "clear sky", CLR: "clear below 12,000 ft", NCD: "no clouds detected",
  NSC: "no significant cloud", FEW: "few", SCT: "scattered",
  BKN: "broken", OVC: "overcast", VV: "vertical visibility",
};

// --- Parser -----------------------------------------------------------------

function fToC(f: number) { return Math.round(((f - 32) * 5 / 9) * 10) / 10; }
function cToF(c: number) { return Math.round((c * 9 / 5 + 32) * 10) / 10; }
function inhgToHpa(v: number) { return Math.round(v * 33.8639 * 10) / 10; }

/** Convert a METAR-encoded temperature (e.g. "M05", "23") to number °C. */
function parseTempC(s: string): number | null {
  const m = s.match(/^(M?)(\d{2,3})$/);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  if (!Number.isFinite(n)) return null;
  return m[1] === "M" ? -n : n;
}

/** Parse fractional visibility like "1 1/2" or "3/4". Integer prefix optional. */
function parseVisibilityGroup(tokens: string[], i: number): { value: number; consumed: number } | null {
  // "CAVOK" is handled separately by caller.
  const tok = tokens[i];
  if (!tok) return null;

  // Whole number + SM (e.g. "10SM")
  let m = tok.match(/^(\d+)(\/\d+)?SM$/);
  if (m) {
    const whole = parseInt(m[1], 10);
    const frac = m[2] ? evalFraction(m[2].slice(1)) : 0;
    return { value: whole + frac, consumed: 1 };
  }
  // Fraction-only ("3/4SM")
  m = tok.match(/^(\d+)\/(\d+)SM$/);
  if (m) {
    return { value: parseInt(m[1], 10) / parseInt(m[2], 10), consumed: 1 };
  }
  // Two-token split: "1 1/2SM" — first token is integer, next is "X/YSM"
  if (/^\d+$/.test(tok) && tokens[i + 1]) {
    const next = tokens[i + 1];
    const nm = next.match(/^(\d+)\/(\d+)SM$/);
    if (nm) {
      const whole = parseInt(tok, 10);
      const num = parseInt(nm[1], 10), den = parseInt(nm[2], 10);
      return { value: whole + num / den, consumed: 2 };
    }
  }
  // Metric (4-digit metres) — treat as approx SM (1600m ≈ 1 SM)
  if (/^\d{4}$/.test(tok) && !/KT$/.test(tok)) {
    const metres = parseInt(tok, 10);
    if (metres === 9999) return { value: 10, consumed: 1 };
    return { value: Math.round(metres / 1609.344 * 100) / 100, consumed: 1 };
  }
  return null;
}

function evalFraction(s: string): number {
  const [num, den] = s.split("/");
  const n = parseInt(num, 10), d = parseInt(den, 10);
  if (!d) return 0;
  return n / d;
}

function parseWind(tok: string): WindGroup | null {
  // Formats:
  //   dddffKT        "27015KT"
  //   dddffGggKT     "27015G25KT"
  //   VRBffKT        "VRB04KT"
  //   00000KT        calm
  //   /////KT        all-missing
  if (!/KT$/.test(tok)) return null;
  if (tok === "00000KT") {
    return { direction: 0, speed_kt: 0, gust_kt: null, variable_from: null, variable_to: null };
  }
  if (tok.startsWith("/////")) {
    return { direction: null, speed_kt: null, gust_kt: null, variable_from: null, variable_to: null };
  }
  const m = tok.match(/^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT$/);
  if (!m) return null;
  const dir = m[1] === "VRB" ? "VRB" : parseInt(m[1], 10);
  const speed = parseInt(m[2], 10);
  const gust = m[3] ? parseInt(m[3], 10) : null;
  return {
    direction: dir,
    speed_kt: Number.isFinite(speed) ? speed : null,
    gust_kt: gust,
    variable_from: null,
    variable_to: null,
  };
}

function parseWeather(tok: string): WeatherGroup | null {
  // Intensity prefix "+", "-", "VC" optional.
  let rest = tok;
  let intensityKey: keyof typeof WEATHER_INTENSITY = "";
  if (rest.startsWith("+")) { intensityKey = "+"; rest = rest.slice(1); }
  else if (rest.startsWith("-")) { intensityKey = "-"; rest = rest.slice(1); }
  else if (rest.startsWith("VC")) { intensityKey = "VC"; rest = rest.slice(2); }
  const intensity = WEATHER_INTENSITY[intensityKey];

  // Remainder is pairs of 2-letter codes: optional descriptor + one or more phenomena.
  if (rest.length === 0 || rest.length % 2 !== 0) return null;
  const codes: string[] = [];
  for (let i = 0; i < rest.length; i += 2) codes.push(rest.slice(i, i + 2));

  // First code might be a descriptor (MI, PR, TS, SH, FZ, BL, DR, BC).
  let descriptor: string | null = null;
  let phenomenaStart = 0;
  if (codes[0] && WEATHER_DESCRIPTOR[codes[0]]) {
    descriptor = WEATHER_DESCRIPTOR[codes[0]];
    phenomenaStart = 1;
  }
  const phenomena: string[] = [];
  for (let i = phenomenaStart; i < codes.length; i++) {
    const p = WEATHER_PHENOMENA[codes[i]];
    if (p) phenomena.push(p);
  }
  // If none of the codes matched a known phenomenon or descriptor, this isn't
  // really a weather token — reject it so the caller doesn't consume a cloud
  // or temp token by accident.
  if (!descriptor && phenomena.length === 0) return null;

  const parts: string[] = [];
  if (intensity !== "moderate") parts.push(intensity);
  if (descriptor) parts.push(descriptor);
  parts.push(phenomena.join(", "));
  const text = parts.filter(Boolean).join(" ");

  return { raw: tok, intensity, descriptor, phenomena, text };
}

function parseCloud(tok: string): CloudLayer | null {
  // SKC / CLR / NCD / NSC — no height.
  if (tok === "SKC" || tok === "CLR" || tok === "NCD" || tok === "NSC") {
    return { coverage: tok, height_ft: null, type: null };
  }
  // VV### (vertical vis when obscured)
  let m = tok.match(/^VV(\d{3})$/);
  if (m) return { coverage: "VV", height_ft: parseInt(m[1], 10) * 100, type: null };
  // FEW/SCT/BKN/OVC + 3-digit height + optional type (TCU/CB)
  m = tok.match(/^(FEW|SCT|BKN|OVC)(\d{3})(TCU|CB)?$/);
  if (m) {
    return {
      coverage: m[1] as CloudCoverage,
      height_ft: parseInt(m[2], 10) * 100,
      type: (m[3] as "TCU" | "CB" | undefined) ?? null,
    };
  }
  return null;
}

function parseTempDew(tok: string): { t_c: number | null; d_c: number | null } | null {
  const m = tok.match(/^(M?\d{2})\/(M?\d{2})?$/);
  if (!m) return null;
  const tC = parseTempC(m[1]);
  const dC = m[2] ? parseTempC(m[2]) : null;
  if (tC === null && dC === null) return null;
  return { t_c: tC, d_c: dC };
}

function parseAltimeter(tok: string): { inhg: number; hpa: number } | null {
  // A2992 (inHg × 100) or Q1013 (hPa)
  let m = tok.match(/^A(\d{4})$/);
  if (m) {
    const inhg = parseInt(m[1], 10) / 100;
    return { inhg, hpa: inhgToHpa(inhg) };
  }
  m = tok.match(/^Q(\d{4})$/);
  if (m) {
    const hpa = parseInt(m[1], 10);
    return { inhg: Math.round((hpa / 33.8639) * 100) / 100, hpa };
  }
  return null;
}

/** Parse a METAR DDHHmmZ token into an ISO 8601 string. */
function parseIsoTime(tok: string, reference: Date): string | null {
  const m = tok.match(/^(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10), hh = parseInt(m[2], 10), mm = parseInt(m[3], 10);
  const y = reference.getUTCFullYear();
  const mo = reference.getUTCMonth();
  let d = new Date(Date.UTC(y, mo, dd, hh, mm, 0));
  if (d.getTime() > reference.getTime() + 6 * 3600_000) {
    d = new Date(Date.UTC(y, mo - 1, dd, hh, mm, 0));
  }
  return d.toISOString();
}

function flightCategoryOf(vis_sm: number | null, ceiling_ft: number | null): FlightCategory {
  const v = vis_sm ?? 99;
  const c = ceiling_ft ?? 99_000;
  if (v < 1 || c < 500) return "LIFR";
  if (v < 3 || c < 1000) return "IFR";
  if (v <= 5 || c <= 3000) return "MVFR";
  return "VFR";
}

function skySummary(layers: CloudLayer[]): string {
  if (layers.length === 0) return "No cloud data";
  if (layers.some((l) => l.coverage === "SKC" || l.coverage === "CLR")) return "Clear sky";
  const lowest = [...layers]
    .filter((l) => l.height_ft !== null)
    .sort((a, b) => (a.height_ft! - b.height_ft!))[0];
  if (!lowest) return "No cloud data";
  const label = CLOUD_COVERAGE_LABEL[lowest.coverage];
  const ft = lowest.height_ft!;
  const suffix = lowest.type === "CB" ? " (cumulonimbus)" :
                 lowest.type === "TCU" ? " (towering cumulus)" : "";
  return `${label.charAt(0).toUpperCase() + label.slice(1)} ${ft.toLocaleString()} ft${suffix}`;
}

function ceilingOf(layers: CloudLayer[]): number | null {
  // Ceiling = lowest BKN/OVC/VV layer height.
  const candidates = layers.filter((l) =>
    (l.coverage === "BKN" || l.coverage === "OVC" || l.coverage === "VV") &&
    l.height_ft !== null,
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates.map((l) => l.height_ft!));
}

// --- Entry point -----------------------------------------------------------

export function decodeMetar(raw: string, reference: Date = new Date()): DecodedMetar {
  const out: DecodedMetar = {
    raw,
    station: "",
    observed_at: null,
    modifier: null,
    wind: null,
    visibility_sm: null,
    visibility_text: null,
    weather: [],
    clouds: [],
    sky_summary: null,
    temperature_c: null,
    temperature_f: null,
    dewpoint_c: null,
    dewpoint_f: null,
    altimeter_inhg: null,
    altimeter_hpa: null,
    ceiling_ft: null,
    flight_category: null,
    remarks: null,
    has_maintenance: false,
    maintenance_reasons: [],
  };
  const cleaned = (raw || "").trim().replace(/[=$]\s*$/, (x) => {
    // Preserve the '$' detection but strip trailing '=' terminator.
    return x;
  });
  if (!cleaned) return out;

  // Split on the RMK keyword — everything after goes into remarks.
  const [bodyRaw, ...rest] = cleaned.split(/\sRMK\s/);
  const remarks = rest.length ? rest.join(" RMK ").trim() : null;
  out.remarks = remarks;

  const tokens = bodyRaw.split(/\s+/).filter(Boolean);
  let i = 0;

  // Some reports start with "METAR" / "SPECI" prefix — skip.
  if (tokens[i] === "METAR" || tokens[i] === "SPECI") i++;

  // Station (4-letter ICAO).
  if (tokens[i] && /^[A-Z]{4}$/.test(tokens[i])) {
    out.station = tokens[i];
    i++;
  }

  // Time (DDHHmmZ).
  if (tokens[i] && /^\d{6}Z$/.test(tokens[i])) {
    out.observed_at = parseIsoTime(tokens[i], reference);
    i++;
  }

  // Optional modifier.
  if (tokens[i] === "AUTO" || tokens[i] === "COR") {
    out.modifier = tokens[i] as "AUTO" | "COR";
    i++;
  }

  // Wind.
  if (tokens[i]) {
    const w = parseWind(tokens[i]);
    if (w) { out.wind = w; i++; }
  }
  // Variable-wind group Vddd{from}Vddd{to}, e.g. "240V300"
  if (tokens[i] && /^\d{3}V\d{3}$/.test(tokens[i]) && out.wind) {
    const [from, to] = tokens[i].split("V").map((s) => parseInt(s, 10));
    out.wind.variable_from = from;
    out.wind.variable_to = to;
    i++;
  }

  // CAVOK shortcut (overrides vis + cloud + weather).
  if (tokens[i] === "CAVOK") {
    out.visibility_sm = 10;
    out.visibility_text = "CAVOK (≥ 6 SM, no sig cloud < 5000 ft, no sig wx)";
    i++;
  } else {
    // Visibility.
    const vis = parseVisibilityGroup(tokens, i);
    if (vis) {
      out.visibility_sm = vis.value;
      out.visibility_text = formatVisibility(vis.value);
      i += vis.consumed;
    }
  }

  // Runway Visual Range groups (R06/1000FT, etc.) — consume and skip.
  while (tokens[i] && /^R\d{2}[LCR]?\//.test(tokens[i])) i++;

  // Weather + cloud layers + temp/dewpoint + altimeter.
  while (tokens[i]) {
    const tok = tokens[i];

    // Weather
    const wx = parseWeather(tok);
    if (wx) { out.weather.push(wx); i++; continue; }

    // Cloud layer
    const cloud = parseCloud(tok);
    if (cloud) { out.clouds.push(cloud); i++; continue; }

    // Temp/Dew (M05/M10, 23/18, 23/M02)
    const td = parseTempDew(tok);
    if (td) {
      out.temperature_c = td.t_c;
      out.temperature_f = td.t_c === null ? null : cToF(td.t_c);
      out.dewpoint_c = td.d_c;
      out.dewpoint_f = td.d_c === null ? null : cToF(td.d_c);
      i++;
      continue;
    }

    // Altimeter
    const alt = parseAltimeter(tok);
    if (alt) {
      out.altimeter_inhg = alt.inhg;
      out.altimeter_hpa = alt.hpa;
      i++;
      continue;
    }

    // Unknown — skip.
    i++;
  }

  out.ceiling_ft = ceilingOf(out.clouds);
  out.sky_summary = skySummary(out.clouds);
  out.flight_category = flightCategoryOf(out.visibility_sm, out.ceiling_ft);

  // Maintenance detection (looks at the raw body + remarks).
  const bodyForFlag = raw.trimEnd().replace(/=+$/, "").trim();
  out.has_maintenance = bodyForFlag.endsWith("$");
  out.maintenance_reasons = decodeMaintenanceReasons(raw);

  return out;
}

function formatVisibility(sm: number): string {
  if (sm >= 10) return `${sm.toFixed(0)} SM`;
  if (sm >= 1) {
    // Try to render as "N 1/2 SM" if close to a common fraction.
    const whole = Math.floor(sm);
    const frac = sm - whole;
    if (Math.abs(frac) < 0.01) return `${whole} SM`;
    if (Math.abs(frac - 0.25) < 0.01) return `${whole} 1/4 SM`;
    if (Math.abs(frac - 0.5) < 0.01)  return `${whole} 1/2 SM`;
    if (Math.abs(frac - 0.75) < 0.01) return `${whole} 3/4 SM`;
    return `${sm.toFixed(2)} SM`;
  }
  // Sub-1 miles — keep precise.
  if (Math.abs(sm - 0.25) < 0.01) return "1/4 SM";
  if (Math.abs(sm - 0.5) < 0.01)  return "1/2 SM";
  if (Math.abs(sm - 0.75) < 0.01) return "3/4 SM";
  return `${sm.toFixed(2)} SM`;
}

// Re-export common helpers.
export { fToC, cToF, inhgToHpa };
