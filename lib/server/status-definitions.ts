/** Single source of truth for ASOS station status definitions.
 *
 *  Used by the API (/api/status-definitions), the Admin tab (status
 *  panels), and the drill panel (badge tooltips). Operators see the
 *  same wording everywhere — no drift between docs and UI. Each
 *  definition is short enough for a tooltip but precise enough that
 *  a new analyst can join the team and immediately understand what
 *  any given color on the map means.
 *
 *  Vocabulary alignment: matches the SUAD/ASOS team's operational
 *  conventions. Notably, INTERMITTENT is reserved for the specific
 *  signature "≥3 consecutive missed METARs followed by recovery" —
 *  not for stations that flagged-then-cleared.
 */

import type { StationStatus } from "./types";

export interface StatusDefinition {
  status: StationStatus;
  /** Single-line label suitable for legend chips. */
  short: string;
  /** Operator-friendly definition, ≤ 240 chars. */
  definition: string;
  /** Hex color used in UI badges + map dots. */
  color: string;
  /** Triage hint — what an operator should DO when they see this. */
  triage: string;
  /** Underlying classifier rule, formatted as a one-line technical
   *  description for the docs panel. */
  rule: string;
}

export const STATUS_DEFINITIONS: Record<StationStatus, StatusDefinition> = {
  CLEAN: {
    status: "CLEAN",
    short: "Reporting normally",
    definition:
      "Station is reporting METARs on schedule with no maintenance flag. " +
      "All sensors operational, data path healthy. Nothing to do.",
    color: "#3fb27f",
    triage:
      "No action required. Continue routine monitoring.",
    rule:
      "Latest METAR has no $ flag, ≤ 1 hourly bucket missing in scan window, " +
      "log shows sustained healthy reporting.",
  },
  FLAGGED: {
    status: "FLAGGED",
    short: "Maintenance flag set",
    definition:
      "Latest METAR carries the '$' maintenance indicator — the station's " +
      "internal self-check detected a sensor anomaly (often PWINO precip " +
      "ID, FZRANO freezing-rain sensor, RVRNO RVR sensor, or generic " +
      "calibration drift). Data is still being reported and may still be " +
      "usable; the flag means a maintainer should look.",
    color: "#e0a73a",
    triage:
      "Review decoded reasons in drill panel. Open ticket for the affected " +
      "sensor with priority based on the specific NO-code.",
    rule:
      "Latest METAR ends with '$' (after stripping trailing '='). Decoded " +
      "NO-codes surfaced in probable_reason.",
  },
  MISSING: {
    status: "MISSING",
    short: "Silent ≥ 1 hour",
    definition:
      "Station has missed at least one scheduled hourly METAR. May be " +
      "comm-side (modem, network, IEM upstream) or station-side (power, " +
      "controller). Requires immediate ops attention because every " +
      "additional hour without a report makes the gap harder to recover.",
    color: "#e25c6b",
    triage:
      "Check drill panel for last-seen timestamp. If silent < 2 h, watch " +
      "for the next scheduled METAR. If ≥ 2 h, escalate to the field tech " +
      "team for the station's region.",
    rule:
      "Latest METAR is older than 60 minutes from now, OR no METARs " +
      "in the entire scan window.",
  },
  OFFLINE: {
    status: "OFFLINE",
    short: "Decommissioned / archived",
    definition:
      "Station has been silent for ≥ 14 days OR the IEM catalog records " +
      "an archive_end date in the past. Treated as decommissioned by " +
      "default — won't generate alerts unless reactivated.",
    color: "#475569",
    triage:
      "Confirm decommissioning with maintenance records. If station was " +
      "supposed to be active, file a recovery ticket; otherwise mark in " +
      "the catalog so it stops appearing in operational counters.",
    rule:
      "archive_end > 14 days in the past, OR catalog flag explicitly set.",
  },
  INTERMITTENT: {
    status: "INTERMITTENT",
    short: "Comm-gap recovery pattern",
    definition:
      "Station's connectivity has been flapping: it missed 3 or more " +
      "consecutive scheduled METARs, then came back. Even if it's " +
      "currently reporting cleanly, the recent gap pattern means it " +
      "may go silent again. Symptom of marginal modem, congested " +
      "satellite link, or a controller that's rebooting itself.",
    color: "#c48828",
    triage:
      "Check state_log timeline for gap timing. If it correlates with " +
      "regional weather (icing on the antenna, lightning), defer; if not, " +
      "open a comm ticket for the site's path.",
    rule:
      "Persistent state log shows a run of ≥ 3 MISSING entries followed " +
      "by ≥ 1 OK entry. FLAGGED-then-recovered does NOT trigger this — " +
      "only MISSING runs do.",
  },
  RECOVERED: {
    status: "RECOVERED",
    short: "Just cleared",
    definition:
      "Station was FLAGGED in a recent scan but the most recent METAR " +
      "is clean. Sensor self-check has cleared. May or may not stay " +
      "clean — depends on whether the underlying issue was transient " +
      "(weather event) or persistent (calibration drift).",
    color: "#5fa8e6",
    triage:
      "Note the recovery in the audit log. If station re-flags within " +
      "24 h, treat as a chronic FLAGGED and prioritize maintenance.",
    rule:
      "Last METAR has no $ flag; an earlier METAR in the log did. Two " +
      "consecutive clean reports observed.",
  },
  "NO DATA": {
    status: "NO DATA",
    short: "Pre-first-scan",
    definition:
      "Placeholder used only before the first scan completes after a " +
      "process restart. Will resolve to one of the other statuses on " +
      "the first successful scan.",
    color: "#5f6f8f",
    triage:
      "No action — wait for the next scan cycle (≤ 5 min).",
    rule:
      "Station appears in the catalog but no scan output has classified " +
      "it yet. Should never persist beyond one scan cycle.",
  },
};

/** Array form for iteration in the UI (preserves the canonical order). */
export const STATUS_LIST: StatusDefinition[] = [
  STATUS_DEFINITIONS.CLEAN,
  STATUS_DEFINITIONS.FLAGGED,
  STATUS_DEFINITIONS.MISSING,
  STATUS_DEFINITIONS.INTERMITTENT,
  STATUS_DEFINITIONS.RECOVERED,
  STATUS_DEFINITIONS.OFFLINE,
  STATUS_DEFINITIONS["NO DATA"],
];
