"use client";

/** Mission-control bar pinned to the top of every page.
 *
 *  Live-updates the UTC clock on the client (no SSR mismatch — the
 *  initial render uses a fixed placeholder, then the effect ticks).
 *
 *  Status is supplied from the server via props so the indicator can
 *  reflect actual scan state (`/api/health.status_counts`) rather than
 *  always-green.
 */

import { useEffect, useState } from "react";
import { isoUtc, pad } from "@/lib/utils";

export type OpsStatus = "operational" | "monitoring" | "degraded" | "unknown";

const STATUS_COLOR: Record<OpsStatus, string> = {
  operational: "var(--color-noc-ok)",
  monitoring: "var(--color-noc-warn)",
  degraded: "var(--color-noc-crit)",
  unknown: "var(--color-noc-dim)",
};

interface Props {
  status: OpsStatus;
  nodesActive: number;
  nodesTotal: number;
  mission?: string;
}

export function OpsBanner({
  status,
  nodesActive,
  nodesTotal,
  mission = "OWL-01",
}: Props) {
  const [clock, setClock] = useState("--:--:--Z");
  useEffect(() => {
    const tick = () => setClock(isoUtc(new Date()).slice(11));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const statusColor = STATUS_COLOR[status];

  return (
    <div
      className="
        relative flex items-center justify-between
        px-4 py-2 mb-4
        bg-[linear-gradient(90deg,rgba(11,18,32,0.95)_0%,rgba(15,26,48,0.95)_50%,rgba(11,18,32,0.95)_100%)]
        border border-noc-border
        border-l-2 border-l-noc-cyan
        font-display text-[0.78rem] tracking-[0.06em]
        shadow-[0_0_20px_rgba(0,0,0,0.5)]
      "
    >
      {/* right-edge cyan glow strip */}
      <div className="absolute top-0 right-0 bottom-0 w-[2px] bg-noc-cyan opacity-60 shadow-[0_0_8px_rgba(0,229,255,0.55)]" />

      <div className="flex items-center gap-3">
        <span className="noc-light noc-light-ok" />
        <span className="noc-label">NETWORK SCAN ACTIVE</span>
        <span className="text-noc-border-strong px-1">|</span>
        <span className="noc-label">
          NODES{" "}
          <span className="noc-readout">
            {pad(nodesActive, 3)}/{pad(nodesTotal, 3)}
          </span>
        </span>
        <span className="text-noc-border-strong px-1">|</span>
        <span className="noc-label">
          MISSION <span className="noc-readout">{mission}</span>
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span
          className="inline-block w-[9px] h-[9px] rounded-full noc-light"
          style={{
            background: statusColor,
            boxShadow: `0 0 10px ${statusColor}`,
          }}
        />
        <span
          className="font-display font-bold uppercase tracking-[0.18em] text-[0.74rem]"
          style={{ color: statusColor }}
        >
          {status.toUpperCase()}
        </span>
        <span className="text-noc-border-strong px-1">|</span>
        <span className="noc-label">UTC</span>
        <span className="noc-readout text-[0.76rem]">{clock}</span>
      </div>
    </div>
  );
}
