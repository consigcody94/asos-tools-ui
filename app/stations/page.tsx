import { OpsBanner } from "@/components/ops-banner";
import { StationsTable } from "./stations-table";
import { STATIONS } from "@/lib/data/stations";

export const metadata = { title: "Stations — O.W.L." };

/** Stations directory.  Server component renders the chrome and hands
 *  the (already-baked) catalog down to a client component for the
 *  interactive table.  The catalog is ~130 KB JSON, baked at build,
 *  so first paint shows it immediately with no API round-trip. */
export default function StationsPage() {
  // Light per-state aggregate for the header strip.
  const totalByState = STATIONS.reduce<Record<string, number>>((acc, s) => {
    if (s.state) acc[s.state] = (acc[s.state] ?? 0) + 1;
    return acc;
  }, {});
  const totalByOperator = STATIONS.reduce<Record<string, number>>((acc, s) => {
    acc[s.operator] = (acc[s.operator] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <OpsBanner status="operational" nodesActive={STATIONS.length} nodesTotal={STATIONS.length} />

      <header className="mb-4">
        <h1 className="font-display text-4xl font-bold tracking-tight text-noc-text">
          STATIONS
        </h1>
        <p className="noc-label mt-1">
          AOMC ASOS Catalog &middot; {STATIONS.length} K / P / T Sites
        </p>
      </header>

      {/* Operator + state aggregate strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
        {Object.entries(totalByOperator)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([op, n]) => (
            <div
              key={op}
              className="noc-panel py-3 px-4"
              style={{ "--noc-light": "var(--color-noc-cyan)" } as React.CSSProperties}
            >
              <div className="noc-label text-[0.62rem] mb-1">{op}</div>
              <div className="font-mono text-xl text-noc-cyan tabular-nums">
                {n}
              </div>
            </div>
          ))}
        <div className="noc-panel py-3 px-4">
          <div className="noc-label text-[0.62rem] mb-1">States</div>
          <div className="font-mono text-xl text-noc-cyan tabular-nums">
            {Object.keys(totalByState).length}
          </div>
        </div>
        <div className="noc-panel py-3 px-4">
          <div className="noc-label text-[0.62rem] mb-1">Total</div>
          <div className="font-mono text-xl text-noc-cyan tabular-nums">
            {STATIONS.length}
          </div>
        </div>
      </section>

      <StationsTable stations={STATIONS} />
    </>
  );
}
