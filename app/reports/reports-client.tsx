"use client";

/** Reports — minimal browser-side client.
 *
 *  The full PNG/PDF report builders live in the Streamlit edition
 *  (matplotlib renders + a ZIP exporter).  Until the @react-pdf/renderer
 *  port lands, this client offers two paths:
 *
 *    1. CSV download for a station's last 1/7/14/30-day 1-min data,
 *       streamed directly from IEM (no backend hop).
 *    2. A "Preview in Streamlit" deep-link into the HF Space's Reports
 *       tab with the chosen ICAO + window pre-selected.
 */

import { useState } from "react";
import { Download, ExternalLink, FileDown } from "lucide-react";

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

  function stationDeepLink(): string {
    return `/stations?focus=${encodeURIComponent(icao)}`;
  }

  function iemCsvUrl(): string {
    // IEM 1-minute ASOS download.  Window is server-relative so we
    // compute end-of-day UTC, walk back N days.
    const end = new Date();
    end.setUTCHours(23, 59, 0, 0);
    const start = new Date(end.getTime() - days * 86400_000);
    const fmt = (d: Date) =>
      `year1=${d.getUTCFullYear()}&month1=${d.getUTCMonth() + 1}` +
      `&day1=${d.getUTCDate()}&hour1=${d.getUTCHours()}&minute1=${d.getUTCMinutes()}`;
    const fmt2 = (d: Date) =>
      `year2=${d.getUTCFullYear()}&month2=${d.getUTCMonth() + 1}` +
      `&day2=${d.getUTCDate()}&hour2=${d.getUTCHours()}&minute2=${d.getUTCMinutes()}`;
    return (
      "https://mesonet.agron.iastate.edu/cgi-bin/request/asos1min.py?" +
      `station=${encodeURIComponent(icao)}` +
      "&vars=tmpf&vars=dwpf&vars=sknt&vars=drct&vars=gust&vars=alti&vars=mslp&vars=p01i&vars=vsby" +
      "&sample=1min&what=download&delim=comma&" +
      fmt(start) + "&" + fmt2(end)
    );
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
