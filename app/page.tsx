/** O.W.L. Summary tab — landing page.
 *
 *  Server component fetches health snapshot from the HF Space API,
 *  renders the KPI strip server-side (snappy first paint), and hands
 *  the live globe + drill panel to the client component below.
 *
 *  revalidate=15 keeps KPIs fresh — the underlying scan only refreshes
 *  every 5 min on the cron schedule, but we want users hitting the page
 *  after a fresh scan to see the new numbers within seconds, not the
 *  full 60-s edge-cache window.
 */

import { OpsBanner, type OpsStatus } from "@/components/ops-banner";
import { KpiStrip } from "@/components/kpi-strip";
import { SummaryClient } from "./summary-client";
import { AiBrief } from "@/components/ai-brief";
import { getHealth } from "@/lib/api";
// Importing for side-effect: starts App Insights at first render.
import "@/lib/telemetry";

export const revalidate = 15;

interface Counts {
  CLEAN: number;
  FLAGGED: number;
  MISSING: number;
  INTERMITTENT: number;
  RECOVERED: number;
  "NO DATA": number;
}

export default async function SummaryPage() {
  // Pull the network health snapshot.  If the upstream is unreachable
  // we render a degraded but functional shell rather than 500-ing.
  let counts: Counts = {
    CLEAN: 0, FLAGGED: 0, MISSING: 0, INTERMITTENT: 0, RECOVERED: 0,
    "NO DATA": 0,
  };
  let status: OpsStatus = "unknown";
  let scannedAt: string | null = null;
  let scanDurationS: number | null = null;

  try {
    const h = await getHealth();
    counts = { ...counts, ...((h.status_counts as unknown as Partial<Counts>) || {}) };
    if (h.status === "ok") status = "operational";
    else if (h.status === "degraded") status = "monitoring";
    else status = "unknown";
    scannedAt = h.last_tick_at ?? null;
    scanDurationS = h.last_tick_duration_s ?? null;
  } catch {
    // Leave counts at zero / status unknown.  The UI degrades gracefully.
  }

  const total =
    counts.CLEAN + counts.FLAGGED + counts.MISSING +
    counts.INTERMITTENT + counts.RECOVERED + counts["NO DATA"];
  const nodesActive = counts.CLEAN + counts.RECOVERED;

  // "as of" relative time — purely string formatting, no client JS.
  const asOf = formatScanAge(scannedAt);
  const throttled =
    scanDurationS !== null && scanDurationS < 12 && counts.MISSING > 200;

  return (
    <>
      <OpsBanner
        status={status}
        nodesActive={nodesActive}
        nodesTotal={total || 920}
      />

      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-noc-text">
            OBSERVATION CONTROL CENTER
          </h1>
          <p className="noc-label mt-1 flex items-center gap-3 flex-wrap">
          <span>Network-Wide ASOS Status &middot; Live NOAA / FAA / NWS Feeds</span>
          <span className="text-noc-border-strong">|</span>
          <span className="font-mono normal-case tracking-normal text-[0.7rem] text-noc-cyan">
            scan {asOf}
            {scanDurationS !== null && (
              <span className="text-noc-dim">
                {" "}({scanDurationS.toFixed(1)}s)
              </span>
            )}
          </span>
          {throttled && (
            <span className="text-[0.7rem] text-noc-warn font-mono normal-case tracking-normal">
              · upstream throttled — values may underreport
            </span>
          )}
          </p>
        </div>
        <AiBrief />
      </header>

      <KpiStrip
        total={total || 918}
        clean={counts.CLEAN}
        flagged={counts.FLAGGED}
        missing={counts.MISSING}
        intermittent={counts.INTERMITTENT}
        recovered={counts.RECOVERED}
        noData={counts["NO DATA"]}
        scanAgeSec={null}
      />

      <SummaryClient />
    </>
  );
}

/** Render an ISO timestamp as "Ns ago" / "Nm ago" / "Nh ago" relative
 *  to the current request time.  Server-rendered, so no client JS or
 *  hydration mismatch. */
function formatScanAge(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const ageMs = Date.now() - t;
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
