/** Common chrome for every tab page — title block + roadmap panel.
 *
 *  Used by the in-progress tabs (AOMC, Forecasters, Reports, Stations,
 *  Admin) so they render the full NOC look while their real
 *  functionality is being built.  Each stub passes its own roadmap
 *  bullets via `whatLands`.
 */

import { OpsBanner } from "@/components/ops-banner";

interface Props {
  title: string;
  subtitle: string;
  whoLine: string;
  whatLands: string[];
  status?: "construction" | "preview";
  /** Optional inline detail block rendered inside the roadmap panel. */
  children?: React.ReactNode;
}

export function TabShell({
  title,
  subtitle,
  whoLine,
  whatLands,
  status = "construction",
  children,
}: Props) {
  return (
    <>
      <OpsBanner status="operational" nodesActive={920} nodesTotal={920} />

      <header className="mb-6">
        <h1 className="font-display text-4xl font-bold tracking-tight text-noc-text">
          {title.toUpperCase()}
        </h1>
        <p className="noc-label mt-1">{subtitle}</p>
      </header>

      <div className="noc-panel">
        <div className="flex items-center gap-3 mb-3">
          <span
            className={
              status === "construction"
                ? "noc-light noc-light-warn"
                : "noc-light noc-light-ok"
            }
          />
          <span className="noc-label text-[0.72rem]">
            {status === "construction"
              ? "MODULE UNDER CONSTRUCTION"
              : "PREVIEW BUILD"}
          </span>
        </div>

        <p className="text-noc-muted text-sm mb-5 leading-relaxed">
          {whoLine}
        </p>

        <div className="noc-h3 mb-2">Roadmap</div>
        <ul className="space-y-1.5 mb-5 text-sm text-noc-text">
          {whatLands.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-noc-cyan font-mono shrink-0">
                {String(i + 1).padStart(2, "0")}.
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {children}

        <div className="mt-5 pt-4 border-t border-noc-border">
          <div className="noc-label text-[0.65rem] mb-1">Tracking</div>
          <p className="text-noc-dim text-xs leading-relaxed">
            This module&apos;s reference implementation is live on the
            Streamlit edition at{" "}
            <a
              href="https://huggingface.co/spaces/consgicody/asos-tools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-noc-cyan hover:text-noc-text"
            >
              consgicody/asos-tools
            </a>
            . The Azure build ports the same data surfaces with real-time
            SignalR push, Application Insights, and Microsoft Entra ID SSO.
          </p>
        </div>
      </div>
    </>
  );
}
