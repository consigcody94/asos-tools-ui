/** History-aware INTERMITTENT classifier refinement.
 *
 *  Per the user's operational definition (verified against SUAD/ASOS
 *  team conventions), INTERMITTENT describes a *station behaviour
 *  pattern over time*, not a single-window bucket-density observation.
 *  Two patterns trigger it:
 *
 *    1. Flapping  — bad → good → bad → good in the rolling window
 *                   (e.g., FLAGGED for 1 hr → CLEAN for 1 hr →
 *                   FLAGGED for 1 hr → CLEAN for 1 hr).
 *    2. Recovery  — sustained badness (≥3 hours of MISSING/FLAGGED)
 *                   followed by current CLEAN. The label captures
 *                   "we're not sure this station is healthy yet —
 *                   it just came back."
 *
 *  The single-window classifier in iem.ts produces a first-pass
 *  status from the current scan's METARs alone. This module then
 *  refines that status using the persistent state_log carried by
 *  scan-cache._lastKnown across scans.
 *
 *  Critical edge cases:
 *    - A station continuously CLEAN should never be INTERMITTENT,
 *      regardless of bucket math noise.
 *    - A station that's been CLEAN for the entire 6h log + current
 *      scan classifies it CLEAN with maybe 1 missing bucket → CLEAN.
 *    - A station that was CLEAN for 4h, FLAGGED for 1h, then CLEAN
 *      again should be RECOVERED, not INTERMITTENT (only 2 transitions).
 *    - A station that was CLEAN/FLAGGED/CLEAN/FLAGGED/CLEAN/FLAGGED
 *      across 6h is INTERMITTENT (5 transitions = clear flapping).
 */

import type { ScanRow, StateLogEntry } from "./types";

/** Maximum entries the state log carries. Six hourly buckets covers a
 *  full operator-shift window and is enough to spot flapping. */
const STATE_LOG_MAX = 6;

/** Threshold of consecutive bad hours before "recovery" applies. The
 *  user's spec was "flagged for more than 3 hours and comes back the
 *  4th hour." */
const RECOVERY_BAD_RUN = 3;

/** Threshold of state transitions for flapping. CLEAN→FLAGGED→CLEAN
 *  is 2 transitions; CLEAN→FLAGGED→CLEAN→FLAGGED is 3. We require ≥3
 *  to call it INTERMITTENT — a single bad-good-bad cycle is RECOVERED,
 *  but oscillation is INTERMITTENT. */
const FLAPPING_TRANSITIONS = 3;

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

/** Count state transitions in the log. A transition is any consecutive
 *  pair where state[i] !== state[i+1]. Higher count = more flapping. */
function countTransitions(log: StateLogEntry[]): number {
  let n = 0;
  for (let i = 0; i + 1 < log.length; i++) {
    if (log[i].state !== log[i + 1].state) n++;
  }
  return n;
}

/** Longest contiguous run of bad states (FLAGGED|MISSING) in the log. */
function longestBadRun(log: StateLogEntry[]): number {
  let cur = 0, best = 0;
  for (const e of log) {
    if (e.state === "FLAGGED" || e.state === "MISSING") {
      cur += 1; best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
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
  const transitions = countTransitions(updatedLog);
  const badRun = longestBadRun(updatedLog);
  const allOk = updatedLog.every((e) => e.state === "OK");

  let status = row.status;
  let probable = row.probable_reason;

  // Rule 1: Continuously OK in the log → CLEAN, period. Bucket noise
  // can't override sustained healthy history.
  if (allOk && row.status === "INTERMITTENT") {
    status = "CLEAN";
    probable = "log shows sustained healthy reporting; ignoring single-window jitter";
  }

  // Rule 2: Currently CLEAN/RECOVERED but log shows recent flapping
  // (≥3 transitions) → INTERMITTENT.
  if ((row.status === "CLEAN" || row.status === "RECOVERED") &&
      transitions >= FLAPPING_TRANSITIONS) {
    status = "INTERMITTENT";
    probable = `flapping: ${transitions} state transitions in last ${updatedLog.length}h`;
  }

  // Rule 3: Currently CLEAN but log shows a sustained bad run → RECOVERED.
  // (Don't override Rule 2 — flapping wins over single recovery.)
  if (status === "CLEAN" && badRun >= RECOVERY_BAD_RUN) {
    status = "RECOVERED";
    probable = `recovered after ${badRun}h of sustained badness`;
  }

  // Rule 4: Currently FLAGGED/MISSING but log shows it's been bad
  // ≥3 hours running → keep status, but enrich the reason so operators
  // see the persistence in the popup.
  if ((row.status === "FLAGGED" || row.status === "MISSING") && badRun >= RECOVERY_BAD_RUN) {
    probable = `${probable ?? row.status.toLowerCase()} — sustained ${badRun}h+ run`;
  }

  return {
    ...row,
    status,
    probable_reason: probable,
    state_log: updatedLog,
  };
}
