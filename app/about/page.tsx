import { OpsBanner } from "@/components/ops-banner";

export const metadata = { title: "About — O.W.L." };

export default function AboutPage() {
  return (
    <>
      <OpsBanner status="operational" nodesActive={918} nodesTotal={918} />

      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--color-fg)]">
          About O.W.L.
        </h1>
        <p className="text-[color:var(--color-fg-muted)] mt-1 text-sm">
          Observation Watch Log — architecture, sources, and author.
        </p>
      </header>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="noc-panel">
          <div className="noc-h3 mb-3">What this is</div>
          <p className="text-[color:var(--color-fg)] text-sm leading-relaxed mb-3">
            O.W.L. (Observation Watch Log) is an operations console for the AOMC
            ASOS network: 918 K / P / T stations operated by NWS, FAA, DOD, Navy,
            and contracted experimental sites. The console tracks station health
            in real time, surfaces sensor maintenance flags from raw METAR <code className="text-[color:var(--color-accent)]">$</code> remarks,
            and provides one-click drills into the camera, satellite, radar, and
            pilot-report context around any station that needs attention.
          </p>
          <p className="text-[color:var(--color-fg)] text-sm leading-relaxed">
            Everything in this UI is served by this app itself — the thirteen
            upstream data sources are consumed directly from{" "}
            <code className="text-[color:var(--color-accent)]">lib/server/*</code>{" "}
            via Next.js API routes. No HuggingFace dependency, no external backend.
          </p>
        </section>

        <section className="noc-panel">
          <div className="noc-h3 mb-3">Stack</div>
          <ul className="text-sm text-[color:var(--color-fg)] space-y-1.5">
            <Li label="Frontend">Next.js 16 / React 19 / Tailwind 4</Li>
            <Li label="Backend">Self-hosted — all data sources in <code>lib/server/*</code> + Next.js API routes</Li>
            <Li label="Globe">Globe.gl + Three.js (NASA Blue Marble texture)</Li>
            <Li label="Hosting">Proxmox LXC behind Caddy + Cloudflare Tunnel</Li>
            <Li label="State">Postgres (audit, RBAC) + Redis (warm scan cache)</Li>
            <Li label="Telemetry">Prometheus + Grafana (sub-pathed at <code>/grafana</code>)</Li>
            <Li label="Auth">Authelia SSO via Caddy <code>forward_auth</code></Li>
            <Li label="AI Brief">OpenAI-compatible (Ollama / vLLM / OpenAI / Azure OpenAI)</Li>
            <Li label="Secrets">age-encrypted env file decrypted at boot via systemd</Li>
          </ul>
        </section>

        <section className="noc-panel">
          <div className="noc-h3 mb-3">Station status</div>
          <ul className="text-sm space-y-2">
            <StatusRow label="CLEAN"        tone="ok"   desc="Reporting on cadence, no $ flag, healthy" />
            <StatusRow label="RECOVERED"    tone="info" desc="Returned to clean after a recent flag/missing window" />
            <StatusRow label="INTERMITTENT" tone="warn" desc="Mixed reporting — gaps but not silent" />
            <StatusRow label="FLAGGED"      tone="warn" desc="$ remark present in latest METAR (sensor-degraded)" />
            <StatusRow label="MISSING"      tone="crit" desc="No METAR received in the last 2 h" />
            <StatusRow label="OFFLINE"      tone="dim"  desc="Decommissioned in catalog (≥14 d silent)" />
            <StatusRow label="NO DATA"      tone="dim"  desc="Awaiting first scan — neutral" />
          </ul>
        </section>

        <section className="noc-panel">
          <div className="noc-h3 mb-3">Authoritative sources — all public, zero scraping</div>
          <ul className="text-sm text-[color:var(--color-fg)] space-y-1.5">
            <Li label="IEM">Iowa Environmental Mesonet — METAR archive + 1-min CSV</Li>
            <Li label="NCEI">National Centers for Environmental Information — HOMR + archives</Li>
            <Li label="NWS">api.weather.gov — current conditions + CAP alerts</Li>
            <Li label="AWC">Aviation Weather Center — METAR / TAF / SIGMET / AIRMET / PIREP / AFD</Li>
            <Li label="RIDGE">NWS NEXRAD RIDGE — per-station WSR-88D animated loops (159 sites)</Li>
            <Li label="NESDIS">GOES-19 East + GOES-18 West satellite loops (auto-routed by station)</Li>
            <Li label="USGS">Earthquake Hazards — real-time GeoJSON, per-station correlation</Li>
            <Li label="NHC">National Hurricane Center — active tropical cyclones</Li>
            <Li label="NDBC">National Data Buoy Center — 402 met-enabled buoys</Li>
            <Li label="CO-OPS">NOS Tides &amp; Currents — coastal water level, wind, pressure, temperature</Li>
            <Li label="FAA">WeatherCams — 260+ FAA + hosted airport cams</Li>
            <Li label="SWPC">NOAA Space Weather Prediction Center — Kp, X-ray, alerts</Li>
            <Li label="FAA NOTAM">Planned-outage correlation (key-gated)</Li>
            <Li label="NOAA Atlas">NWPS, NOMADS, MRMS, NEXRAD/GOES NODD, MADIS, and map-service expansion queue</Li>
          </ul>
        </section>

        <section className="noc-panel lg:col-span-2">
          <div className="noc-h3 mb-3">Author</div>
          <p className="text-sm text-[color:var(--color-fg)]">
            Built and maintained by{" "}
            <a href="mailto:cto@sentinelowl.org" className="text-[color:var(--color-accent)] hover:underline font-medium">
              Cody Churchwell
            </a>
            , CTO of Sentinel OWL. Source:{" "}
            <a href="https://github.com/consigcody94/asos-tools-ui" target="_blank" rel="noopener noreferrer" className="text-[color:var(--color-accent)] hover:underline">
              github.com/consigcody94/asos-tools-ui
            </a>
            . MIT licensed.
          </p>
        </section>
      </div>
    </>
  );
}

function Li({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="font-semibold uppercase tracking-wider text-[0.6rem] text-[color:var(--color-accent)] w-28 shrink-0 mt-0.5">{label}</span>
      <span className="text-[color:var(--color-fg)]">{children}</span>
    </li>
  );
}

function StatusRow({ label, tone, desc }: { label: string; tone: "ok" | "warn" | "crit" | "info" | "dim"; desc: string }) {
  const pillClass =
    tone === "ok"   ? "owl-pill owl-pill-ok"
    : tone === "warn" ? "owl-pill owl-pill-warn"
    : tone === "crit" ? "owl-pill owl-pill-crit"
    : tone === "info" ? "owl-pill owl-pill-info"
    : "owl-pill owl-pill-dim";
  return (
    <li className="flex items-baseline gap-3">
      <span className={`${pillClass} min-w-[7rem] justify-center`}>{label}</span>
      <span className="text-[color:var(--color-fg)]">{desc}</span>
    </li>
  );
}
