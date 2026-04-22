import { OpsBanner } from "@/components/ops-banner";
import { ForecastersDashboard } from "./forecasters-dashboard";
import { STATIONS } from "@/lib/data/stations";

export const metadata = { title: "NWS Forecasters — O.W.L." };
export const dynamic = "force-dynamic";   // depends on live AWC; no prerender
export const revalidate = 120;

interface AirSigmet {
  airSigmetId?: number;
  airSigmetType?: string;
  rawAirSigmet?: string;
  hazard?: string;
  severity?: string;
  validTimeFrom?: string;
  validTimeTo?: string;
  altitudeLow1?: number;
  altitudeHi1?: number;
}

interface Pirep {
  receiptTime?: string;
  obsTime?: string;
  rawOb?: string;
  acType?: string;
  fltlvl?: number;
  lat?: number;
  lon?: number;
}

// Defensive parse: AWC sometimes returns `[]`, sometimes `{features: []}`,
// sometimes a stringified JSON inside the body if we hit an edge cache
// during a redeploy.  Coerce everything to an array of objects, drop
// anything that isn't a plain object.
function coerceArray<T>(d: unknown): T[] {
  if (Array.isArray(d)) return d.filter((x) => x && typeof x === "object") as T[];
  if (d && typeof d === "object") {
    const obj = d as Record<string, unknown>;
    for (const k of ["data", "features", "items", "rows", "results"]) {
      if (Array.isArray(obj[k])) {
        return (obj[k] as unknown[]).filter((x) => x && typeof x === "object") as T[];
      }
    }
  }
  return [];
}

async function getAirsigmets(): Promise<AirSigmet[]> {
  try {
    // AWC Aviation Weather Center direct, no auth, JSON.
    const r = await fetch(
      "https://aviationweather.gov/api/data/airsigmet?format=json",
      { next: { revalidate: 120 }, signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return [];
    return coerceArray<AirSigmet>(await r.json());
  } catch {
    return [];
  }
}

async function getPireps(): Promise<Pirep[]> {
  try {
    const r = await fetch(
      "https://aviationweather.gov/api/data/pirep?format=json&age=2",
      { next: { revalidate: 300 }, signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return [];
    return coerceArray<Pirep>(await r.json());
  } catch {
    return [];
  }
}

export default async function ForecastersPage() {
  const [sigmets, pireps] = await Promise.all([getAirsigmets(), getPireps()]);

  return (
    <>
      <OpsBanner status="operational" nodesActive={STATIONS.length} nodesTotal={STATIONS.length} />

      <header className="mb-6">
        <h1 className="font-display text-4xl font-bold tracking-tight text-noc-text">
          NWS FORECASTERS
        </h1>
        <p className="noc-label mt-1">
          Aviation Weather Workstation &middot; METAR / TAF / SIGMET / PIREP
        </p>
      </header>

      <ForecastersDashboard sigmets={sigmets} pireps={pireps} stations={STATIONS} />
    </>
  );
}
