"use client";

/** AOMC dashboard — per-operator rollup + flagged/missing drill table.
 *
 *  Server fetches scan rows (revalidate 30s).  Client owns the operator
 *  filter + ICAO drill on the table below.
 */

import { useMemo, useState } from "react";
import { type Station } from "@/lib/data/stations";
import { displayOperator, operatorBucket } from "@/lib/data/operator-display";

interface OpRow {
  operator: string;
  total: number;
  clean: number;
  flagged: number;
  missing: number;
  intermittent: number;
  recovered: number;
  noData: number;
}

interface ScanRow {
  station: string;
  status?: string;
  minutes_since_last_report?: number | null;
  probable_reason?: string | null;
  latest_metar?: string | null;
}

interface Props {
  rollup: OpRow[];
  rows: ScanRow[];
  stations: Station[];
}

const STATUS_TONE: Record<string, string> = {
  CLEAN: "var(--color-noc-ok)",
  FLAGGED: "var(--color-noc-warn)",
  MISSING: "var(--color-noc-crit)",
  INTERMITTENT: "var(--color-noc-amber)",
  RECOVERED: "var(--color-noc-cyan)",
  "NO DATA": "var(--color-noc-dim)",
};

export function AomcDashboard({ rollup, rows, stations }: Props) {
  const [filterOp, setFilterOp] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ATTENTION");

  // Index station metadata by ICAO for table joins.
  const stationByIcao = useMemo(() => {
    const m = new Map<string, Station>();
    for (const s of stations) m.set(s.id, s);
    return m;
  }, [stations]);

  // Apply filters to scan rows.
  const filtered = useMemo(() => {
    const wanted: Set<string> = filterStatus === "ALL"
      ? new Set()
      : filterStatus === "ATTENTION"
        ? new Set(["MISSING", "FLAGGED", "INTERMITTENT"])
        : new Set([filterStatus]);
    return rows
      .filter((r) => {
        const meta = r.station ? stationByIcao.get(r.station) : undefined;
        if (filterOp !== "ALL") {
          // filterOp is set from the aggregated rows' display name
          // ("NOAA/SUAD" / "FAA" / "DOD"), but meta.operator is the
          // raw catalog value ("—" / "FAA" / "DOD"). Compare buckets
          // so the em-dash rows match the "NOAA/SUAD" filter.
          if (!meta || operatorBucket(meta.operator) !== filterOp) return false;
        }
        const st = (r.status || "NO DATA").toUpperCase();
        if (filterStatus !== "ALL" && !wanted.has(st)) return false;
        return true;
      })
      .sort((a, b) => {
        // Sort: most recent first within FLAGGED/MISSING; CLEAN at bottom
        const sa = (a.status || "").toUpperCase();
        const sb = (b.status || "").toUpperCase();
        const order = ["MISSING", "FLAGGED", "INTERMITTENT", "RECOVERED", "CLEAN", "NO DATA"];
        const oa = order.indexOf(sa);
        const ob = order.indexOf(sb);
        if (oa !== ob) return oa - ob;
        const ma = a.minutes_since_last_report ?? 1e9;
        const mb = b.minutes_since_last_report ?? 1e9;
        return ma - mb;
      });
  }, [rows, filterOp, filterStatus, stationByIcao]);

  return (
    <>
      {/* Per-operator rollup grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {rollup.map((r) => (
          <button
            key={r.operator}
            onClick={() => setFilterOp(filterOp === r.operator ? "ALL" : r.operator)}
            className={`
              noc-panel text-left transition-all
              ${filterOp === r.operator ? "ring-2 ring-noc-cyan shadow-[0_0_24px_rgba(0,229,255,0.25)]" : "hover:ring-1 hover:ring-noc-cyan-dim"}
            `}
          >
            <div className="flex items-baseline justify-between mb-3">
              <div className="font-display text-xl font-bold text-noc-cyan tracking-wide">
                {r.operator}
              </div>
              <div className="font-mono text-2xl text-noc-text tabular-nums">
                {r.total}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
              <div>
                <div className="text-noc-ok">{r.clean}</div>
                <div className="text-[0.6rem] text-noc-muted uppercase tracking-wider">Clean</div>
              </div>
              <div>
                <div className="text-noc-warn">{r.flagged}</div>
                <div className="text-[0.6rem] text-noc-muted uppercase tracking-wider">Flagged</div>
              </div>
              <div>
                <div className="text-noc-crit">{r.missing}</div>
                <div className="text-[0.6rem] text-noc-muted uppercase tracking-wider">Missing</div>
              </div>
            </div>
          </button>
        ))}
      </section>

      {/* Filter chips */}
      <div className="noc-panel mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="noc-label">Status filter:</span>
          {["ATTENTION", "MISSING", "FLAGGED", "INTERMITTENT", "CLEAN", "RECOVERED", "ALL"].map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`
                noc-btn text-[0.7rem] py-1 px-3
                ${filterStatus === st ? "noc-btn-primary" : ""}
              `}
            >
              {st}
            </button>
          ))}
          {filterOp !== "ALL" && (
            <span className="noc-label ml-auto">
              filtered to {filterOp}
              <button
                onClick={() => setFilterOp("ALL")}
                className="ml-2 text-noc-cyan hover:text-noc-text"
              >
                ✕ clear
              </button>
            </span>
          )}
          <span className="noc-label ml-auto font-mono">
            {filtered.length} stations
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="noc-panel">
        <div className="overflow-auto max-h-[68vh] border border-noc-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-noc-elevated z-10">
              <tr>
                <Th>ICAO</Th>
                <Th>Station</Th>
                <Th>State</Th>
                <Th>Operator</Th>
                <Th>Status</Th>
                <Th right>Last seen</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {filtered.map((r, idx) => {
                const meta = r.station ? stationByIcao.get(r.station) : undefined;
                const st = (r.status || "NO DATA").toUpperCase();
                const tone = STATUS_TONE[st] || "var(--color-noc-dim)";
                const mins = r.minutes_since_last_report;
                const minsLabel = mins == null ? "—" : `${Math.round(mins)} min ago`;
                return (
                  <tr
                    key={r.station || idx}
                    className={`
                      ${idx % 2 === 0 ? "bg-noc-deep" : "bg-noc-panel"}
                      hover:bg-[rgba(0,229,255,0.05)]
                      border-t border-noc-border
                    `}
                  >
                    <td className="px-3 py-1.5 text-noc-cyan font-bold">{r.station}</td>
                    <td className="px-3 py-1.5 text-noc-text font-body">
                      {meta?.name || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-noc-muted">{meta?.state || ""}</td>
                    <td className="px-3 py-1.5 text-noc-muted font-body uppercase tracking-wider text-[0.7rem]">
                      {displayOperator(meta?.operator)}
                    </td>
                    <td className="px-3 py-1.5 font-display font-bold uppercase tracking-wider text-[0.7rem]" style={{ color: tone }}>
                      {st}
                    </td>
                    <td className="px-3 py-1.5 text-right text-noc-dim tabular-nums">
                      {minsLabel}
                    </td>
                    <td className="px-3 py-1.5 text-noc-muted text-xs font-body">
                      {r.probable_reason || ""}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-noc-muted">
                    No stations match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`
        px-3 py-2 text-[0.7rem] font-display font-bold uppercase tracking-[0.16em]
        text-noc-muted border-b border-noc-border-strong
        ${right ? "text-right" : "text-left"}
      `}
    >
      {children}
    </th>
  );
}
