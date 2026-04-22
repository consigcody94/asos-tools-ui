/** Top-of-page KPI cards — health %, station counts, scan freshness.
 *  Server component — fetches from the OWL HF API at build/render time.
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
  // Stations in NO DATA shouldn't penalise the percentage — that just
  // means we haven't scanned them yet (cold boot, first 5-min window).
  const denom = props.total - props.noData;
  const healthPct = denom > 0
    ? Math.round((props.clean / denom) * 100)
    : null;

  return (
    <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      <KpiCard
        label="Network Health"
        value={healthPct === null ? "—" : `${healthPct}%`}
        tone={
          healthPct === null
            ? "dim"
            : healthPct >= 85
              ? "ok"
              : healthPct >= 70
                ? "warn"
                : "crit"
        }
        accent
      />
      <KpiCard label="Clean"       value={fmt(props.clean)}     tone="ok" />
      <KpiCard label="Flagged"     value={fmt(props.flagged)}   tone="warn" />
      <KpiCard label="Missing"     value={fmt(props.missing)}   tone="crit" />
      <KpiCard label="Recovered"   value={fmt(props.recovered)} tone="info" />
      <KpiCard
        label={props.noData > 0 ? "Awaiting Scan" : "Last Scan"}
        value={
          props.noData > 0
            ? fmt(props.noData)
            : props.scanAgeSec === null
              ? "—"
              : `${pad(props.scanAgeSec, 3)}s`
        }
        tone="dim"
      />
    </section>
  );
}

type Tone = "ok" | "warn" | "crit" | "info" | "dim";
const TONE_COLOR: Record<Tone, string> = {
  ok:   "var(--color-noc-ok)",
  warn: "var(--color-noc-warn)",
  crit: "var(--color-noc-crit)",
  info: "var(--color-noc-cyan)",
  dim:  "var(--color-noc-muted)",
};

function KpiCard({
  label,
  value,
  tone,
  accent = false,
}: {
  label: string;
  value: string;
  tone: Tone;
  accent?: boolean;
}) {
  const color = TONE_COLOR[tone];
  return (
    <div
      className="
        relative bg-[linear-gradient(180deg,var(--color-noc-panel)_0%,var(--color-noc-panel-alt)_100%)]
        border border-noc-border border-l-2
        px-4 py-3
      "
      style={{
        borderLeftColor: accent ? "var(--color-noc-cyan)" : color,
        boxShadow: accent
          ? "0 0 0 1px rgba(0,229,255,0.1), inset 0 0 30px rgba(0,229,255,0.04)"
          : undefined,
      }}
    >
      {/* Top-right + bottom-right corner accents */}
      <span className="absolute top-0 right-0 w-2 h-2 border-t border-r border-noc-cyan" />
      <span className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-noc-cyan" />

      <div className="noc-label text-[0.65rem] mb-1">{label}</div>
      <div
        className="font-display font-bold text-2xl tabular-nums leading-none"
        style={{
          color,
          textShadow: accent ? `0 0 18px ${color}55` : `0 0 8px ${color}33`,
        }}
      >
        {value}
      </div>
    </div>
  );
}
