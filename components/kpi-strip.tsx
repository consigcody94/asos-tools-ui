/** KPI cards row — network health + state counts + last scan.
 *  Server component — fetches happen in the parent page. No gimmicks.
 */

import { fmt, pad } from "@/lib/utils";

interface Props {
  total: number;
  clean: number;
  flagged: number;
  missing: number;
  intermittent: number;
  recovered: number;
  noData: number;
  scanAgeSec: number | null;
}

export function KpiStrip(props: Props) {
  // Only count stations with KNOWN status when computing health %.
  const denom = props.total - props.noData;
  const healthPct = denom > 0 ? Math.round((props.clean / denom) * 100) : null;

  return (
    <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
      <KpiCard
        label="Network Health"
        value={healthPct === null ? "—" : `${healthPct}%`}
        tone={
          healthPct === null ? "dim"
            : healthPct >= 85 ? "ok"
              : healthPct >= 70 ? "warn"
                : "crit"
        }
        emphasis
      />
      <KpiCard label="Clean"       value={fmt(props.clean)}        tone="ok" />
      <KpiCard label="Flagged"     value={fmt(props.flagged)}      tone="warn" />
      <KpiCard label="Missing"     value={fmt(props.missing)}      tone="crit" />
      <KpiCard label="Recovered"   value={fmt(props.recovered)}    tone="info" />
      <KpiCard
        label={props.noData > 0 ? "Awaiting Scan" : "Last Scan"}
        value={
          props.noData > 0 ? fmt(props.noData)
            : props.scanAgeSec === null ? "—"
              : `${pad(props.scanAgeSec, 3)}s`
        }
        tone="dim"
      />
    </section>
  );
}

type Tone = "ok" | "warn" | "crit" | "info" | "dim";
const TONE_COLOR: Record<Tone, string> = {
  ok:   "var(--color-ok)",
  warn: "var(--color-warn)",
  crit: "var(--color-crit)",
  info: "var(--color-info)",
  dim:  "var(--color-fg-muted)",
};

function KpiCard({
  label,
  value,
  tone,
  emphasis = false,
}: {
  label: string;
  value: string;
  tone: Tone;
  emphasis?: boolean;
}) {
  const color = TONE_COLOR[tone];
  return (
    <div
      className="bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-md px-4 py-3 flex flex-col gap-1"
      style={emphasis ? { borderLeft: `3px solid ${color}` } : undefined}
    >
      <div className="noc-label text-[0.65rem]">{label}</div>
      <div className="font-mono text-2xl tabular-nums leading-none font-medium" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
