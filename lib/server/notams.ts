/** FAA NOTAM API client — key-gated, graceful fallback. */

const UA = "owl-ui/2.0 (asos-tools-ui)";
const BASE = "https://external-api.faa.gov/notamapi/v1/notams";

export function isConfigured(): boolean {
  return Boolean(process.env.FAA_NOTAM_CLIENT_ID && process.env.FAA_NOTAM_CLIENT_SECRET);
}

export interface Notam {
  id: string;
  number: string;
  type: string;
  icao: string;
  location: string;
  effective_start: string;
  effective_end: string;
  classification: string;
  text: string;
}

export async function fetchNotamsForIcao(icao: string): Promise<Notam[]> {
  if (!isConfigured() || !icao) return [];
  const up = icao.trim().toUpperCase();
  const params = new URLSearchParams({
    icaoLocation: up, responseFormat: "geoJson", pageSize: "50",
  });
  try {
    const r = await fetch(`${BASE}?${params.toString()}`, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        client_id: process.env.FAA_NOTAM_CLIENT_ID!,
        client_secret: process.env.FAA_NOTAM_CLIENT_SECRET!,
      },
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 600 },
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { items?: Array<{ properties?: { coreNOTAMData?: { notam?: Record<string, unknown> } } }> };
    const items = data?.items || [];
    return items.map((it) => {
      const core = (it.properties?.coreNOTAMData?.notam || {}) as Record<string, unknown>;
      return {
        id:              String(core.id || ""),
        number:          String(core.number || ""),
        type:            String(core.type || ""),
        icao:            String(core.icaoLocation || up),
        location:        String(core.location || ""),
        effective_start: String(core.effectiveStart || ""),
        effective_end:   String(core.effectiveEnd || ""),
        classification:  String(core.classification || ""),
        text:            String(core.text || ""),
      };
    });
  } catch { return []; }
}

export interface NotamSummary {
  configured: boolean;
  icao: string;
  count: number;
  equipment_out: number;
  asos_related: number;
  items: Notam[];
}

export async function summarizeForDrill(icao: string): Promise<NotamSummary> {
  const up = (icao || "").trim().toUpperCase();
  if (!isConfigured()) {
    return { configured: false, icao: up, count: 0, equipment_out: 0, asos_related: 0, items: [] };
  }
  const rows = await fetchNotamsForIcao(up);
  let eq = 0, asos = 0;
  for (const r of rows) {
    const txt = (r.text || "").toUpperCase();
    if (["U/S", "UNSERV", "OUT OF SERVICE", "OTS"].some((t) => txt.includes(t))) eq++;
    if (["ASOS", "AWOS", "WEATHER OBS", "WX OBS"].some((t) => txt.includes(t))) asos++;
  }
  return {
    configured: true, icao: up, count: rows.length,
    equipment_out: eq, asos_related: asos,
    items: rows.slice(0, 5),
  };
}
