import { OpsBanner } from "@/components/ops-banner";
import { AomcDashboard } from "./aomc-dashboard";
import { STATIONS } from "@/lib/data/stations";
import { OWL_API_BASE } from "@/lib/api";

export const metadata = { title: "AOMC Controllers — O.W.L." };
export const revalidate = 30;

interface ScanRow {
  station: string;
  status?: string;
  minutes_since_last_report?: number | null;
  probable_reason?: string | null;
  latest_metar?: string | null;
}

async function getScanRows(): Promise<ScanRow[]> {
  try {
    const r = await fetch(`${OWL_API_BASE}/api/scan-results`, {
      next: { revalidate: 30 },
    });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.rows as ScanRow[]) || [];
  } catch {
    return [];
  }
}

export default async function AomcPage() {
  const rows = await getScanRows();

  // Build per-operator rollup.
  type Row = { operator: string; total: number; clean: number; flagged: number; missing: number; intermittent: number; recovered: number; noData: number };
  const byOp = new Map<string, Row>();
  const statusByStation = new Map<string, string>();
  for (const r of rows) {
    if (r.station) statusByStation.set(r.station, (r.status || "NO DATA").toUpperCase());
  }
  for (const s of STATIONS) {
    let row = byOp.get(s.operator);
    if (!row) {
      row = { operator: s.operator, total: 0, clean: 0, flagged: 0, missing: 0, intermittent: 0, recovered: 0, noData: 0 };
      byOp.set(s.operator, row);
    }
    row.total++;
    const st = statusByStation.get(s.id) || "NO DATA";
    if (st === "CLEAN") row.clean++;
    else if (st === "FLAGGED") row.flagged++;
    else if (st === "MISSING") row.missing++;
    else if (st === "INTERMITTENT") row.intermittent++;
    else if (st === "RECOVERED") row.recovered++;
    else row.noData++;
  }
  const opRollup = Array.from(byOp.values()).sort((a, b) => b.total - a.total);

  return (
    <>
      <OpsBanner status="operational" nodesActive={STATIONS.length} nodesTotal={STATIONS.length} />

      <header className="mb-6">
        <h1 className="font-display text-4xl font-bold tracking-tight text-noc-text">
          AOMC CONTROLLERS
        </h1>
        <p className="noc-label mt-1">
          ASOS Operations &amp; Monitoring Center &middot; Per-Operator Triage
        </p>
      </header>

      <AomcDashboard rollup={opRollup} rows={rows} stations={STATIONS} />
    </>
  );
}
