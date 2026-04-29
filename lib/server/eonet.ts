/** NASA EONET v3 natural event feed.
 *
 *  EONET is a curated near-real-time event stream for natural hazards such as
 *  wildfires, severe storms, volcanoes, sea/lake ice, floods, and dust storms.
 *  OWL uses it as a global command-center feed alongside ASOS/NWS/NOAA data.
 */

import { fetchJson } from "./fetcher";

const EONET_BASE = "https://eonet.gsfc.nasa.gov/api/v3";

interface EonetRaw {
  id: string;
  title: string;
  description?: string | null;
  link?: string;
  closed?: string | null;
  categories?: Array<{ id: string; title: string }>;
  sources?: Array<{ id: string; url: string }>;
  geometry?: Array<{
    magnitudeValue?: number | null;
    magnitudeUnit?: string | null;
    date?: string;
    type?: string;
    coordinates?: unknown;
  }>;
}

type EonetGeometry = NonNullable<EonetRaw["geometry"]>[number];

interface EonetResponse {
  title?: string;
  description?: string;
  link?: string;
  events?: EonetRaw[];
}

export interface EonetEvent {
  id: string;
  title: string;
  status: "open" | "closed";
  category: string;
  category_id: string;
  updated_at: string | null;
  magnitude: string | null;
  lon: number | null;
  lat: number | null;
  source: string | null;
  source_url: string | null;
  eonet_url: string;
}

function newestGeometry(event: EonetRaw): EonetGeometry | null {
  const geoms = event.geometry ?? [];
  if (geoms.length === 0) return null;
  return [...geoms].sort((a, b) => Date.parse(b.date ?? "") - Date.parse(a.date ?? ""))[0] ?? null;
}

function pointFromCoordinates(coords: unknown): { lon: number | null; lat: number | null } {
  if (!Array.isArray(coords)) return { lon: null, lat: null };
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    return { lon: coords[0], lat: coords[1] };
  }
  // Polygon/MultiPolygon fallback: find the first coordinate pair.
  const stack = [...coords] as unknown[];
  while (stack.length) {
    const item = stack.shift();
    if (Array.isArray(item) && typeof item[0] === "number" && typeof item[1] === "number") {
      return { lon: item[0], lat: item[1] };
    }
    if (Array.isArray(item)) stack.unshift(...item);
  }
  return { lon: null, lat: null };
}

function normalise(event: EonetRaw): EonetEvent {
  const geom = newestGeometry(event);
  const cat = event.categories?.[0];
  const source = event.sources?.[0];
  const point = pointFromCoordinates(geom?.coordinates);
  const mag =
    geom?.magnitudeValue != null
      ? `${geom.magnitudeValue.toLocaleString()}${geom.magnitudeUnit ? ` ${geom.magnitudeUnit}` : ""}`
      : null;

  return {
    id: event.id,
    title: event.title,
    status: event.closed ? "closed" : "open",
    category: cat?.title ?? "Uncategorized",
    category_id: cat?.id ?? "unknown",
    updated_at: geom?.date ?? null,
    magnitude: mag,
    lon: point.lon,
    lat: point.lat,
    source: source?.id ?? null,
    source_url: source?.url ?? null,
    eonet_url: event.link ?? `${EONET_BASE}/events/${encodeURIComponent(event.id)}`,
  };
}

export async function eonetEvents(opts: {
  status?: "open" | "closed" | "all";
  limit?: number;
  days?: number;
  category?: string;
} = {}): Promise<EonetEvent[]> {
  const { status = "open", limit = 30, days = 20, category } = opts;
  const query: Record<string, string> = {
    status,
    limit: String(Math.min(Math.max(limit, 1), 100)),
    days: String(Math.min(Math.max(days, 1), 365)),
  };
  if (category) query.category = category;

  const data = await fetchJson<EonetResponse>(`${EONET_BASE}/events`, {
    query,
    timeoutMs: 15_000,
    retries: 2,
  });

  return (data?.events ?? [])
    .map(normalise)
    .sort((a, b) => Date.parse(b.updated_at ?? "") - Date.parse(a.updated_at ?? ""));
}
