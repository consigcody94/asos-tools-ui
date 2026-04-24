"use client";

/** Client half of the Summary page — owns the interactive globe + drill
 *  panel + region presets.  Renders the full 918-station catalog at all
 *  times; status colors come from a periodic poll of the OWL API.
 *
 *  When SignalR is wired (Phase 3) the poll is replaced with a
 *  real-time push subscription and points re-color without a request.
 */

import { useEffect, useMemo, useState } from "react";
import { Globe, type GlobePoint } from "@/components/globe";
import { DrillPanel } from "@/components/drill-panel";
import { Play, RotateCcw, Map } from "lucide-react";
import { STATIONS } from "@/lib/data/stations";

const REGIONS = [
  { id: "conus",  label: "CONUS",     lat: 38,    lng: -97,   alt: 2.3 },
  { id: "ne",     label: "Northeast", lat: 42,    lng: -72,   alt: 1.1 },
  { id: "se",     label: "Southeast", lat: 32,    lng: -84,   alt: 1.1 },
  { id: "ctrl",   label: "Central",   lat: 41,    lng: -93,   alt: 1.1 },
  { id: "west",   label: "West",      lat: 38,    lng: -110,  alt: 1.1 },
  { id: "ak",     label: "Alaska",    lat: 64,    lng: -150,  alt: 1.0 },
  { id: "hi",     label: "Hawaii",    lat: 20.7,  lng: -157,  alt: 0.7 },
  { id: "carib",  label: "Caribbean", lat: 18,    lng: -66,   alt: 0.7 },
];

// Status -> (color, point size) for the globe rendering.
// Colours align with the global theme tokens — muted, not neon.
const STATUS_VIZ: Record<string, { color: string; size: number }> = {
  CLEAN:        { color: "#3fb27f", size: 0.30 },
  RECOVERED:    { color: "#5fa8e6", size: 0.35 },
  INTERMITTENT: { color: "#c48828", size: 0.40 },
  FLAGGED:      { color: "#e0a73a", size: 0.50 },
  MISSING:      { color: "#e25c6b", size: 0.60 },
  "NO DATA":    { color: "#5f6f8f", size: 0.30 },
};
const DEFAULT_VIZ = STATUS_VIZ.CLEAN;

interface ScanRow {
  station: string;
  status?: string;
}

export function SummaryClient() {
  const [autoRotate, setAutoRotate] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lng: number; alt?: number } | null>(null);
  const [station, setStation] = useState<{ id: string; lat: number; lng: number; name?: string } | null>(null);
  const [statusByStation, setStatusByStation] = useState<Record<string, string>>({});

  // Periodically pull the latest scan from the HF API and overlay status
  // colors onto the catalog points.  Switches to SignalR push in Phase 3.
  // We hit /api/scan-results (added to the HF FastAPI specifically for
  // this frontend); it returns {rows, never_scanned, scanned_at}.
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch(`/api/scan-results`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data: { rows?: ScanRow[] } = await res.json();
        if (cancelled) return;
        if (!data.rows) { setStatusByStation({}); return; }
        const next: Record<string, string> = {};
        for (const r of data.rows) {
          if (r.station) {
            next[r.station] = (r.status || "NO DATA").toUpperCase();
          }
        }
        setStatusByStation(next);
      } catch {
        /* ignore — globe keeps rendering with last-known statuses */
      }
    }

    refresh();
    const id = setInterval(refresh, 60_000);  // poll every 60 s
    return () => {
      cancelled = true;
      clearInterval(id);
      ctrl.abort();
    };
  }, []);

  // Derive globe points from the baked station catalog + current scan
  // status overlay.  Memoized so we don't churn on unrelated re-renders.
  const points: GlobePoint[] = useMemo(() => {
    return STATIONS.map((s) => {
      const status = statusByStation[s.id] || "NO DATA";
      const viz = STATUS_VIZ[status] || DEFAULT_VIZ;
      const shortName = s.name.length > 24 ? s.name.slice(0, 22) + "…" : s.name;
      return {
        station: s.id,
        lat: s.lat,
        lng: s.lon,
        color: viz.color,
        size: viz.size,
        label: `${shortName} · ${s.state} · ${status}`,
      };
    });
  }, [statusByStation]);

  // Live counts for the floating overlay summary.
  const counts = useMemo(() => {
    const c = { CLEAN: 0, FLAGGED: 0, MISSING: 0, OTHER: 0 };
    for (const p of points) {
      const s = (p.label || "").split("·").pop()?.trim() || "";
      if (s === "CLEAN") c.CLEAN++;
      else if (s === "FLAGGED") c.FLAGGED++;
      else if (s === "MISSING") c.MISSING++;
      else c.OTHER++;
    }
    return c;
  }, [points]);

  return (
    <>
      <div className="noc-panel mb-4">
        {/* Globe controls header */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="noc-h3 m-0">Network Globe</div>
            <span className="text-[0.7rem] text-noc-dim font-mono tracking-wider">
              <span className="text-noc-cyan">{points.length}</span> sites tracked
              <span className="text-noc-border-strong px-1.5">|</span>
              <span className="text-noc-ok">{counts.CLEAN}</span> clean
              <span className="text-noc-border-strong px-1.5">|</span>
              <span className="text-noc-warn">{counts.FLAGGED}</span> flagged
              <span className="text-noc-border-strong px-1.5">|</span>
              <span className="text-noc-crit">{counts.MISSING}</span> missing
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="noc-btn flex items-center gap-1 text-[0.72rem]"
              onClick={() => setAutoRotate((v) => !v)}
            >
              <Play size={11} /> {autoRotate ? "STOP" : "ROTATE"}
            </button>
            <button
              className="noc-btn flex items-center gap-1 text-[0.72rem]"
              onClick={() => setFocus({ lat: 38, lng: -97, alt: 2.3 })}
            >
              <RotateCcw size={11} /> RESET
            </button>
          </div>
        </div>

        {/* Region preset chips */}
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="noc-label flex items-center gap-1 mr-2">
            <Map size={11} /> REGION:
          </span>
          {REGIONS.map((r) => (
            <button
              key={r.id}
              className="noc-btn text-[0.7rem] py-1 px-3"
              onClick={() => setFocus({ lat: r.lat, lng: r.lng, alt: r.alt })}
            >
              {r.label}
            </button>
          ))}
        </div>

        <Globe
          points={points}
          height={620}
          autoRotate={autoRotate}
          focus={focus}
          onPointClick={(p) =>
            setStation({ id: p.station, lat: p.lat, lng: p.lng, name: p.label })
          }
        />
      </div>

      <DrillPanel station={station} onClose={() => setStation(null)} />
    </>
  );
}
