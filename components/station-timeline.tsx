"use client";

/** Per-station diagnostic timeline.
 *
 *  Surfaces the data-quality signals operators need to triage a single
 *  station: when did it last report, how many hourly buckets did we
 *  cover, has it been flagged consistently, did NCEI agree with IEM,
 *  and what does the rolling state log show.
 *
 *  Renders three blocks:
 *
 *  1. HEADLINE STRIP — "Last seen 2 h 15 m ago at 03:51Z" + status pill.
 *  2. EVIDENCE QUALITY — buckets_seen / buckets_expected / reports / flags.
 *  3. STATE LOG — horizontal 6-hour rolling-state timeline showing
 *     OK / MISSING / FLAGGED tiles. This is the visual proof of the
 *     INTERMITTENT classifier's pattern-detection logic.
 *  4. CROSS-CHECK — NCEI second-opinion result, when present.
 *
 *  The component is intentionally pure render (no fetches) so it
 *  composes cleanly inside DrillPanel and can be reused on the Admin
 *  tab's INTERMITTENT section.
 */

import { useMemo } from "react";

interface Props {
  status?: string;
  minutesSinceLast?: number | null;
  lastValid?: string | null;
  probableReason?: string | null;
  evidenceQuality?: {
    buckets_seen: number;
    buckets_expected: number;
    fraction: number;
    flagged_in_window: number;
    reports_seen: number;
    consecutive_silent_buckets?: number;
  } | null;
  stateLog?: Array<{ at: string; state: "OK" | "FLAGGED" | "MISSING" }> | null;
  crossCheck?: {
    source: "ncei" | "awc" | "nws";
    agrees_with_iem: boolean;
    checked_at: string;
    buckets_seen: number;
    suggested_status?: string;
    skipped?: string;
  } | null;
}

const STATE_COLORS: Record<"OK" | "FLAGGED" | "MISSING", string> = {
  OK: "#3fb27f",
  FLAGGED: "#e0a73a",
  MISSING: "#e25c6b",
};

const STATE_LABELS: Record<"OK" | "FLAGGED" | "MISSING", string> = {
  OK: "Reporting",
  FLAGGED: "$ flag set",
  MISSING: "Silent",
};

const STATUS_COLORS: Record<string, string> = {
  CLEAN: "#3fb27f",
  RECOVERED: "#5fa8e6",
  INTERMITTENT: "#c48828",
  FLAGGED: "#e0a73a",
  MISSING: "#e25c6b",
  OFFLINE: "#475569",
  "NO DATA": "#5f6f8f",
};

function formatRelative(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 1440) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h} h ago` : `${h} h ${m} m ago`;
  }
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return h === 0 ? `${d} d ago` : `${d} d ${h} h ago`;
}

function formatHourLabel(iso: string): string {
  // ISO from state_log entries is bucket-anchored (HH:00:00). Render
  // as "HHZ" — what operators actually scan timelines by.
  const m = iso.match(/T(\d{2}):/);
  return m ? `${m[1]}Z` : iso.slice(-9, -4);
}

export function StationTimeline({
  status,
  minutesSinceLast,
  lastValid,
  probableReason,
  evidenceQuality,
  stateLog,
  crossCheck,
}: Props) {
  // Sort log entries oldest → newest so the timeline reads left-to-right
  // chronologically, matching how operators read METAR sequence reports.
  const sortedLog = useMemo(() => {
    if (!stateLog || stateLog.length === 0) return [];
    return [...stateLog].sort((a, b) => a.at.localeCompare(b.at));
  }, [stateLog]);

  const statusColor = status ? STATUS_COLORS[status] ?? "#94a3b8" : "#94a3b8";

  return (
    <div className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono uppercase tracking-wider text-[0.66rem] text-[color:var(--color-fg-muted)]">
          Diagnostic Timeline
        </div>
        {status && (
          <span
            className="rounded px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wider"
            style={{ background: statusColor + "22", color: statusColor }}
          >
            {status}
          </span>
        )}
      </div>

      {/* Headline: when last seen */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <div className="text-[0.62rem] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
            Last METAR
          </div>
          <div className="mt-0.5 font-mono text-[0.74rem] text-[color:var(--color-fg)]">
            {lastValid ? `${lastValid}Z` : "—"}
          </div>
          <div className="text-[0.62rem] text-[color:var(--color-fg-muted)]">
            {formatRelative(minutesSinceLast)}
          </div>
        </div>
        <div>
          <div className="text-[0.62rem] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
            Probable Reason
          </div>
          <div className="mt-0.5 text-[0.7rem] text-[color:var(--color-fg)]">
            {probableReason ?? "—"}
          </div>
        </div>
      </div>

      {/* Evidence quality readout */}
      {evidenceQuality && (
        <div className="mt-3 border-t border-[color:var(--color-border)] pt-2">
          <div className="text-[0.62rem] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
            Evidence Quality
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[0.7rem]">
            <Chip
              label="buckets"
              value={`${evidenceQuality.buckets_seen}/${evidenceQuality.buckets_expected}`}
              tone={
                evidenceQuality.fraction >= 0.9
                  ? "good"
                  : evidenceQuality.fraction >= 0.5
                  ? "warn"
                  : "bad"
              }
            />
            <Chip
              label="reports"
              value={String(evidenceQuality.reports_seen)}
              tone="neutral"
            />
            {evidenceQuality.flagged_in_window > 0 && (
              <Chip
                label="$ in window"
                value={String(evidenceQuality.flagged_in_window)}
                tone="warn"
              />
            )}
            {evidenceQuality.consecutive_silent_buckets != null &&
              evidenceQuality.consecutive_silent_buckets > 0 && (
                <Chip
                  label="silent run"
                  value={`${evidenceQuality.consecutive_silent_buckets}h`}
                  tone="bad"
                />
              )}
          </div>
        </div>
      )}

      {/* State log timeline — left-to-right, oldest first */}
      {sortedLog.length > 0 && (
        <div className="mt-3 border-t border-[color:var(--color-border)] pt-2">
          <div className="flex items-baseline justify-between">
            <div className="text-[0.62rem] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              State Log (last {sortedLog.length}h)
            </div>
            <div className="text-[0.58rem] text-[color:var(--color-fg-muted)]">
              oldest → newest
            </div>
          </div>
          <div className="mt-2 flex gap-1">
            {sortedLog.map((entry, i) => (
              <div
                key={i}
                className="flex-1 rounded text-center"
                style={{
                  background: STATE_COLORS[entry.state] + "22",
                  border: `1px solid ${STATE_COLORS[entry.state]}66`,
                  padding: "4px 2px",
                  minWidth: "32px",
                }}
                title={`${formatHourLabel(entry.at)} — ${STATE_LABELS[entry.state]}`}
              >
                <div
                  className="font-mono text-[0.6rem] font-bold uppercase tracking-wider"
                  style={{ color: STATE_COLORS[entry.state] }}
                >
                  {entry.state === "OK"
                    ? "OK"
                    : entry.state === "FLAGGED"
                    ? "$"
                    : "MISS"}
                </div>
                <div className="mt-0.5 font-mono text-[0.55rem] text-[color:var(--color-fg-muted)]">
                  {formatHourLabel(entry.at)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-3 text-[0.55rem] text-[color:var(--color-fg-muted)]">
            <span>
              <span style={{ color: STATE_COLORS.OK }}>■</span> Reporting
            </span>
            <span>
              <span style={{ color: STATE_COLORS.FLAGGED }}>■</span> $ flag
            </span>
            <span>
              <span style={{ color: STATE_COLORS.MISSING }}>■</span> Silent
            </span>
          </div>
        </div>
      )}

      {/* NCEI cross-check result */}
      {crossCheck && (
        <div className="mt-3 border-t border-[color:var(--color-border)] pt-2">
          <div className="text-[0.62rem] uppercase tracking-wider text-[color:var(--color-fg-muted)]">
            Second-Source Cross-Check
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.7rem]">
            <span className="font-mono uppercase tracking-wider text-[color:var(--color-fg-muted)]">
              {crossCheck.source.toUpperCase()}
            </span>
            {crossCheck.skipped ? (
              <span className="rounded bg-slate-700/30 px-2 py-0.5 text-[0.62rem] text-slate-400">
                skipped: {crossCheck.skipped}
              </span>
            ) : crossCheck.agrees_with_iem ? (
              <span className="rounded bg-emerald-700/30 px-2 py-0.5 text-[0.62rem] text-emerald-300">
                ✓ confirms IEM
              </span>
            ) : (
              <span className="rounded bg-amber-700/30 px-2 py-0.5 text-[0.62rem] text-amber-300">
                ⚠ disagrees — suggests {crossCheck.suggested_status}
              </span>
            )}
            <span className="text-[0.6rem] text-[color:var(--color-fg-muted)]">
              {crossCheck.buckets_seen} buckets at NCEI
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const colors = {
    good: { bg: "#3fb27f22", fg: "#3fb27f" },
    warn: { bg: "#e0a73a22", fg: "#e0a73a" },
    bad: { bg: "#e25c6b22", fg: "#e25c6b" },
    neutral: { bg: "#94a3b822", fg: "#94a3b8" },
  };
  const c = colors[tone];
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[0.62rem]"
      style={{ background: c.bg, color: c.fg }}
    >
      <span className="opacity-60">{label}:</span> <strong>{value}</strong>
    </span>
  );
}
