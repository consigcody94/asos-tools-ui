/** Upper-air RAOB / radiosonde "thanks message" status.
 *
 *  NCO's thanks page at /status/data/thanks/?loc=usa lists every
 *  upper-air station's reception status for the most recent 00/12 Z
 *  launch. The format is a fixed-width text block with pairs:
 *
 *    70026 THKS 70133 abc  70200 abc  70219 THKS ...
 *
 *  where each WMO id is followed by a code:
 *    "THKS"      = all parts received (UP)
 *    lowercase   = parts present, some missing data (DEGRADED)
 *    empty/space = required parts missing (DOWN)
 *    "C"  alone  = parts ok but format quirks (UP)
 *
 *  Refreshed every 15 min upstream; we cache for 60 min.
 */

import { fetchText } from "./fetcher";

export interface UpperAirStatus {
  station: string;       // 5-digit WMO id (e.g. "72215")
  status: "UP" | "DEGRADED" | "DOWN";
  code: string;          // raw code (THKS / abc / "" / "C")
  last_message_z: string | null;
}

const SOURCE = "https://www.nco.ncep.noaa.gov/status/data/thanks/?loc=usa";
const TTL_MS = 60 * 60 * 1000;

let _cache: { at: number; rows: UpperAirStatus[] } | null = null;

export async function upperAirStatuses(): Promise<UpperAirStatus[]> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  try {
    const html = await fetchText(SOURCE, { timeoutMs: 20_000 });
    if (!html) return _cache?.rows ?? [];
    const rows = parse(html);
    _cache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.warn("[upper-air] fetch failed:", (err as Error).message);
    return _cache?.rows ?? [];
  }
}

function parse(html: string): UpperAirStatus[] {
  // Pull the message block — between "RECEIPT MESSAGE FOR" and "Group A".
  const messageMatch = html.match(/RECEIPT MESSAGE FOR\s+(\d{8})\s+(\d{2})\s+UTC:[\s\S]*?(?=Group A)/i);
  if (!messageMatch) return [];
  const [, ymd, hh] = messageMatch;
  const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hh}:00:00Z`;

  // Strip header lines (the body starts with two-line preamble — skip those).
  const body = messageMatch[0]
    .split(/\r?\n/)
    .filter((ln) => /^\s+\d{5}/.test(ln))   // only lines starting with a 5-digit WMO id
    .join("\n");

  // Each station is a 9-char field: "NNNNN CCCC" where CCCC is "THKS",
  // 3 lowercase letters padded with a space, "C   ", or 4 spaces.
  // Use a regex that captures 5-digit id + up to 4 trailing chars.
  const out: UpperAirStatus[] = [];
  const re = /(\d{5})\s+([A-Za-z]{0,4})/g;
  for (const m of body.matchAll(re)) {
    const [, station, codeRaw] = m;
    const code = codeRaw.trim();
    let status: UpperAirStatus["status"] = "DOWN";
    if (code === "THKS" || code === "C") status = "UP";
    else if (code.length > 0) status = "DEGRADED";
    out.push({ station, status, code, last_message_z: iso });
  }
  return out;
}
