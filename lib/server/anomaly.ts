/** Lightweight anomaly detector for ASOS scan time-series.
 *
 *  This is *not* a true Matrix Profile (stumpy) port — that would require
 *  Python and a microservice. Instead we use a per-station rolling z-score
 *  on `minutes_since_last_report`, which is the signal the human operator
 *  actually looks at when triaging.  A station whose lateness suddenly
 *  jumps several standard deviations above its own normal is flagged.
 *
 *  Output is a queue of (station, severity, window) tuples that the Admin
 *  UI can render. State is held in memory; restart re-warms naturally.
 */

import { getScan } from "./scan-cache";

const WINDOW = 24;
const Z_THRESH = 3.0;

interface Sample {
  at: number;
  minutes: number;
}

const history: Map<string, Sample[]> = new Map();

export interface AnomalyFinding {
  station: string;
  state?: string;
  severity: number;        // higher = more anomalous
  z: number;               // z-score that triggered
  current_minutes: number;
  baseline_mean: number;
  baseline_std: number;
  detected_at: string;
}

let lastFindings: AnomalyFinding[] = [];
let lastTickAt = 0;

/** Walk the latest scan, push samples into per-station history, recompute. */
export function tick(): AnomalyFinding[] {
  const scan = getScan();
  if (!scan) return lastFindings;
  const now = Date.now();
  const findings: AnomalyFinding[] = [];

  for (const row of scan.rows) {
    const m = row.minutes_since_last_report;
    if (typeof m !== "number" || !Number.isFinite(m)) continue;
    let series = history.get(row.station);
    if (!series) {
      series = [];
      history.set(row.station, series);
    }
    series.push({ at: now, minutes: m });
    if (series.length > WINDOW) series.shift();
    if (series.length < WINDOW) continue;

    const slice = series.slice(0, WINDOW - 1);  // baseline excludes current
    const mean = slice.reduce((s, x) => s + x.minutes, 0) / slice.length;
    const variance =
      slice.reduce((s, x) => s + (x.minutes - mean) ** 2, 0) / slice.length;
    const std = Math.sqrt(variance);
    if (std < 1) continue;  // station is rock-steady; nothing to flag

    const current = series[series.length - 1].minutes;
    const z = (current - mean) / std;
    if (z >= Z_THRESH) {
      findings.push({
        station: row.station,
        state: row.state,
        severity: Math.round(z * 100) / 100,
        z: Math.round(z * 100) / 100,
        current_minutes: current,
        baseline_mean: Math.round(mean * 10) / 10,
        baseline_std: Math.round(std * 10) / 10,
        detected_at: new Date(now).toISOString(),
      });
    }
  }

  findings.sort((a, b) => b.severity - a.severity);
  lastFindings = findings;
  lastTickAt = now;
  return findings;
}

export function findings(): { findings: AnomalyFinding[]; tick_at: string | null } {
  return {
    findings: lastFindings,
    tick_at: lastTickAt ? new Date(lastTickAt).toISOString() : null,
  };
}
