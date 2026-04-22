import { OpsBanner } from "@/components/ops-banner";

export const metadata = { title: "About — O.W.L." };

export default function AboutPage() {
  return (
    <>
      <OpsBanner status="operational" nodesActive={918} nodesTotal={918} />

      <header className="mb-6">
        <h1 className="font-display text-4xl font-bold tracking-tight text-noc-text">
          ABOUT
        </h1>
        <p className="noc-label mt-1">
          O.W.L. &middot; Observation Watch Log &middot; Architecture &amp; Provenance
        </p>
      </header>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="noc-panel">
          <div className="noc-h3 mb-3">What this is</div>
          <p className="text-noc-text text-sm leading-relaxed mb-3">
            O.W.L. (Observation Watch Log) is an operations console for the AOMC
            ASOS network: 918 K / P / T stations operated by NWS, FAA, DOD, Navy,
            and contracted experimental sites. The console tracks station health
            in real time, surfaces sensor maintenance flags from raw METAR <code className="text-noc-cyan">$</code> remarks,
            and provides one-click drills into the camera, satellite, and pilot-report
            context around any station that needs attention.
          </p>
          <p className="text-noc-text text-sm leading-relaxed">
            This Azure deployment is the production operations console.
            The reference Streamlit edition lives at{" "}
            <a href="https://huggingface.co/spaces/consgicody/asos-tools" target="_blank" rel="noopener noreferrer" className="text-noc-cyan hover:text-noc-text">
              huggingface.co/spaces/consgicody/asos-tools
            </a>.
          </p>
        </section>

        <section className="noc-panel">
          <div className="noc-h3 mb-3">Stack</div>
          <ul className="text-sm text-noc-text space-y-1.5">
            <Li label="Frontend">Next.js 16 / React 19 / Tailwind 4 on Azure Container Apps</Li>
            <Li label="Backend">FastAPI + Streamlit on Hugging Face Spaces (Docker SDK)</Li>
            <Li label="Globe">Globe.gl + Three.js (NASA Blue Marble texture)</Li>
            <Li label="Telemetry">Azure Application Insights + Log Analytics</Li>
            <Li label="AI Brief">Azure OpenAI gpt-5-mini (live scan + active SIGMETs)</Li>
            <Li label="Real-time">Azure SignalR Service (Free F1 — wired in follow-on)</Li>
            <Li label="Secrets">Azure Key Vault + Managed Identity</Li>
            <Li label="Data">avwx-engine, stumpy Matrix Profile, pandas / numpy</Li>
          </ul>
        </section>

        <section className="noc-panel">
          <div className="noc-h3 mb-3">Status enum</div>
          <ul className="text-sm space-y-2">
            <StatusRow label="CLEAN"        color="ok"   desc="Reporting on cadence, no $ flag, healthy" />
            <StatusRow label="RECOVERED"    color="info" desc="Returned to clean after a recent flag/missing window" />
            <StatusRow label="INTERMITTENT" color="amber" desc="Mixed reporting — gaps but not silent" />
            <StatusRow label="FLAGGED"      color="warn" desc="$ remark present in latest METAR (sensor-degraded)" />
            <StatusRow label="MISSING"      color="crit" desc="No METAR received within scan window" />
            <StatusRow label="NO DATA"      color="dim"  desc="Awaiting first scan — neutral" />
          </ul>
        </section>

        <section className="noc-panel">
          <div className="noc-h3 mb-3">Authoritative sources</div>
          <ul className="text-sm text-noc-text space-y-1.5">
            <Li label="NCEI">National Centers for Environmental Information — HOMR catalog + 1-min ASOS archive</Li>
            <Li label="IEM">Iowa Environmental Mesonet — METAR mirror with subsetting</Li>
            <Li label="AWC">Aviation Weather Center — METAR / TAF / SIGMET / PIREP</Li>
            <Li label="NWS">api.weather.gov — current conditions + CAP alerts</Li>
            <Li label="FAA">WeatherCams — 926 site cameras, 10-min cadence</Li>
            <Li label="NESDIS">GOES-19 satellite imagery (CONUS + sectors)</Li>
            <Li label="SWPC">NOAA Space Weather Prediction Center — Kp, X-ray, alerts</Li>
            <Li label="NTSB">Aviation accident reports (news ticker only)</Li>
          </ul>
        </section>
      </div>
    </>
  );
}

function Li({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="font-display uppercase tracking-wider text-[0.65rem] text-noc-cyan w-24 shrink-0 mt-0.5">{label}</span>
      <span className="text-noc-text">{children}</span>
    </li>
  );
}

function StatusRow({ label, color, desc }: { label: string; color: "ok" | "warn" | "crit" | "info" | "amber" | "dim"; desc: string }) {
  const tone =
    color === "ok"   ? "var(--color-noc-ok)"
    : color === "warn" ? "var(--color-noc-warn)"
    : color === "crit" ? "var(--color-noc-crit)"
    : color === "info" ? "var(--color-noc-cyan)"
    : color === "amber" ? "var(--color-noc-amber)"
    : "var(--color-noc-dim)";
  return (
    <li className="flex items-baseline gap-3">
      <span className="font-display font-bold uppercase tracking-wider text-[0.7rem] w-28" style={{ color: tone }}>{label}</span>
      <span className="text-noc-text">{desc}</span>
    </li>
  );
}
