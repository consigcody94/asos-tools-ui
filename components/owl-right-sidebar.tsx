"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Activity, RadioTower } from "lucide-react";
import { reduceCounts, REDUCED_COLOR, REDUCED_LABEL, type ReducedStatus } from "@/lib/status";
import { usePersistedState } from "@/lib/use-persisted-state";

interface SiteRow {
  station: string;
  name?: string;
  state?: string;
  status?: string;
  program?: string;
  /** ISO string of when the site went down. */
  since?: string | null;
}

interface Props {
  rows: SiteRow[];
  /** When true, expand all program groups in the Down-Sites table. */
  autoExpand: boolean;
  setAutoExpand: (v: boolean) => void;
  /** Click a row to recenter the map / open the drill panel. */
  onSelect?: (station: string) => void;
}

export function OwlRightSidebar({ rows, autoExpand, setAutoExpand, onSelect }: Props) {
  const counts = useMemo(() => reduceCounts(rows), [rows]);
  const total = rows.length;

  const downRows = useMemo(
    () => rows.filter((r) => {
      const s = (r.status || "").toUpperCase();
      return s === "MISSING" || s === "OFFLINE";
    }),
    [rows],
  );
  const degradedRows = useMemo(
    () => rows.filter((r) => {
      const s = (r.status || "").toUpperCase();
      return s === "FLAGGED" || s === "INTERMITTENT";
    }),
    [rows],
  );

  return (
    <aside className="flex flex-col gap-3 text-sm">
      <Card title="Legend" icon={<Activity size={12} />}>
        <Legend />
      </Card>

      <Card title="Programs" icon={<RadioTower size={12} />}>
        <ul className="space-y-1 text-[0.78rem]">
          <ProgramRow label="ASOS" enabled count={total} />
          <ProgramRow label="AWIPS" enabled={false} hint="connector pending" />
          <ProgramRow label="Buoys (NDBC)" enabled={false} hint="phase 2" />
          <ProgramRow label="Facility (NCO WAN)" enabled={false} hint="phase 2" />
          <ProgramRow label="NWR" enabled={false} hint="phase 2" />
          <ProgramRow label="RADAR (NEXRAD)" enabled={false} hint="phase 2" />
          <ProgramRow label="Upper Air" enabled={false} hint="phase 2" />
        </ul>
      </Card>

      <Card title="Type Breakdown" icon={<AlertTriangle size={12} />}>
        <CountRow label={REDUCED_LABEL.UP}        v={counts.UP}       color={REDUCED_COLOR.UP} />
        <CountRow label={REDUCED_LABEL.DEGRADED}  v={counts.DEGRADED} color={REDUCED_COLOR.DEGRADED} />
        <CountRow label={REDUCED_LABEL.DOWN}      v={counts.DOWN}     color={REDUCED_COLOR.DOWN} />
        {counts.PATCHING > 0 && <CountRow label={REDUCED_LABEL.PATCHING} v={counts.PATCHING} color={REDUCED_COLOR.PATCHING} />}
        {counts.UNKNOWN  > 0 && <CountRow label={REDUCED_LABEL.UNKNOWN}  v={counts.UNKNOWN}  color={REDUCED_COLOR.UNKNOWN}  />}
        <div className="mt-2 flex justify-between border-t border-[color:var(--color-border)] pt-1.5 text-[0.7rem] text-[color:var(--color-fg-muted)]">
          <span>Total tracked</span><span className="font-mono text-[color:var(--color-fg)]">{total}</span>
        </div>
      </Card>

      <Card title={`Down Sites (${downRows.length})`} icon={<AlertTriangle size={12} className="text-[color:var(--color-crit)]" />}>
        <div className="mb-2 flex items-center gap-2 text-[0.66rem] text-[color:var(--color-fg-muted)]">
          <input
            type="checkbox"
            checked={autoExpand}
            onChange={(e) => setAutoExpand(e.target.checked)}
            id="auto-expand"
          />
          <label htmlFor="auto-expand" className="cursor-pointer">Auto Expand (sync with rotation)</label>
        </div>
        <ProgramGroup label="ASOS" rows={downRows} forceOpen={autoExpand} onSelect={onSelect} emptyText="No down ASOS sites." />
      </Card>

      {degradedRows.length > 0 && (
        <Card title={`Degraded Sites (${degradedRows.length})`} icon={<AlertTriangle size={12} className="text-[color:var(--color-warn)]" />}>
          <ProgramGroup label="ASOS" rows={degradedRows.slice(0, 50)} forceOpen={autoExpand} onSelect={onSelect} emptyText="None." />
          {degradedRows.length > 50 && (
            <p className="mt-1 text-[0.66rem] text-[color:var(--color-fg-muted)]">
              Showing first 50 of {degradedRows.length}. Use search or filter to narrow.
            </p>
          )}
        </Card>
      )}
    </aside>
  );
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)]">
      <header className="flex items-center gap-1.5 border-b border-[color:var(--color-border)] px-2.5 py-1.5 text-[0.62rem] uppercase tracking-[0.16em] text-[color:var(--color-fg-muted)]">
        {icon}
        <span>{title}</span>
      </header>
      <div className="px-2.5 py-2">{children}</div>
    </section>
  );
}

function Legend() {
  const items: ReducedStatus[] = ["UP", "DEGRADED", "DOWN", "PATCHING", "UNKNOWN"];
  return (
    <ul className="space-y-1 text-[0.78rem]">
      {items.map((s) => (
        <li key={s} className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: REDUCED_COLOR[s] }} />
          <span className="text-[color:var(--color-fg)]">{REDUCED_LABEL[s]}</span>
        </li>
      ))}
    </ul>
  );
}

function CountRow({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[0.78rem]">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[color:var(--color-fg)]">{label}</span>
      </div>
      <span className="font-mono text-[color:var(--color-fg)]">{v}</span>
    </div>
  );
}

function ProgramRow({ label, enabled, count, hint }: { label: string; enabled: boolean; count?: number; hint?: string }) {
  return (
    <li className="flex items-center justify-between text-[0.74rem]">
      <span className={enabled ? "text-[color:var(--color-fg)]" : "text-[color:var(--color-fg-muted)] line-through opacity-70"}>{label}</span>
      <span className="font-mono text-[0.7rem] text-[color:var(--color-fg-muted)]">
        {enabled ? (count ?? "") : (hint ?? "off")}
      </span>
    </li>
  );
}

function ProgramGroup({
  label, rows, forceOpen, onSelect, emptyText,
}: {
  label: string; rows: SiteRow[]; forceOpen: boolean; onSelect?: (s: string) => void; emptyText: string;
}) {
  const [open, setOpen] = usePersistedState<boolean>(`owl-pg-${label}`, true);
  const expanded = forceOpen || open;
  return (
    <div className="border-t border-[color:var(--color-border)] first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-1.5 text-left text-[0.74rem] text-[color:var(--color-fg)] hover:bg-[color:var(--color-surface)]"
      >
        <span className="flex items-center gap-1">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {label} <span className="text-[color:var(--color-fg-muted)]">({rows.length})</span>
        </span>
      </button>
      {expanded && (
        rows.length === 0 ? (
          <p className="px-2 pb-2 text-[0.7rem] text-[color:var(--color-fg-muted)]">{emptyText}</p>
        ) : (
          <ul className="max-h-[28rem] overflow-y-auto pb-1 font-mono text-[0.72rem]">
            {rows.map((r) => (
              <li key={r.station}>
                <button
                  type="button"
                  onClick={() => onSelect?.(r.station)}
                  className="flex w-full items-baseline justify-between gap-2 px-2 py-0.5 text-left hover:bg-[color:var(--color-surface)]"
                >
                  <span className="text-[color:var(--color-fg)]">{r.station}</span>
                  <span className="truncate text-[color:var(--color-fg-muted)]">
                    {r.state ?? ""} {r.name ? `· ${r.name}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
