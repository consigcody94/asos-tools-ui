"use client";

/** Forecasters dashboard — three sub-tabs:
 *
 *    1. ACTIVE HAZARDS — current SIGMETs / AIRMETs from AWC
 *    2. PIREPs         — last 2h pilot reports from AWC
 *    3. STATION PICKER — METAR + TAF for any K/P/T station
 */

import { useMemo, useState } from "react";
import { type Station } from "@/lib/data/stations";
import { OWL_API_BASE } from "@/lib/api";
import { AlertTriangle, Plane, Search } from "lucide-react";

interface AirSigmet {
  airSigmetId?: number;
  airSigmetType?: string;
  rawAirSigmet?: string;
  hazard?: string;
  severity?: string;
  validTimeFrom?: string;
  validTimeTo?: string;
  altitudeLow1?: number;
  altitudeHi1?: number;
}

interface Pirep {
  receiptTime?: string;
  obsTime?: string;
  rawOb?: string;
  acType?: string;
  fltlvl?: number;
  lat?: number;
  lon?: number;
}

interface Props {
  sigmets: AirSigmet[];
  pireps: Pirep[];
  stations: Station[];
}

type Tab = "hazards" | "pireps" | "station";

export function ForecastersDashboard({ sigmets, pireps, stations }: Props) {
  const [tab, setTab] = useState<Tab>("hazards");

  return (
    <>
      {/* Sub-tab switcher */}
      <div className="flex gap-2 mb-4 border-b border-noc-border pb-2">
        <SubTab cur={tab} k="hazards" set={setTab} icon={<AlertTriangle size={13} />}>
          Active Hazards <span className="ml-1 text-noc-cyan">{sigmets.length}</span>
        </SubTab>
        <SubTab cur={tab} k="pireps" set={setTab} icon={<Plane size={13} />}>
          PIREPs <span className="ml-1 text-noc-cyan">{pireps.length}</span>
        </SubTab>
        <SubTab cur={tab} k="station" set={setTab} icon={<Search size={13} />}>
          Station METAR / TAF
        </SubTab>
      </div>

      {tab === "hazards"  && <HazardsView sigmets={sigmets} />}
      {tab === "pireps"   && <PirepsView  pireps={pireps} />}
      {tab === "station"  && <StationView stations={stations} />}
    </>
  );
}

function SubTab({
  cur, k, set, icon, children,
}: {
  cur: Tab;
  k: Tab;
  set: (k: Tab) => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const active = cur === k;
  return (
    <button
      onClick={() => set(k)}
      className={`
        font-display uppercase tracking-[0.16em] text-[0.78rem] px-4 py-2
        flex items-center gap-2 border-b-2 transition-all
        ${active
          ? "text-noc-cyan border-noc-cyan drop-shadow-[0_0_8px_rgba(0,229,255,0.45)]"
          : "text-noc-muted border-transparent hover:text-noc-text hover:border-noc-cyan-dim"}
      `}
    >
      {icon}
      {children}
    </button>
  );
}

// ───────────────────── Active Hazards ─────────────────────
function HazardsView({ sigmets }: { sigmets: AirSigmet[] }) {
  const groupedByHazard = useMemo(() => {
    const m = new Map<string, AirSigmet[]>();
    for (const s of sigmets) {
      const h = s.hazard || "OTHER";
      const list = m.get(h) || [];
      list.push(s);
      m.set(h, list);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [sigmets]);

  if (sigmets.length === 0) {
    return (
      <div className="noc-panel">
        <div className="text-center py-12">
          <div className="noc-label mb-2 text-[0.7rem]">All Clear</div>
          <div className="text-noc-muted">
            No active SIGMETs or AIRMETs from AWC.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Hazard type summary */}
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
        {groupedByHazard.map(([hazard, list]) => (
          <div key={hazard} className="noc-panel py-3 px-4">
            <div className="noc-label text-[0.62rem] mb-1">{hazard}</div>
            <div className="font-mono text-2xl text-noc-cyan tabular-nums">
              {list.length}
            </div>
          </div>
        ))}
      </section>

      {/* Detail list */}
      <div className="noc-panel">
        <div className="space-y-2 max-h-[68vh] overflow-auto">
          {sigmets.map((s, i) => (
            <div
              key={s.airSigmetId || i}
              className="bg-noc-deep border-l-2 border-noc-warn p-3"
            >
              <div className="flex items-baseline gap-3 flex-wrap mb-2">
                <span className="font-display font-bold text-noc-warn uppercase tracking-wider text-sm">
                  {s.hazard || "—"}
                </span>
                <span className="noc-label text-[0.65rem]">
                  {s.airSigmetType || "AIRMET"}
                </span>
                {s.severity && (
                  <span className="noc-label text-[0.65rem] text-noc-amber">
                    severity {s.severity}
                  </span>
                )}
                {s.validTimeFrom && s.validTimeTo && (
                  <span className="font-mono text-[0.7rem] text-noc-dim ml-auto tabular-nums">
                    {fmtZ(s.validTimeFrom)} → {fmtZ(s.validTimeTo)}
                  </span>
                )}
              </div>
              {s.rawAirSigmet && (
                <pre className="font-mono text-[0.72rem] text-noc-text whitespace-pre-wrap break-all">
                  {s.rawAirSigmet}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ───────────────────── PIREPs ─────────────────────
function PirepsView({ pireps }: { pireps: Pirep[] }) {
  const sorted = useMemo(
    () => [...pireps].sort((a, b) => (b.receiptTime || "").localeCompare(a.receiptTime || "")),
    [pireps],
  );

  if (sorted.length === 0) {
    return (
      <div className="noc-panel">
        <div className="text-center py-12">
          <div className="noc-label mb-2 text-[0.7rem]">No Recent PIREPs</div>
          <div className="text-noc-muted">
            No pilot reports received in the last 2 hours from AWC.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="noc-panel">
      <div className="space-y-1.5 max-h-[68vh] overflow-auto">
        {sorted.map((p, i) => (
          <div key={i} className="flex gap-3 items-start py-1.5 border-b border-noc-border">
            <span className="font-mono text-[0.7rem] text-noc-cyan tabular-nums shrink-0 w-14">
              {p.fltlvl ? `FL${String(p.fltlvl).padStart(3, "0")}` : "—"}
            </span>
            <span className="font-mono text-[0.7rem] text-noc-dim shrink-0 w-16 tabular-nums">
              {fmtZ(p.obsTime || p.receiptTime)}
            </span>
            <span className="font-mono text-[0.74rem] text-noc-text break-all">
              {p.rawOb}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────── Station picker ─────────────────────
function StationView({ stations }: { stations: Station[] }) {
  const [icao, setIcao] = useState("KJFK");
  const [metar, setMetar] = useState<string>("");
  const [taf, setTaf] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function load(id: string) {
    if (!id || !/^[KPT][A-Z0-9]{3,4}$/i.test(id)) return;
    setLoading(true);
    setMetar("");
    setTaf("");
    try {
      const [m, t] = await Promise.all([
        fetch(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(id)}&format=raw`).then((r) => r.text()).catch(() => ""),
        fetch(`https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(id)}&format=raw`).then((r) => r.text()).catch(() => ""),
      ]);
      setMetar(m.trim());
      setTaf(t.trim());
    } finally {
      setLoading(false);
    }
  }

  const matchedStation = stations.find((s) => s.id === icao.toUpperCase());

  return (
    <div className="noc-panel">
      <form
        onSubmit={(e) => { e.preventDefault(); load(icao.toUpperCase()); }}
        className="flex gap-2 mb-4"
      >
        <input
          value={icao}
          onChange={(e) => setIcao(e.target.value.toUpperCase())}
          maxLength={5}
          placeholder="KJFK"
          className="
            flex-1 max-w-xs px-3 py-2 bg-noc-deep border border-noc-border-strong
            text-noc-cyan font-mono text-lg uppercase tracking-wider tabular-nums
            focus:border-noc-cyan focus:outline-none
            focus:shadow-[0_0_0_1px_var(--color-noc-cyan),0_0_12px_rgba(0,229,255,0.25)]
          "
        />
        <button type="submit" className="noc-btn noc-btn-primary" disabled={loading}>
          {loading ? "Loading…" : "Fetch"}
        </button>
      </form>

      {matchedStation && (
        <div className="mb-4 noc-label text-[0.7rem]">
          {matchedStation.name} &middot; {matchedStation.state} &middot; {matchedStation.operator}
          &middot; {matchedStation.lat?.toFixed(2)}, {matchedStation.lon?.toFixed(2)}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="noc-h3 mb-2">Latest METAR</div>
          <pre className="font-mono text-[0.78rem] text-noc-text bg-noc-deep border border-noc-border p-3 whitespace-pre-wrap break-all min-h-[120px]">
            {metar || (loading ? "…" : "Press Fetch to load")}
          </pre>
        </div>
        <div>
          <div className="noc-h3 mb-2">Latest TAF</div>
          <pre className="font-mono text-[0.78rem] text-noc-text bg-noc-deep border border-noc-border p-3 whitespace-pre-wrap break-all min-h-[120px]">
            {taf || (loading ? "…" : "Press Fetch to load")}
          </pre>
        </div>
      </div>

      <div className="mt-4 text-[0.7rem] text-noc-dim">
        Source: <a href="https://aviationweather.gov" target="_blank" rel="noopener noreferrer" className="text-noc-cyan">aviationweather.gov</a>
        &middot; backend: <a href={OWL_API_BASE} target="_blank" rel="noopener noreferrer" className="text-noc-cyan">{OWL_API_BASE.replace("https://", "")}</a>
      </div>
    </div>
  );
}

function fmtZ(iso?: string | number | null): string {
  if (iso === null || iso === undefined) return "—";
  const s = String(iso);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s.slice(0, 16);
  return new Date(t).toISOString().slice(11, 16) + "Z";
}
