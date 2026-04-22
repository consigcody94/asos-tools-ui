import { OpsBanner } from "@/components/ops-banner";
import { ReportsClient } from "./reports-client";

export const metadata = { title: "Reports — O.W.L." };

export default function ReportsPage() {
  return (
    <>
      <OpsBanner status="operational" nodesActive={918} nodesTotal={918} />

      <header className="mb-6">
        <h1 className="font-display text-4xl font-bold tracking-tight text-noc-text">
          REPORTS
        </h1>
        <p className="noc-label mt-1">
          On-Demand Station Dashboards &middot; PDF / PNG / CSV
        </p>
      </header>

      <ReportsClient />
    </>
  );
}
