/** History-aware INTERMITTENT classifier refinement.
 *
 *  Per the SUAD/ASOS team's precise operational definition:
 *
 *    "INTERMITTENT means a METAR doesn't come in for a site for 3 hours
 *     so it misses 3 metars but on the 4th it comes back then the 5th
 *     it clears. FLAGGED → recovered does NOT make it intermittent —
 *     a flagged station that recovers is just fine."
 *
 *  This is a *very specific* signal: only sustained MISSING runs
 *  followed by recovery count. FLAGGED transitions don't count toward
 *  intermittent — they're sensor maintenance events, not communication
 *  problems. The two patterns that trigger INTERMITTENT:
 *
 *    1. Recovery from sustained MISSING — log shows ≥3 consecutive
 *       MISSING entries followed by ≥1 OK entry. Means the station's
 *       comm/data path was down for 3+ hours and just came back; we
 *       label it INTERMITTENT until it's been clean for several more
 *       hours, signaling the gap pattern is meaningful for ops triage.
 *
 *    2. Active flapping in the MISSING dimension — log shows multiple
 *       MISSING runs separated by short OK windows (e.g., MISSING 3h →
 *       OK 1h → MISSING 2h → OK 1h). The connectivity is intermittent
 *       and likely going to fail again.
 *
 *  Critically NOT triggered:
 *    - FLAGGED → OK         : station reported, sensor cleared its $.
 *    - FLAGGED → FLAGGED... : station is FLAGGED, not INTERMITTENT.
 *    - Single MISSING hour  : just MISSING this hour, may report next.
 *    - Continuous OK        : CLEAN. Bucket noise can't override.
 *
 *  Implementation: walk the rolling 6-hour state_log, look for the
 *  specific MISSING-run-followed-by-OK signature. The single-window
 *  classifier in iem.ts produces a first-pass status from current
 *  METARs alone; this module then refines using the persistent
 *  state_log carried by scan-cache._lastKnown across scans.
 */

import type { ScanRow, StateLogEntry } from "./types";

/** Maximum entries the state log carries. Six hourly buckets covers a
 *  full operator-shift window and is enough to spot flapping. */
const STATE_LOG_MAX = 6;

/** Per the SUAD spec: a MISSING run of this length followed by recovery
 *  qualifies as INTERMITTENT. "Misses 3 metars but on the 4th it comes
 *  back" → run length 3, then OK. */
const INTERMITTENT_MISSING_RUN = 3;

/** Reduce the rich classifier output to the coarse log alphabet. */
function toLogState(status: ScanRow["status"]): StateLogEntry["state"] {
  if (status === "FLAGGED") return "FLAGGED";
  if (status === "MISSING" || status === "OFFLINE" || status === "NO DATA") return "MISSING";
  // CLEAN, RECOVERED, INTERMITTENT all collapse to OK from the log's
  // perspective — they all indicate the station was "reporting and
  // healthy at this hour" or "reporting again." We deliberately do
  // not log INTERMITTENT as its own state to avoid feedback loops
  // where the refiner sustains its own label across hours.
  return "OK";
}

/** Find the longest consecutive run of MISSING entries in the log. We
 *  intentionally count *only* MISSING (not FLAGGED) because the SUAD
 *  spec explicitly excludes FLAGGED-then-recovered from INTERMITTENT.
 *  A station whose sensor flagged for 4 hours then cleared is "fine,"
 *  not "intermittent." Connectivity gaps (MISSING runs) are different. */
function longestMissingRun(log: StateLogEntry[]): number {
  let cur = 0, best = 0;
  for (const e of log) {
    if (e.state === "MISSING") {
      cur += 1; best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
}

/** Look for the specific INTERMITTENT signature: a MISSING run of length
 *  ≥ INTERMITTENT_MISSING_RUN at any point in the log, followed by at
 *  least one OK entry. Returns the run length when found, or 0. */
function detectIntermittentPattern(log: StateLogEntry[]): number {
  let i = 0;
  while (i < log.length) {
    if (log[i].state !== "MISSING") { i++; continue; }
    let runLen = 0;
    while (i + runLen < log.length && log[i + runLen].state === "MISSING") runLen++;
    if (runLen >= INTERMITTENT_MISSING_RUN) {
      // Did the run end with at least one OK entry following it?
      const after = log[i + runLen];
      if (after && after.state === "OK") return runLen;
    }
    i += Math.max(runLen, 1);
  }
  return 0;
}

/** Append a new state entry, sliding the log to STATE_LOG_MAX max length.
 *  Two entries in the same hour are deduped — only the latest survives. */
export function appendStateLog(
  prev: StateLogEntry[] | undefined,
  current: ScanRow["status"],
  now: Date,
): StateLogEntry[] {
  const log = Array.isArray(prev) ? [...prev] : [];
  const hourKey = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(),
  )).toISOString();
  // Replace any entry from the same hour to avoid double-logging on
  // multiple scans within one hour (the cache cycle is shorter than
  // an hour so this matters).
  const idx = log.findIndex((e) => e.at === hourKey);
  const entry: StateLogEntry = { at: hourKey, state: toLogState(current) };
  if (idx >= 0) log[idx] = entry;
  else log.push(entry);
  while (log.length > STATE_LOG_MAX) log.shift();
  return log;
}

/** Refine the single-window classifier output using the persistent log.
 *  Returns the row with possibly-updated status, probable_reason, and
 *  state_log. */
export function refineWithHistory(
  row: ScanRow,
  prevLog: StateLogEntry[] | undefined,
  now: Date,
): ScanRow {
  const updatedLog = appendStateLog(prevLog, row.status, now);
  const allOk = updatedLog.every((e) => e.state === "OK");
  const intermittentRun = detectIntermittentPattern(updatedLog);
  const longestMissing = longestMissingRun(updatedLog);

  let status = row.status;
  let probable = row.probable_reason;

  // Rule 1: Continuously OK in the log + first-pass classifier said
  // INTERMITTENT (because of bucket-edge noise) → override to CLEAN.
  // A station that has been continuously reporting cleanly cannot be
  // "intermittent" by the SUAD definition.
  if (allOk && row.status === "INTERMITTENT") {
    status = "CLEAN";
    probable = "history shows sustained healthy reporting; bucket noise overridden";
  }

  // Rule 2: First-pass said CLEAN, but log shows the SUAD signature —
  // a MISSING run of ≥3 consecutive entries that has now recovered.
  // This is the canonical INTERMITTENT case: "missed 3 metars, came
  // back at hour 4." Critically, FLAGGED → OK does not trigger this;
  // only MISSING → OK does.
  if (row.status === "CLEAN" && intermittentRun >= INTERMITTENT_MISSING_RUN) {
    status = "INTERMITTENT";
    probable = `comm gap pattern: ${intermittentRun} consecutive MISSING hours, then recovered`;
  }

  // Rule 3: First-pass said FLAGGED — keep it. SUAD spec is explicit
  // that FLAGGED stations don't escalate to INTERMITTENT regardless
  // of history. The $ flag is a sensor maintenance indicator; the
  // station's data path is fine, the sensor just needs attention.
  // We DO enrich the reason if the flag has persisted for hours.
  if (row.status === "FLAGGED") {
    // Count consecutive FLAGGED entries at end of log.
    let flagRun = 0;
    for (let i = updatedLog.length - 1; i >= 0; i--) {
      if (updatedLog[i].state === "FLAGGED") flagRun++;
      else break;
    }
    if (flagRun >= 3) {
      probable = `${probable ?? "$-flag set"} (persisted ${flagRun}+ hours)`;
    }
  }

  // Rule 4: First-pass said MISSING and log confirms a long silent run
  // — enrich the reason with the run length so operators see "missed 4
  // hourly METARs, last reported 4h 20m ago" in the popup.
  if (row.status === "MISSING" && longestMissing >= 2) {
    probable = `${probable ?? "MISSING"} (run of ${longestMissing} consecutive missed METARs)`;
  }

  return {
    ...row,
    status,
    probable_reason: probable,
    state_log: updatedLog,
  };
}
