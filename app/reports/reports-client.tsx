"use client";

/** Reports client.
 *
 *  Native CSV export plus an evidence-package manifest operators can attach
 *  to station investigations. PDF/DOCX builders remain on the roadmap once
 *  persistent report storage is wired.
 */

import { useState } from "react";
import { Clipboard, Download, ExternalLink, FileDown, FileJson, ShieldCheck } from "lucide-react";

const WINDOWS = [
  { days: 1,  label: "1 day"  },
  { days: 7,  label: "7 day"  },
  { days: 14, label: "14 day" },
  { days: 30, label: "30 day" },
];

export function ReportsClient() {
  const [icao, setIcao] = useState("KJFK");
  const [days, setDays] = useState(7);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  function stationDeepLink(): string {
    return `/stations?focus=${encodeURIComponent(icao)}`;
  }

  function iemCsvUrl(): string {
    return `/api/reports/iem-1min?station=${encodeURIComponent(icao)}&days=${days}`;
  }

  async function downloadCsv() {
    if (!/^[KPT][A-Z0-9]{3,4}$/i.test(icao)) return;
    setDownloading(true);
    try {
      const url = iemCsvUrl();
      const a = document.createElement("a");
      a.href = url;
      a.download = `${icao}-${days}day-1min.csv`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setDownloading(false);
    }
  }

  function stationEvidenceLinks() {
    const id = icao.toUpperCase();
    return {
      iem_1min_csv: iemCsvUrl(),
      station_drill: stationDeepLink(),
      awc_metar: `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(id)}&format=raw&hours=4`,
      awc_taf: `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(id)}&format=raw`,
      nws_latest_observation: `https://api.weather.gov/stations/${encodeURIComponent(id)}/observations/latest`,
      owl_hazards: `/api/station/${encodeURIComponent(id)}/hazards`,
      owl_imagery: `/api/station/${encodeURIComponent(id)}/imagery`,
      noaa_atlas: "/noaa",
      source_registry: "/api/sources",
    };
  }

  function reportMarkdown(): string {
    const id = icao.toUpperCase();
    const links = stationEvidenceLinks();
    return [
      `# OWL Station Evidence Package - ${id}`,
      "",
      `Generated: ${new Date().toISOString()}`,
      `Window: ${days} day${days === 1 ? "" : "s"}`,
      "",
      "## Primary evidence",
      `- IEM/NCEI 1-minute ASOS CSV: ${links.iem_1min_csv}`,
      `- OWL station drill: ${location.origin}${links.station_drill}`,
      `- AWC METAR raw feed: ${links.awc_metar}`,
      `- AWC TAF raw feed: ${links.awc_taf}`,
      `- NWS latest observation endpoint: ${links.nws_latest_observation}`,
      `- OWL hazards API: ${location.origin}${links.owl_hazards}`,
      `- OWL imagery API: ${location.origin}${links.owl_imagery}`,
      "",
      "## Correlation lanes",
      "- FAA WeatherCams, NEXRAD RIDGE, GOES, NASA GIBS, Sentinel/Landsat STAC, USGS earthquakes, NHC storms, NDBC buoys, NOAA CO-OPS, SWPC, and FAA NOTAMs are rendered in the OWL station drill where available.",
      "- Use the NOAA Source Atlas for NWPS, NOMADS, MRMS, NEXRAD NODD, GOES NODD, MADIS, and map-service expansion lanes.",
      "",
      "## Operator notes",
      "- Confirm the raw METAR timestamp and maintenance remark before opening an outage ticket.",
      "- Attach CSV plus any camera/radar/satellite screenshots needed by the receiving operations team.",
    ].join("\n");
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportMarkdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function downloadManifest() {
    const id = icao.toUpperCase();
    const manifest = {
      product: "OWL Station Evidence Package",
      station: id,
      generated_at: new Date().toISOString(),
      window_days: days,
      sources: stationEvidenceLinks(),
      next_level_sources: [
        "NOAA CO-OPS",
        "NOAA NWPS",
        "NOAA NOMADS",
        "NOAA MRMS",
        "NEXRAD on NODD",
        "GOES-R on NODD",
        "NOAA MADIS",
      ],
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}-${days}day-evidence-manifest.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="noc-panel mb-4">
        <div className="noc-h3 mb-3">Build a Report</div>

        <div className="grid md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="noc-label block mb-1">Station ICAO</label>
            <input
              value={icao}
              onChange={(e) => setIcao(e.target.value.toUpperCase())}
              maxLength={5}
              placeholder="KJFK"
              className="
                w-full px-3 py-2 bg-noc-deep border border-noc-border-strong
                text-noc-cyan font-mono text-lg uppercase tracking-wider
                focus:border-noc-cyan focus:outline-none
                focus:shadow-[0_0_0_1px_var(--color-noc-cyan)]
              "
            />
          </div>
          <div>
            <label className="noc-label block mb-1">Window</label>
            <div className="flex gap-1 flex-wrap">
              {WINDOWS.map((w) => (
                <button
                  key={w.days}
                  onClick={() => setDays(w.days)}
                  className={`
                    noc-btn text-[0.7rem] py-1 px-3
                    ${days === w.days ? "noc-btn-primary" : ""}
                  `}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={downloadCsv}
              disabled={downloading}
              className="noc-btn noc-btn-primary flex items-center gap-2 flex-1 justify-center py-2"
            >
              <Download size={14} />
              {downloading ? "Preparing…" : "Download CSV"}
            </button>
          </div>
        </div>

        <div className="text-[0.72rem] text-noc-dim leading-relaxed">
          CSV pulled directly from <a href="https://mesonet.agron.iastate.edu" className="text-noc-cyan hover:text-noc-text" target="_blank" rel="noopener noreferrer">Iowa Environmental Mesonet</a>{" "}
          (NCEI 1-minute archive). Server-side date subsetting; no monthly file downloads.
        </div>
      </div>

      <div className="noc-panel mb-4">
        <div className="noc-h3 mb-3">Visual Reports</div>
        <p className="text-[color:var(--color-fg-muted)] text-sm mb-4 leading-relaxed">
          Annotated time-series, wind roses, KPI strips, and maintenance-flag
          heatmaps render in the Stations drill-panel view. Jump to the
          station directly for the full station dashboard.
        </p>
        <a
          href={stationDeepLink()}
          className="noc-btn flex items-center gap-2 w-fit"
        >
          <ExternalLink size={14} />
          Open {icao} · {days}-day station view
        </a>
      </div>

      <div className="noc-panel mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="noc-h3 mb-1">Evidence Package</div>
            <p className="text-[color:var(--color-fg-muted)] text-sm leading-relaxed max-w-3xl">
              Native report manifest for station investigations. It keeps links to
              authoritative feeds and the OWL drill panel together, so CSV, camera,
              radar, satellite, NOTAM, buoy, and CO-OPS context travel as one packet.
            </p>
          </div>
          <a href="/noaa" className="noc-btn inline-flex items-center gap-2">
            <ShieldCheck size={14} />
            NOAA Atlas
          </a>
        </div>

        <div className="grid md:grid-cols-3 gap-3 mb-4">
          {[
            ["Primary", "IEM/NCEI CSV, latest METAR, NWS observation endpoint"],
            ["Visual", "FAA WeatherCam, NEXRAD RIDGE, GOES, NASA GIBS, STAC imagery"],
            ["Hazards", "USGS quakes, NHC storms, NDBC buoys, NOAA CO-OPS, FAA NOTAMs"],
          ].map(([label, desc]) => (
            <div key={label} className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-bg)] px-3 py-2">
              <div className="noc-label text-[0.6rem] mb-1">{label}</div>
              <div className="text-sm text-[color:var(--color-fg)]">{desc}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={copyReport} className="noc-btn noc-btn-primary inline-flex items-center gap-2">
            <Clipboard size={14} />
            {copied ? "Copied report" : "Copy Markdown"}
          </button>
          <button onClick={downloadManifest} className="noc-btn inline-flex items-center gap-2">
            <FileJson size={14} />
            Download JSON Manifest
          </button>
          <a href={stationDeepLink()} className="noc-btn inline-flex items-center gap-2">
            <ExternalLink size={14} />
            Open Station Drill
          </a>
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-h3 mb-3">Roadmap</div>
        <ul className="space-y-1.5 text-sm text-noc-text">
          <li className="flex gap-2">
            <span className="text-noc-cyan font-mono shrink-0">01.</span>
            <span>Native PDF generation via <code className="text-noc-cyan">@react-pdf/renderer</code> — same panels as the matplotlib version, vector output.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-noc-cyan font-mono shrink-0">02.</span>
            <span>Multi-station comparison reports (pick up to 8 ICAOs, side-by-side flight-category timelines).</span>
          </li>
          <li className="flex gap-2">
            <span className="text-noc-cyan font-mono shrink-0">03.</span>
            <span>Maintenance incident DOCX — auto-fills the standard NWS sensor-out form with START / END / SENSOR fields decoded from the METAR <code className="text-noc-cyan">$</code> remark.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-noc-cyan font-mono shrink-0">04.</span>
            <span>Persistent report archive in Azure Blob Storage with content-hash URLs.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-noc-cyan font-mono shrink-0">05.</span>
            <span>Email delivery via Azure Communication Services to a per-role distribution list.</span>
          </li>
        </ul>
      </div>

      <div className="mt-4 text-[0.7rem] text-[color:var(--color-fg-dim)]">
        <FileDown size={11} className="inline" /> Reports archive: not yet wired
      </div>
    </>
  );
}
