"use client";

/** Admin dashboard — operational console.
 *
 *    1. Scheduler health snapshot from /api/health
 *    2. Status-counts histogram (live)
 *    3. Source registry from /api/sources
 *    4. Future-roadmap: anomaly review, audit log, manual cache flush
 */

import { useMemo, useState } from "react";
import type { HealthSnapshot } from "@/lib/api";

interface SourceRecord {
  id?: string;
  name?: string;
  url?: string;
  trust?: string;
  notes?: string;
  refresh?: string;
  [k: string]: unknown;
}

interface Props {
  health: HealthSnapshot | null;
  sources: SourceRecord[];
}

export function AdminDashboard({ health, sources }: Props) {
  const [tab, setTab] = useState<"health" | "sources" | "roadmap">("health");

  return (
    <>
      <div className="flex gap-2 mb-4 border-b border-noc-border pb-2">
        <SubTab cur={tab} k="health"  set={setTab}>Scheduler &amp; Health</SubTab>
        <SubTab cur={tab} k="sources" set={setTab}>Source Registry <span className="ml-1 text-noc-cyan">{sources.length}</span></SubTab>
        <SubTab cur={tab} k="roadmap" set={setTab}>Roadmap</SubTab>
      </div>

      {tab === "health"  && <HealthView  health={health} />}
      {tab === "sources" && <SourcesView sources={sources} />}
      {tab === "roadmap" && <RoadmapView />}
    </>
  );
}

function SubTab({
  cur, k, set, children,
}: {
  cur: string; k: "health" | "sources" | "roadmap";
  set: (k: "health" | "sources" | "roadmap") => void;
  children: React.ReactNode;
}) {
  const active = cur === k;
  return (
    <button
      onClick={() => set(k)}
      className={`
        font-display uppercase tracking-[0.16em] text-[0.78rem] px-4 py-2
        border-b-2 transition-all
        ${active
          ? "text-noc-cyan border-noc-cyan drop-shadow-[0_0_8px_rgba(0,229,255,0.45)]"
          : "text-noc-muted border-transparent hover:text-noc-text"}
      `}
    >
      {children}
    </button>
  );
}

// ───────────────────── Health ─────────────────────
function HealthView({ health }: { health: HealthSnapshot | null }) {
  if (!health) {
    return (
      <div className="noc-panel">
        <div className="text-noc-crit text-sm">
          /api/health unreachable — backend may be down or cold-booting.
        </div>
      </div>
    );
  }
  const counts = health.status_counts || {};
  const totalCounted = Object.values(counts).reduce((s, n) => s + (n as number), 0);

  return (
    <>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Status"           value={(health.status || "—").toUpperCase()} mono />
        <Stat label="Last tick"        value={health.last_tick_at ? fmtAge(health.last_tick_at) : "never"} mono />
        <Stat label="Tick duration"    value={health.last_tick_duration_s != null ? `${health.last_tick_duration_s.toFixed(1)} s` : "—"} mono />
        <Stat label="Stations scanned" value={String(health.last_tick_stations ?? 0)} mono />
      </section>

      <div className="noc-panel mb-4">
        <div className="noc-h3 mb-3">Status Counts &middot; total {totalCounted}</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {Object.entries(counts).map(([st, n]) => (
            <div key={st} className="bg-noc-deep border border-noc-border p-3">
              <div className="noc-label text-[0.62rem] mb-1">{st}</div>
              <div className="font-mono text-2xl text-noc-cyan tabular-nums">{n as number}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-h3 mb-3">Raw /api/health</div>
        <pre className="font-mono text-[0.7rem] text-noc-muted bg-noc-deep border border-noc-border p-3 overflow-auto max-h-[40vh]">
          {JSON.stringify(health, null, 2)}
        </pre>
      </div>
    </>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="noc-panel py-3 px-4">
      <div className="noc-label text-[0.62rem] mb-1">{label}</div>
      <div className={`text-noc-cyan tabular-nums ${mono ? "font-mono text-lg" : "font-display text-lg"}`}>
        {value}
      </div>
    </div>
  );
}

function fmtAge(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const ageS = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (ageS < 60) return `${ageS} s ago`;
  if (ageS < 3600) return `${Math.floor(ageS / 60)} m ago`;
  return `${Math.floor(ageS / 3600)} h ago`;
}

// ───────────────────── Sources ─────────────────────
function SourcesView({ sources }: { sources: SourceRecord[] }) {
  const trustTone: Record<string, string> = {
    agency:        "var(--color-noc-ok)",
    federal:       "var(--color-noc-ok)",  // legacy
    mirror:        "var(--color-noc-cyan)",
    aggregator:    "var(--color-noc-warn)",
    crowdsourced:  "var(--color-noc-amber)",
  };

  if (sources.length === 0) {
    return (
      <div className="noc-panel">
        <div className="text-noc-muted text-sm">
          /api/sources returned no records.
        </div>
      </div>
    );
  }

  return (
    <div className="noc-panel">
      <div className="overflow-auto max-h-[68vh] border border-noc-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-noc-elevated z-10">
            <tr>
              <Th>ID</Th>
              <Th>Name</Th>
              <Th>Trust</Th>
              <Th>Refresh</Th>
              <Th>URL</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {sources.map((s, idx) => (
              <tr
                key={s.id || idx}
                className={`
                  ${idx % 2 === 0 ? "bg-noc-deep" : "bg-noc-panel"}
                  border-t border-noc-border
                `}
              >
                <td className="px-3 py-1.5 text-noc-cyan font-bold">{s.id || "—"}</td>
                <td className="px-3 py-1.5 text-noc-text">{s.name || "—"}</td>
                <td className="px-3 py-1.5">
                  <span
                    className="font-display uppercase tracking-wider text-[0.7rem]"
                    style={{ color: trustTone[s.trust || ""] || "var(--color-noc-dim)" }}
                  >
                    {s.trust || "—"}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-noc-muted text-xs">{s.refresh || "—"}</td>
                <td className="px-3 py-1.5">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-noc-cyan hover:text-noc-text break-all text-xs">
                      {s.url}
                    </a>
                  ) : "—"}
                </td>
                <td className="px-3 py-1.5 text-noc-muted text-xs font-body">{s.notes || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-[0.7rem] font-display font-bold uppercase tracking-[0.16em] text-noc-muted border-b border-noc-border-strong text-left">
      {children}
    </th>
  );
}

// ───────────────────── Roadmap ─────────────────────
function RoadmapView() {
  return (
    <div className="noc-panel">
      <div className="noc-h3 mb-3">Roadmap (Azure phase plan)</div>
      <ul className="space-y-2 text-sm text-noc-text">
        {[
          ["Application Insights", "frontend + backend telemetry, custom metrics for owl.scan.duration / api.latency / cam.fetch_errors", "PHASE 1"],
          ["Azure Cache for Redis", "hot METAR + scan cache, ~30s TTL", "PHASE 1"],
          ["PostgreSQL Flexible Server", "stations + scans + audit_events + roles + users", "PHASE 2"],
          ["Key Vault + Managed Identity", "no plaintext secrets in container env", "PHASE 2"],
          ["Azure SignalR Service", "real-time globe push instead of 60s polling", "PHASE 3"],
          ["Azure OpenAI GPT-4o", "AI BRIEF — generate shift-change handoff from scan + alerts", "PHASE 4"],
          ["Microsoft Entra ID SSO", "RBAC: noc_duty / aomc / forecaster / viewer", "PHASE 5"],
          ["Azure Front Door + WAF", "DDoS, OWASP top 10, custom domain", "PHASE 5"],
          ["GitHub Actions OIDC", "no stored secrets; preview env per PR", "PHASE 6"],
          ["Anomaly review queue", "stumpy Matrix Profile flagged windows for human review", "FOLLOW-ON"],
          ["Manual cache flush + audit", "operator-driven cache invalidation, all logged", "FOLLOW-ON"],
        ].map(([title, desc, phase]) => (
          <li key={title} className="flex gap-3 items-start py-1">
            <span className="font-mono text-[0.65rem] text-noc-cyan shrink-0 w-20 mt-1 uppercase tracking-wider">
              {phase}
            </span>
            <div>
              <div className="font-display text-noc-text">{title}</div>
              <div className="text-xs text-noc-muted">{desc}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
