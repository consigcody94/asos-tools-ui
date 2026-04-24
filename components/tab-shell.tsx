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
        <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--color-fg)]">
          {title}
        </h1>
        <p className="text-[color:var(--color-fg-muted)] mt-1 text-sm">{subtitle}</p>
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

        <div className="mt-5 pt-4 border-t border-[color:var(--color-border)]">
          <div className="noc-label text-[0.62rem] mb-1">Tracking</div>
          <p className="text-[color:var(--color-fg-dim)] text-xs leading-relaxed">
            Self-hosted build — all data sources are served directly by this
            app via <code>lib/server/*</code> + <code>/api/*</code> routes.
          </p>
        </div>
      </div>
    </>
  );
}
