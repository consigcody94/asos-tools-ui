"use client";

/** Admin dashboard — operational console.
 *
 *    1. Scheduler health snapshot from /api/health
 *    2. Status-counts histogram (live)
 *    3. Source registry from /api/sources
 *    4. Operator controls: metrics endpoint + manual cache flush
 */

import { useEffect, useState } from "react";
import type { HealthSnapshot } from "@/lib/api";

interface AuditEvent {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
}

interface SourceRecord {
  id?: string;
  name?: string;
  url?: string;
  trust?: string;
  notes?: string;
  refresh?: string;
  cadence?: string;
  used_for?: string;
  [k: string]: unknown;
}

interface Props {
  health: HealthSnapshot | null;
  sources: SourceRecord[];
}

export function AdminDashboard({ health, sources }: Props) {
  const [tab, setTab] = useState<"health" | "sources" | "ops" | "audit">("health");

  return (
    <>
      <div className="flex gap-2 mb-4 border-b border-noc-border pb-2">
        <SubTab cur={tab} k="health"  set={setTab}>Scheduler &amp; Health</SubTab>
        <SubTab cur={tab} k="sources" set={setTab}>Source Registry <span className="ml-1 text-noc-cyan">{sources.length}</span></SubTab>
        <SubTab cur={tab} k="ops" set={setTab}>Operations</SubTab>
        <SubTab cur={tab} k="audit" set={setTab}>Audit Log</SubTab>
      </div>

      {tab === "health"  && <HealthView  health={health} />}
      {tab === "sources" && <SourcesView sources={sources} />}
      {tab === "ops" && <OperationsView />}
      {tab === "audit" && <AuditView />}
    </>
  );
}

function SubTab({
  cur, k, set, children,
}: {
  cur: string; k: "health" | "sources" | "ops" | "audit";
  set: (k: "health" | "sources" | "ops" | "audit") => void;
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
              <Th>Used for</Th>
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
                <td className="px-3 py-1.5 text-noc-muted text-xs">{s.refresh || s.cadence || "—"}</td>
                <td className="px-3 py-1.5 text-noc-text text-xs min-w-[240px]">{s.used_for || "—"}</td>
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

// ───────────────────── Operations ─────────────────────
function OperationsView() {
  const [flushState, setFlushState] = useState<string>("idle");

  async function flushCache() {
    setFlushState("flushing");
    try {
      const res = await fetch("/api/admin/cache/flush", { method: "POST" });
      setFlushState(res.ok ? "refresh started" : `failed ${res.status}`);
    } catch {
      setFlushState("failed");
    }
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="noc-panel">
        <div className="noc-h3 mb-2">Manual Cache Flush</div>
        <p className="mb-3 text-sm text-noc-muted">
          Clears the in-process scan cache and starts one background refresh. This is paced by the upstream IEM rate limiter.
        </p>
        <button className="noc-btn noc-btn-primary" onClick={flushCache}>Flush scan cache</button>
        <span className="ml-3 font-mono text-xs text-noc-muted">{flushState}</span>
      </div>

      <div className="noc-panel">
        <div className="noc-h3 mb-2">Prometheus Metrics</div>
        <p className="mb-3 text-sm text-noc-muted">
          Scrape backend metrics for scan duration, upstream API latency, and upstream errors.
        </p>
        <a href="/api/metrics" target="_blank" rel="noopener noreferrer" className="noc-btn">Open /api/metrics</a>
      </div>

      <div className="noc-panel md:col-span-2">
        <AnomalyCard />
      </div>
    </div>
  );
}

interface AnomalyFinding {
  station: string;
  state?: string;
  severity: number;
  z: number;
  current_minutes: number;
  baseline_mean: number;
  baseline_std: number;
  detected_at: string;
}

function AnomalyCard() {
  const [data, setData] = useState<{ findings: AnomalyFinding[]; tick_at: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const res = await fetch("/api/admin/anomalies", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="noc-h3">Anomaly Review Queue</div>
        <button className="noc-btn" onClick={refresh}>Refresh</button>
      </div>
      <p className="text-sm text-noc-muted mb-3">
        Per-station rolling z-score on minutes-since-last-report.
        Stations whose lateness suddenly spikes ≥3σ above their own normal show up here.
      </p>
      {err && <div className="text-noc-crit text-sm mb-2">{err}</div>}
      {!data && !err && <div className="text-sm text-noc-muted">Loading…</div>}
      {data && data.findings.length === 0 && (
        <div className="text-sm text-noc-muted">
          No outlier stations right now. Tick last ran {data.tick_at ?? "never"}.
        </div>
      )}
      {data && data.findings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-noc-muted">
              <tr>
                <th className="py-1.5 pr-3">Station</th>
                <th className="py-1.5 pr-3">State</th>
                <th className="py-1.5 pr-3">z</th>
                <th className="py-1.5 pr-3">Current min</th>
                <th className="py-1.5 pr-3">Baseline (μ ± σ)</th>
                <th className="py-1.5">Detected</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {data.findings.map((f) => (
                <tr key={`${f.station}-${f.detected_at}`} className="border-t border-noc-border/40">
                  <td className="py-1.5 pr-3 text-noc-cyan">{f.station}</td>
                  <td className="py-1.5 pr-3">{f.state ?? "—"}</td>
                  <td className="py-1.5 pr-3">{f.z.toFixed(2)}</td>
                  <td className="py-1.5 pr-3">{f.current_minutes}</td>
                  <td className="py-1.5 pr-3 text-noc-muted">
                    {f.baseline_mean.toFixed(1)} ± {f.baseline_std.toFixed(1)}
                  </td>
                  <td className="py-1.5 text-noc-muted">{f.detected_at.replace("T", " ").slice(0, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────────────────── Audit ─────────────────────
function AuditView() {
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const res = await fetch("/api/admin/audit?limit=200", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events: AuditEvent[] };
      setRows(data.events);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="noc-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="noc-h3">Operator Audit Log</div>
        <button className="noc-btn" onClick={refresh}>Refresh</button>
      </div>
      {err && <div className="text-noc-crit text-sm mb-2">{err}</div>}
      {!rows && !err && <div className="text-sm text-noc-muted">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="text-sm text-noc-muted">No operator events recorded yet. Trigger one (e.g. flush the scan cache) and it will appear here.</div>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-noc-muted">
              <tr>
                <th className="py-1.5 pr-3">When (UTC)</th>
                <th className="py-1.5 pr-3">Actor</th>
                <th className="py-1.5 pr-3">Action</th>
                <th className="py-1.5 pr-3">Target</th>
                <th className="py-1.5">Metadata</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-noc-border/40">
                  <td className="py-1.5 pr-3 text-noc-muted whitespace-nowrap">{r.created_at.replace("T", " ").slice(0, 19)}</td>
                  <td className="py-1.5 pr-3">{r.actor}</td>
                  <td className="py-1.5 pr-3 text-noc-cyan">{r.action}</td>
                  <td className="py-1.5 pr-3">{r.target ?? "—"}</td>
                  <td className="py-1.5 text-noc-muted">{Object.keys(r.metadata).length === 0 ? "—" : JSON.stringify(r.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
