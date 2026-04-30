/** GET /api/missing-stations — auto-exit MISSING buckets with >2-week alert tier.
 *
 *  Splits the live scan rows into FOUR buckets, finest-grain first:
 *    - over_3_days  : > 3 days  AND <= 7 days   (early-warning bucket)
 *    - over_1_week  : > 7 days  AND <= 14 days  (escalation bucket)
 *    - over_2_weeks : > 14 days                  (CRITICAL — full triage list)
 *    - all_missing  : every station with status == "MISSING" (the complete
 *                     live picture, no slicing — used by Admin to audit
 *                     the network end-to-end and by the AI brief)
 *
 *  Per the SUAD/ASOS team request: stations missing > 2 weeks must
 *  raise an alert on EVERY one of them — not a sample. The
 *  `over_2_weeks` array is intentionally unbounded so the UI can
 *  render the complete list, and the AI brief can cite each one.
 *
 *  Auto-exit: a station that recovers (any METAR within MISSING_SILENCE_MIN)
 *  drops out of every bucket on the next scan with no manual maintenance.
 *  Driven entirely off the live `minutes_since_last_report` field.
 */

import { NextResponse } from "next/server";
import { getScan, getScanReady } from "@/lib/server/scan-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THREE_DAYS_MIN = 3 * 24 * 60;     // 4320
const ONE_WEEK_MIN   = 7 * 24 * 60;     // 10080
const TWO_WEEKS_MIN  = 14 * 24 * 60;    // 20160

interface MissingRow {
  station: string;
  name?: string;
  state?: string;
  lat?: number;
  lon?: number;
  status: string;
  minutes_since_last_report: number;
  /** Pre-formatted human duration: "5d 14h" or "23d 8h". Saves the UI
   *  from re-formatting on every render. */
  silence_human: string;
  last_valid: string | null;
  probable_reason: string | null;
  /** True when minutes_since_last_report > 14 days — the alert tier. */
  alert: boolean;
}

function fmtSilence(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}m`;
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return `${d}d ${h}h`;
}

export async function GET() {
  await getScanReady();
  const scan = getScan();
  if (!scan) {
    return NextResponse.json({
      scanned_at: null,
      over_3_days: [],
      over_1_week: [],
      over_2_weeks: [],
      all_missing: [],
      counts: {
        over_3_days: 0,
        over_1_week: 0,
        over_2_weeks: 0,
        all_missing: 0,
      },
      warming: true,
    });
  }

  const over3: MissingRow[] = [];
  const over7: MissingRow[] = [];
  const over14: MissingRow[] = [];
  const allMissing: MissingRow[] = [];

  for (const row of scan.rows) {
    const m = row.minutes_since_last_report;
    const isMissing = row.status === "MISSING";

    // For the all_missing bucket we include MISSING regardless of
    // whether minutes is null (some stations never had data we saw,
    // which is itself the operational signal).
    if (isMissing) {
      const sil: MissingRow = {
        station: row.station,
        name: row.name,
        state: row.state,
        lat: row.lat,
        lon: row.lon,
        status: row.status,
        minutes_since_last_report: m ?? -1,
        silence_human: m != null ? fmtSilence(m) : "unknown",
        last_valid: row.last_valid,
        probable_reason: row.probable_reason,
        alert: m != null && m > TWO_WEEKS_MIN,
      };
      allMissing.push(sil);
    }

    // Tiered buckets need a numeric minutes value.
    if (m == null) continue;
    if (m <= THREE_DAYS_MIN) continue;
    const sil: MissingRow = {
      station: row.station,
      name: row.name,
      state: row.state,
      lat: row.lat,
      lon: row.lon,
      status: row.status,
      minutes_since_last_report: m,
      silence_human: fmtSilence(m),
      last_valid: row.last_valid,
      probable_reason: row.probable_reason,
      alert: m > TWO_WEEKS_MIN,
    };
    if (m > TWO_WEEKS_MIN) over14.push(sil);
    else if (m > ONE_WEEK_MIN) over7.push(sil);
    else over3.push(sil);
  }

  // Newest-silent-last: longest outages float to the top so operators
  // see the worst offenders first. The >2-week list is the alert
  // surface — every entry needs eyes.
  const byMinutesDesc = (a: MissingRow, b: MissingRow) =>
    b.minutes_since_last_report - a.minutes_since_last_report;
  over3.sort(byMinutesDesc);
  over7.sort(byMinutesDesc);
  over14.sort(byMinutesDesc);
  allMissing.sort(byMinutesDesc);

  return NextResponse.json({
    scanned_at: scan.scanned_at,
    over_3_days: over3,
    over_1_week: over7,
    over_2_weeks: over14,
    all_missing: allMissing,
    counts: {
      over_3_days: over3.length,
      over_1_week: over7.length,
      over_2_weeks: over14.length,
      all_missing: allMissing.length,
    },
  });
}
