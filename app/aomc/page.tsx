import { OpsBanner } from "@/components/ops-banner";
import { AomcDashboard } from "./aomc-dashboard";
import { STATIONS } from "@/lib/data/stations";
import { OWL_API_BASE } from "@/lib/api";
import { operatorBucket } from "@/lib/data/operator-display";

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
    // Aggregate by display name so "—" / NWS / NOAA all collapse to
    // the single "NOAA/SUAD" row — operators expect one bucket per
    // operating organization, not three split bins.
    const opKey = operatorBucket(s.operator);
    let row = byOp.get(opKey);
    if (!row) {
      row = { operator: opKey, total: 0, clean: 0, flagged: 0, missing: 0, intermittent: 0, recovered: 0, noData: 0 };
      byOp.set(opKey, row);
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
        <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--color-fg)]">
          AOMC Controllers
        </h1>
        <p className="text-[color:var(--color-fg-muted)] mt-1 text-sm leading-relaxed max-w-3xl">
          Live <span className="font-mono text-[color:var(--color-warn)]">$</span>-flag stream
          for ASOS network diagnosis. Each station self-reports a maintenance
          anomaly; OWL decodes the METAR remarks
          (<span className="font-mono">TSNO</span>,
          <span className="font-mono"> PWINO</span>,
          <span className="font-mono"> FZRANO</span>,
          <span className="font-mono"> SLPNO</span>,
          <span className="font-mono"> VISNO</span>,
          <span className="font-mono"> CHINO</span>,
          <span className="font-mono"> RVRNO</span>) so you know which
          sensor before dialing in. No claim, no draft, no workflow — every
          row is everything OWL knows about that station, the moment it knows it,
          updating in real time as new METARs arrive.
        </p>
      </header>

      <AomcDashboard rollup={opRollup} rows={rows} stations={STATIONS} />
    </>
  );
}
