/** METAR decoder v2 — adapter over the `metar-taf-parser` npm package.
 *
 *  Replaces our hand-rolled 485-line metar-decode.ts with a battle-tested
 *  TS-native parser (MIT license, 9.x major version, actively
 *  maintained). The public DecodedMetar interface is preserved exactly
 *  so every caller — drill panel, decoded-metar API endpoint, AI
 *  brief — keeps working without changes.
 *
 *  Why swap: the upstream library is a TS port of the well-validated
 *  python-metar-taf-parser, handles edge cases we silently dropped
 *  (international AUTO/COR flags, runway visibility, RVR, vertical
 *  visibility, wind shear, weather condition combinations, dozens of
 *  remark types), and gives us free TAF support we didn't have at all.
 *
 *  Domain-specific maintenance-flag decoding (PWINO, FZRANO, $ flag
 *  presence) stays in metar-reasons.ts — that's an OWL-specific
 *  operational layer the upstream parser doesn't model.
 */

import { CloudQuantity, parseMetar, type IMetar } from "metar-taf-parser";
import {
  decodeMaintenanceReasons,
  hasMaintenanceFlag,
} from "./metar-reasons";
import type {
  CloudCoverage,
  CloudLayer,
  DecodedMetar,
  FlightCategory,
  WeatherGroup,
  WindGroup,
} from "./metar-decode";

// ---- Unit converters ------------------------------------------------------

const cToF = (c: number | undefined): number | null =>
  c == null ? null : Math.round((c * 9 / 5 + 32) * 10) / 10;

/** SpeedUnit values from metar-taf-parser are "KT" | "MPS" | "KM/H".
 *  We canonicalize to knots since that's what every US METAR uses. */
function toKnots(value: number | undefined, unit?: string): number | null {
  if (value == null) return null;
  if (!unit || unit === "KT") return value;
  if (unit === "MPS") return Math.round(value * 1.94384 * 10) / 10;
  if (unit === "KM/H") return Math.round(value * 0.539957 * 10) / 10;
  return value;
}

/** Distance unit. parser emits "SM" | "M" | "KM". Convert to statute miles. */
function toStatuteMiles(value: number | undefined, unit?: string): number | null {
  if (value == null) return null;
  if (!unit || unit === "SM") return value;
  if (unit === "M") return Math.round((value / 1609.344) * 100) / 100;
  if (unit === "KM") return Math.round(value * 0.621371 * 100) / 100;
  return value;
}

/** Altimeter unit. Parser emits "hPa" | "inHg". */
function altimeterToInhg(value: number | undefined, unit?: string): number | null {
  if (value == null) return null;
  if (unit === "inHg") return value;
  if (unit === "hPa") return Math.round((value / 33.8639) * 100) / 100;
  return value;
}

function altimeterToHpa(value: number | undefined, unit?: string): number | null {
  if (value == null) return null;
  if (unit === "hPa") return value;
  if (unit === "inHg") return Math.round(value * 33.8639 * 10) / 10;
  return value;
}

// ---- Cloud coverage map ---------------------------------------------------

/** Map metar-taf-parser CloudQuantity → our CloudCoverage. CLR/NCD/SKC
 *  collapse to SKC since they're effectively interchangeable in METARs;
 *  the UI already treats them as "Clear." */
function mapCloudQuantity(q: CloudQuantity): CloudCoverage {
  switch (q) {
    case CloudQuantity.SKC: return "SKC";
    case CloudQuantity.NSC: return "NSC";
    case CloudQuantity.FEW: return "FEW";
    case CloudQuantity.SCT: return "SCT";
    case CloudQuantity.BKN: return "BKN";
    case CloudQuantity.OVC: return "OVC";
  }
}

function cloudHeightFt(height: number | undefined): number | null {
  // Parser returns hundreds-of-feet AGL. Multiply for ft.
  return height == null ? null : height * 100;
}

// ---- Flight category derivation -------------------------------------------

function deriveFlightCategory(
  visibilitySM: number | null,
  ceilingFt: number | null,
): FlightCategory | null {
  if (visibilitySM == null && ceilingFt == null) return null;
  const v = visibilitySM ?? 99;
  const c = ceilingFt ?? 99_999;
  if (v < 1 || c < 500) return "LIFR";
  if (v < 3 || c < 1_000) return "IFR";
  if (v <= 5 || c <= 3_000) return "MVFR";
  return "VFR";
}

// ---- Weather phenomenon text ----------------------------------------------

const PHEN_TEXT: Record<string, string> = {
  RA: "rain", SN: "snow", DZ: "drizzle", PL: "ice pellets", GR: "hail",
  GS: "small hail", BR: "mist", FG: "fog", HZ: "haze", SA: "sand",
  DU: "dust", FU: "smoke", VA: "volcanic ash", PY: "spray", PO: "dust whirls",
  SQ: "squalls", FC: "funnel cloud", SS: "sandstorm", DS: "duststorm",
  TS: "thunderstorm", IC: "ice crystals", SG: "snow grains", UP: "unknown precip",
};

const DESC_TEXT: Record<string, string> = {
  MI: "shallow", PR: "partial", BC: "patches of", DR: "low-drifting",
  BL: "blowing", SH: "showers of", TS: "thunderstorm with", FZ: "freezing",
};

const INT_TEXT: Record<string, string> = {
  "+": "heavy", "-": "light", "VC": "in the vicinity", "": "moderate",
};

function buildWeatherText(w: {
  intensity?: string;
  descriptive?: string;
  phenomenons?: string[];
}): string {
  const parts: string[] = [];
  if (w.intensity && INT_TEXT[w.intensity]) parts.push(INT_TEXT[w.intensity]);
  if (w.descriptive && DESC_TEXT[w.descriptive]) parts.push(DESC_TEXT[w.descriptive]);
  for (const p of w.phenomenons ?? []) {
    if (PHEN_TEXT[p]) parts.push(PHEN_TEXT[p]);
  }
  return parts.join(" ").trim() || "weather";
}

function rebuildWeatherRaw(w: {
  intensity?: string;
  descriptive?: string;
  phenomenons?: string[];
}): string {
  let s = w.intensity ?? "";
  if (w.descriptive) s += w.descriptive;
  for (const p of w.phenomenons ?? []) s += p;
  return s;
}

// ---- Sky summary ----------------------------------------------------------

function summarizeSky(clouds: CloudLayer[]): string | null {
  if (clouds.length === 0) return "Clear";
  // Highest-coverage layer wins for the headline summary.
  const ordered: CloudCoverage[] = ["OVC", "BKN", "VV", "SCT", "FEW", "NSC", "NCD", "SKC", "CLR"];
  for (const cov of ordered) {
    const layer = clouds.find((c) => c.coverage === cov);
    if (layer) {
      const cn: Record<CloudCoverage, string> = {
        SKC: "Clear", CLR: "Clear", NCD: "No clouds detected",
        NSC: "No significant clouds",
        FEW: "Few clouds", SCT: "Scattered clouds",
        BKN: "Broken", OVC: "Overcast", VV: "Vertical visibility",
      };
      const base = cn[cov];
      return layer.height_ft != null ? `${base} ${layer.height_ft.toLocaleString()} ft` : base;
    }
  }
  return null;
}

// ---- Observation timestamp ------------------------------------------------

/** parser returns DDHHmm pieces; combine with the current UTC year/month
 *  to produce a full ISO timestamp. If the day/hour pair would put the
 *  observation in the future (e.g., parsing on the 1st a METAR with
 *  day=31), we roll back one month — same trick our hand-rolled parser
 *  uses. */
function buildObservedAt(m: IMetar, now: Date = new Date()): string | null {
  if (m.day == null || m.hour == null) return null;
  const minute = m.minute ?? 0;
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  const candidate = new Date(Date.UTC(year, month, m.day, m.hour, minute));
  if (candidate.getTime() - now.getTime() > 24 * 3_600_000) {
    // More than a day in the future — must have rolled to last month.
    if (month === 0) { month = 11; year -= 1; } else month -= 1;
    return new Date(Date.UTC(year, month, m.day, m.hour, minute)).toISOString();
  }
  return candidate.toISOString();
}

// ---- Wind mapping ---------------------------------------------------------

function mapWind(w: IMetar["wind"]): WindGroup | null {
  if (!w) return null;
  return {
    direction: w.degrees != null ? w.degrees : (w.direction === "VRB" ? "VRB" : null),
    speed_kt: toKnots(w.speed, w.unit),
    gust_kt: toKnots(w.gust, w.unit),
    variable_from: w.minVariation != null ? w.minVariation : null,
    variable_to: w.maxVariation != null ? w.maxVariation : null,
  };
}

// ---- Public entry point ---------------------------------------------------

/** Decode a raw METAR string. Returns null when the input doesn't parse
 *  at all (rare); on partial parse, populates whatever fields succeeded
 *  and leaves the rest null. Mirrors the public contract of the legacy
 *  decodeMetar() so callers don't need to change. */
export function decodeMetar(raw: string): DecodedMetar | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let m: IMetar;
  try {
    m = parseMetar(trimmed);
  } catch (err) {
    // Parser throws on completely unparseable input. Surface a minimal
    // record with the raw text + maintenance flag detection so the UI
    // never sees a hard null when there's at least *some* signal.
    console.warn("[metar-decode] parseMetar threw:", (err as Error).message);
    return {
      raw: trimmed,
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
      has_maintenance: hasMaintenanceFlag(trimmed),
      maintenance_reasons: decodeMaintenanceReasons(trimmed),
    };
  }

  const clouds: CloudLayer[] = (m.clouds ?? []).map((c) => ({
    coverage: mapCloudQuantity(c.quantity),
    height_ft: cloudHeightFt(c.height),
    type: c.type === "CB" ? "CB" : c.type === "TCU" ? "TCU" : null,
  }));

  // Ceiling = lowest BKN/OVC/VV layer.
  const ceilingFt =
    clouds.find((c) => c.coverage === "BKN" || c.coverage === "OVC")?.height_ft ?? null;

  const visibilitySM = toStatuteMiles(m.visibility?.value, m.visibility?.unit);

  const weather: WeatherGroup[] = (m.weatherConditions ?? []).map((w) => ({
    raw: rebuildWeatherRaw(w),
    intensity: ((): WeatherGroup["intensity"] => {
      if (w.intensity === "+") return "heavy";
      if (w.intensity === "-") return "light";
      if (w.intensity === "VC") return "in the vicinity";
      return "moderate";
    })(),
    descriptor: w.descriptive ?? null,
    phenomena: [...(w.phenomenons ?? [])],
    text: buildWeatherText(w),
  }));

  return {
    raw: trimmed,
    station: m.station ?? "",
    observed_at: buildObservedAt(m),
    modifier: m.auto ? "AUTO" : m.corrected ? "COR" : null,
    wind: mapWind(m.wind),
    visibility_sm: visibilitySM,
    visibility_text: m.cavok
      ? "CAVOK"
      : visibilitySM != null
      ? visibilitySM >= 6
        ? "≥ 6 SM"
        : `${visibilitySM} SM`
      : null,
    weather,
    clouds,
    sky_summary: summarizeSky(clouds),
    temperature_c: m.temperature ?? null,
    temperature_f: cToF(m.temperature),
    dewpoint_c: m.dewPoint ?? null,
    dewpoint_f: cToF(m.dewPoint),
    altimeter_inhg: altimeterToInhg(m.altimeter?.value, m.altimeter?.unit),
    altimeter_hpa: altimeterToHpa(m.altimeter?.value, m.altimeter?.unit),
    ceiling_ft: ceilingFt,
    flight_category: deriveFlightCategory(visibilitySM, ceilingFt),
    remarks: m.remark ?? null,
    has_maintenance: hasMaintenanceFlag(trimmed),
    maintenance_reasons: decodeMaintenanceReasons(trimmed),
  };
}
