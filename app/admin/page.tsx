import { OpsBanner } from "@/components/ops-banner";
import { AdminDashboard } from "./admin-dashboard";
import { OWL_API_BASE, getHealth } from "@/lib/api";

export const metadata = { title: "Admin — O.W.L." };
export const revalidate = 15;

interface SourceRecord {
  id?: string;
  name?: string;
  url?: string;
  trust?: string;
  notes?: string;
  refresh?: string;
  [k: string]: unknown;
}

async function getSources(): Promise<SourceRecord[]> {
  try {
    const r = await fetch(`${OWL_API_BASE}/api/sources`, {
      next: { revalidate: 3600 },
    });
    if (!r.ok) return [];
    const d = await r.json();
    if (Array.isArray(d.sources)) return d.sources;
    if (Array.isArray(d)) return d;
    return [];
  } catch {
    return [];
  }
}

export default async function AdminPage() {
  const [health, sources] = await Promise.all([
    getHealth().catch(() => null),
    getSources(),
  ]);

  return (
    <>
      <OpsBanner status="operational" nodesActive={918} nodesTotal={918} />

      <header className="mb-6">
        <h1 className="font-display text-4xl font-bold tracking-tight text-noc-text">
          ADMIN
        </h1>
        <p className="noc-label mt-1">
          Operator Console &middot; Scheduler &middot; Sources &middot; Audit
        </p>
      </header>

      <AdminDashboard health={health} sources={sources} />
    </>
  );
}
