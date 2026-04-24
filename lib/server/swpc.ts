/** NOAA SWPC — Kp index + X-ray flux + active alerts. */

const UA = "owl-ui/2.0 (asos-tools-ui)";

interface KpRow { time_tag: string; kp_index: number; }
interface XrayRow { time_tag: string; flux: number; energy: string; }

async function j<T>(url: string, revalidate = 300): Promise<T | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

export interface SpaceWeatherSummary {
  kp: { time: string; value: number } | null;
  xray: { time: string; class: string } | null;
  alerts: Array<{ message: string; issued: string; product_id: string }>;
}

function xrayClass(flux: number): string {
  if (flux >= 1e-4) return "X" + (flux / 1e-4).toFixed(1);
  if (flux >= 1e-5) return "M" + (flux / 1e-5).toFixed(1);
  if (flux >= 1e-6) return "C" + (flux / 1e-6).toFixed(1);
  if (flux >= 1e-7) return "B" + (flux / 1e-7).toFixed(1);
  return "A" + (flux / 1e-8).toFixed(1);
}

export async function spaceWeatherSummary(): Promise<SpaceWeatherSummary> {
  const [kpRows, xrayRows, alerts] = await Promise.all([
    j<KpRow[]>("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", 900),
    j<XrayRow[]>("https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json", 300),
    j<Array<{ message?: string; issue_datetime?: string; product_id?: string }>>(
      "https://services.swpc.noaa.gov/products/alerts.json", 600),
  ]);

  let kp: { time: string; value: number } | null = null;
  if (Array.isArray(kpRows) && kpRows.length) {
    // SWPC returns newest-last with a header row. Find the last numeric row.
    for (let i = kpRows.length - 1; i >= 0; i--) {
      const r = kpRows[i];
      const v = parseFloat(String(r.kp_index));
      if (Number.isFinite(v)) { kp = { time: String(r.time_tag), value: v }; break; }
    }
  }

  let xray: { time: string; class: string } | null = null;
  if (Array.isArray(xrayRows) && xrayRows.length) {
    const latest = xrayRows.filter((r) => r.energy?.includes("0.1-0.8"))
      .sort((a, b) => (a.time_tag < b.time_tag ? 1 : -1))[0] ?? xrayRows[xrayRows.length - 1];
    if (latest) xray = { time: latest.time_tag, class: xrayClass(latest.flux) };
  }

  return {
    kp,
    xray,
    alerts: (alerts || []).slice(0, 8).map((a) => ({
      message: (a.message || "").slice(0, 400),
      issued: a.issue_datetime || "",
      product_id: a.product_id || "",
    })),
  };
}
