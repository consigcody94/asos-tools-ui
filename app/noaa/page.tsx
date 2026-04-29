import { OpsBanner } from "@/components/ops-banner";
import {
  GOVERNMENT_API_ATLAS,
  GITHUB_MODERNIZATION_QUEUE,
  NOAA_PROGRAM_COVERAGE,
  REPORTING_PRODUCTS,
  type AtlasDomain,
  type AtlasStatus,
  atlasCounts,
} from "@/lib/server/noaa-atlas";
import { Database, ExternalLink, GitBranch, Layers3, ShieldCheck } from "lucide-react";

export const metadata = { title: "NOAA Atlas — O.W.L." };

const DOMAIN_LABELS: Record<AtlasDomain, string> = {
  aviation: "Aviation",
  climate: "Climate",
  hazards: "Hazards",
  hydrology: "Hydrology",
  maps: "Maps",
  marine: "Marine",
  models: "Models",
  orbital: "Orbital",
  radar: "Radar",
  satellite: "Satellite",
  surface: "Surface",
  "quality-control": "QC",
};

export default function NoaaAtlasPage() {
  const counts = atlasCounts();
  const grouped = GOVERNMENT_API_ATLAS.reduce((acc, source) => {
    (acc[source.domain] ||= []).push(source);
    return acc;
  }, {} as Record<AtlasDomain, typeof GOVERNMENT_API_ATLAS>);

  const domains = Object.keys(grouped).sort() as AtlasDomain[];

  return (
    <>
      <OpsBanner status="operational" nodesActive={counts.live} nodesTotal={counts.total} />

      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--color-fg)]">
            NOAA Source Atlas
          </h1>
          <p className="text-[color:var(--color-fg-muted)] mt-1 text-sm max-w-3xl leading-relaxed">
            A public-data integration map for the ASOS network: what OWL consumes now,
            what is ready to wire next, and which open tools are worth modernizing for
            reports, radar, satellite, hydrology, and model evidence.
          </p>
        </div>
        <a
          href="/api/noaa-atlas"
          className="noc-btn inline-flex items-center gap-2"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Database size={14} />
          JSON atlas
        </a>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-5 gap-3 mb-4">
        <AtlasStat label="Tracked sources" value={counts.total} tone="info" />
        <AtlasStat label="Live in OWL" value={counts.live} tone="ok" />
        <AtlasStat label="Ready next" value={counts.ready} tone="info" />
        <AtlasStat label="Keyed feeds" value={counts.keyed} tone="warn" />
        <AtlasStat label="Research feeds" value={counts.research} tone="dim" />
      </section>

      <section className="noc-panel mb-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={15} className="text-[color:var(--color-accent)]" />
          <div className="noc-h3 m-0">NOAA Program Coverage</div>
        </div>
        <div className="overflow-auto border border-[color:var(--color-border)] rounded">
          <table className="owl-table">
            <thead>
              <tr>
                <th>Program</th>
                <th>Office</th>
                <th>Coverage</th>
                <th>Next level</th>
              </tr>
            </thead>
            <tbody>
              {NOAA_PROGRAM_COVERAGE.map((row) => (
                <tr key={row.program}>
                  <td className="font-semibold min-w-[180px]">{row.program}</td>
                  <td className="text-[color:var(--color-fg-muted)] min-w-[180px]">{row.office}</td>
                  <td className="min-w-[260px]">{row.coverage}</td>
                  <td className="text-[color:var(--color-fg-muted)] min-w-[260px]">{row.nextLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="noc-panel mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Layers3 size={15} className="text-[color:var(--color-accent)]" />
          <div className="noc-h3 m-0">Government and Free API Matrix</div>
        </div>
        <div className="space-y-4">
          {domains.map((domain) => (
            <div key={domain}>
              <div className="text-[0.72rem] uppercase tracking-[0.08em] font-semibold text-[color:var(--color-fg-muted)] mb-2">
                {DOMAIN_LABELS[domain]}
              </div>
              <div className="overflow-auto border border-[color:var(--color-border)] rounded">
                <table className="owl-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Auth</th>
                      <th>Cadence</th>
                      <th>Use</th>
                      <th>Implementation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[domain].map((source) => (
                      <tr key={source.id}>
                        <td className="min-w-[220px]">
                          <a
                            href={source.docs}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[color:var(--color-accent)] hover:underline font-medium"
                          >
                            {source.name}
                            <ExternalLink size={10} />
                          </a>
                          <div className="text-[0.68rem] text-[color:var(--color-fg-dim)]">{source.agency}</div>
                        </td>
                        <td><StatusBadge status={source.status} /></td>
                        <td className="text-[color:var(--color-fg-muted)] min-w-[120px]">{source.auth}</td>
                        <td className="text-[color:var(--color-fg-muted)] min-w-[120px]">{source.cadence}</td>
                        <td className="min-w-[260px]">{source.usedFor}</td>
                        <td className="text-[color:var(--color-fg-muted)] min-w-[300px]">{source.implementation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4">
        <div className="noc-panel">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch size={15} className="text-[color:var(--color-accent)]" />
            <div className="noc-h3 m-0">GitHub Modernization Queue</div>
          </div>
          <div className="space-y-3">
            {GITHUB_MODERNIZATION_QUEUE.map((repo) => (
              <div key={repo.url} className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-bg)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <a href={repo.url} target="_blank" rel="noopener noreferrer" className="text-[color:var(--color-accent)] hover:underline font-semibold inline-flex items-center gap-1">
                    {repo.name}
                    <ExternalLink size={10} />
                  </a>
                  <div className="font-mono text-[0.68rem] text-[color:var(--color-fg-dim)]">
                    {repo.stars.toLocaleString()} stars · {repo.license}
                  </div>
                </div>
                <div className="text-sm text-[color:var(--color-fg)] mt-2">{repo.usefulFor}</div>
                <div className="text-xs text-[color:var(--color-fg-muted)] mt-1">{repo.modernization}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="noc-panel">
          <div className="noc-h3 mb-3">Reporting Products</div>
          <div className="space-y-3">
            {REPORTING_PRODUCTS.map((report) => (
              <div key={report.name} className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-bg)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold text-[color:var(--color-fg)]">{report.name}</div>
                  <span className="owl-pill owl-pill-info shrink-0">{report.output}</span>
                </div>
                <div className="text-sm mt-2">{report.operatorValue}</div>
                <div className="text-xs text-[color:var(--color-fg-muted)] mt-1">{report.implementation}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {report.sourceIds.map((id) => (
                    <span key={id} className="px-2 py-0.5 rounded border border-[color:var(--color-border)] text-[0.62rem] font-mono text-[color:var(--color-fg-muted)]">
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function AtlasStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "info" | "dim";
}) {
  const color =
    tone === "ok"
      ? "var(--color-ok)"
      : tone === "warn"
        ? "var(--color-warn)"
        : tone === "info"
          ? "var(--color-accent)"
          : "var(--color-fg-muted)";
  return (
    <div className="noc-panel py-3 px-4">
      <div className="noc-label text-[0.62rem] mb-1">{label}</div>
      <div className="font-mono text-2xl tabular-nums font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AtlasStatus }) {
  const cls =
    status === "live"
      ? "owl-pill owl-pill-ok"
      : status === "ready"
        ? "owl-pill owl-pill-info"
        : status === "keyed"
          ? "owl-pill owl-pill-warn"
          : "owl-pill owl-pill-dim";
  return <span className={`${cls} uppercase`}>{status}</span>;
}
