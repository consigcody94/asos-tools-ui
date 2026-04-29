"use client";

/** Ops status bar pinned to the top of every page.
 *  Live UTC clock, network node count, overall status badge.
 *  Professional — no neon, no scanlines, no blinking lights.
 */

import { useEffect, useState } from "react";
import { isoUtc, pad } from "@/lib/utils";

export type OpsStatus = "operational" | "monitoring" | "degraded" | "unknown";

const STATUS_STYLE: Record<OpsStatus, { label: string; pill: string }> = {
  operational: { label: "OPERATIONAL",    pill: "owl-pill owl-pill-ok"   },
  monitoring:  { label: "MONITORING",     pill: "owl-pill owl-pill-warn" },
  degraded:    { label: "DEGRADED",       pill: "owl-pill owl-pill-crit" },
  unknown:     { label: "UNKNOWN",        pill: "owl-pill owl-pill-dim"  },
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

  const s = STATUS_STYLE[status];

  return (
    <div className="-mx-4 mb-2 flex items-center justify-between gap-3 border-y border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 sm:mx-0 sm:mb-5 sm:gap-6 sm:rounded-md sm:border sm:px-4 sm:py-2.5">
      <div className="flex items-center gap-2 text-[0.72rem] sm:flex-wrap sm:gap-4 sm:text-[0.8rem]">
        <span className={s.pill}>{s.label}</span>
        <span className="hidden text-[color:var(--color-fg-dim)] sm:inline">·</span>
        <span className="whitespace-nowrap text-[color:var(--color-fg-muted)]">
          Nodes{" "}
          <span className="noc-readout text-[color:var(--color-fg)]">
            {pad(nodesActive, 3)} / {pad(nodesTotal, 3)}
          </span>
        </span>
        <span className="hidden text-[color:var(--color-fg-dim)] sm:inline">·</span>
        <span className="hidden text-[color:var(--color-fg-muted)] sm:inline">
          Mission{" "}
          <span className="noc-readout text-[color:var(--color-fg)]">
            {mission}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-2 text-[0.72rem] sm:gap-3 sm:text-[0.8rem]">
        <span className="hidden text-[color:var(--color-fg-muted)] sm:inline">UTC</span>
        <span className="noc-readout text-[color:var(--color-fg)]">{clock}</span>
      </div>
    </div>
  );
}
