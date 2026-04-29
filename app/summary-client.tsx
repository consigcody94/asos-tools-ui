"use client";

/** Client half of the Summary page — owns the interactive globe + drill
 *  panel + region presets.  Renders the full 918-station catalog at all
 *  times; status colors come from a periodic poll of the OWL API.
 *
 *  When SignalR is wired (Phase 3) the poll is replaced with a
 *  real-time push subscription and points re-color without a request.
 */

import { useEffect, useMemo, useState } from "react";
import { Globe, type GlobePath, type GlobePoint } from "@/components/globe";
import { DrillPanel } from "@/components/drill-panel";
import { ExternalLink, Flame, Map, Orbit, Play, RotateCcw, Satellite, Waves } from "lucide-react";
import { STATIONS } from "@/lib/data/stations";

const REGIONS = [
  { id: "conus",  label: "CONUS",     lat: 38,    lng: -97,   alt: 2.3 },
  { id: "ne",     label: "Northeast", lat: 42,    lng: -72,   alt: 1.1 },
  { id: "se",     label: "Southeast", lat: 32,    lng: -84,   alt: 1.1 },
  { id: "ctrl",   label: "Central",   lat: 41,    lng: -93,   alt: 1.1 },
  { id: "west",   label: "West",      lat: 38,    lng: -110,  alt: 1.1 },
  { id: "ak",     label: "Alaska",    lat: 64,    lng: -150,  alt: 1.0 },
  { id: "hi",     label: "Hawaii",    lat: 20.7,  lng: -157,  alt: 0.7 },
  { id: "carib",  label: "Caribbean", lat: 18,    lng: -66,   alt: 0.7 },
];

// Status -> (color, point size) for the globe rendering.
// Colours align with the global theme tokens — muted, not neon.
const STATUS_VIZ: Record<string, { color: string; size: number }> = {
  CLEAN:        { color: "#3fb27f", size: 0.30 },
  RECOVERED:    { color: "#5fa8e6", size: 0.35 },
  INTERMITTENT: { color: "#c48828", size: 0.40 },
  FLAGGED:      { color: "#e0a73a", size: 0.50 },
  MISSING:      { color: "#e25c6b", size: 0.60 },
  "NO DATA":    { color: "#5f6f8f", size: 0.30 },
};
const DEFAULT_VIZ = STATUS_VIZ.CLEAN;

interface ScanRow {
  station: string;
  status?: string;
  name?: string;
  state?: string;
  lat?: number;
  lon?: number;
  minutes_since_last_report?: number | null;
  last_metar?: string | null;
  last_valid?: string | null;
  probable_reason?: string | null;
}

interface EonetEvent {
  id: string;
  title: string;
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

interface LiveSatellite {
  id: string;
  name: string;
  norad_id: number;
  group: "stations" | "weather" | "resource";
  mission: string;
  epoch: string;
  lat: number;
  lon: number;
  altitude_km: number;
  velocity_km_s: number | null;
  inclination_deg: number;
  period_min: number;
  visual_altitude: number;
  updated_at: string;
  imagery_url: string | null;
  public_url: string;
  track: { lat: number; lon: number; alt_km: number; at: string }[];
}

type IntelSelection =
  | { kind: "event"; event: EonetEvent }
  | { kind: "satellite"; satellite: LiveSatellite }
  | null;

const SATELLITE_COLOR = {
  stations: "#f8fafc",
  weather: "#4da3ff",
  resource: "#3fb27f",
} as const;

// Direct embeddable URL for the live feed of a satellite.
//   - GOES east/west: NESDIS GeoColor GIF (already direct CDN; refreshes ~10 min)
//   - VIIRS / MODIS polar sats: NASA GIBS WMS GetMap centered on the current
//     sub-point. No auth, public, returns today's swath imagery.
//   - Anything else (ISS, Landsat, Sentinel): null — we render a position-only
//     panel and link out as a secondary action.
function satelliteLiveImage(
  sat: LiveSatellite,
): { url: string; caption: string; layer?: string } | null {
  if (sat.id === "goes-19" && sat.imagery_url) {
    return { url: sat.imagery_url, caption: "NOAA GOES-19 GeoColor (CONUS)" };
  }
  if (sat.id === "goes-18" && sat.imagery_url) {
    return { url: sat.imagery_url, caption: "NOAA GOES-18 GeoColor (Full Disk)" };
  }
  const gibsLayer: Record<string, string> = {
    terra: "MODIS_Terra_CorrectedReflectance_TrueColor",
    aqua: "MODIS_Aqua_CorrectedReflectance_TrueColor",
    "suomi-npp": "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    "noaa-20-jpss-1": "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
    "noaa-21-jpss-2": "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
  };
  const layer = gibsLayer[sat.id];
  if (!layer) return null;
  // 30 deg half-window around the sub-point. NASA GIBS yesterday is most
  // reliable because today's swath isn't always processed yet.
  const day = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  const half = 30;
  const minLat = Math.max(-90, sat.lat - half);
  const maxLat = Math.min(90, sat.lat + half);
  let minLon = sat.lon - half;
  let maxLon = sat.lon + half;
  if (minLon < -180) minLon += 360;
  if (maxLon > 180) maxLon -= 360;
  const bbox = `${minLat.toFixed(2)},${minLon.toFixed(2)},${maxLat.toFixed(2)},${maxLon.toFixed(2)}`;
  const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&FORMAT=image/jpeg&SRS=EPSG:4326&WIDTH=720&HEIGHT=540&BBOX=${bbox}&TIME=${day}`;
  return { url, caption: `NASA GIBS · ${layer.replace(/_/g, " ")} · ${day}`, layer };
}

function eventColor(event: EonetEvent): string {
  if (event.category_id.includes("wild")) return "#e0a73a";
  if (event.category_id.includes("storm") || event.category_id.includes("flood")) return "#5fa8e6";
  if (event.category_id.includes("volcano")) return "#e25c6b";
  return "#98a4bd";
}

function stationSpread(id: string, lat: number): { lat: number; lng: number } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const angle = (hash % 360) * Math.PI / 180;
  const radius = 0.08 + ((hash >>> 8) % 8) * 0.012;
  const lngScale = Math.max(0.35, Math.cos(Math.abs(lat) * Math.PI / 180));
  return {
    lat: Math.sin(angle) * radius,
    lng: Math.cos(angle) * radius / lngScale,
  };
}

export function SummaryClient() {
  const [autoRotate, setAutoRotate] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lng: number; alt?: number } | null>(null);
  const [station, setStation] = useState<{
    id: string;
    lat: number;
    lng: number;
    name?: string;
    state?: string;
    status?: string;
    minutesSinceLast?: number | null;
    lastMetar?: string | null;
    lastValid?: string | null;
    probableReason?: string | null;
  } | null>(null);
  const [statusByStation, setStatusByStation] = useState<Record<string, string>>({});
  const [scanByStation, setScanByStation] = useState<Record<string, ScanRow>>({});
  const [events, setEvents] = useState<EonetEvent[]>([]);
  const [satellites, setSatellites] = useState<LiveSatellite[]>([]);
  const [showStations, setShowStations] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showSatellites, setShowSatellites] = useState(true);
  const [intel, setIntel] = useState<IntelSelection>(null);

  // Prefer the Proxmox SSE stream for scan updates. Fallback to polling
  // if EventSource is unavailable or the stream drops.
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    let es: EventSource | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    function applyRows(rows?: ScanRow[]) {
      if (cancelled) return;
      if (!rows) {
        setStatusByStation((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        setScanByStation((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }
      const next: Record<string, string> = {};
      const scanRows: Record<string, ScanRow> = {};
      for (const r of rows) {
        if (r.station) {
          next[r.station] = (r.status || "NO DATA").toUpperCase();
          scanRows[r.station] = r;
        }
      }
      // Skip state updates when statuses are identical to avoid re-rendering
      // 918 globe points and the legend on every poll.
      setStatusByStation((prev) => {
        const prevKeys = Object.keys(prev);
        if (prevKeys.length === Object.keys(next).length) {
          let same = true;
          for (const k of prevKeys) {
            if (prev[k] !== next[k]) { same = false; break; }
          }
          if (same) return prev;
        }
        return next;
      });
      setScanByStation(scanRows);
    }

    async function refresh() {
      try {
        const res = await fetch(`/api/scan-results`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data: { rows?: ScanRow[] } = await res.json();
        applyRows(data.rows);
      } catch {
        /* ignore — globe keeps rendering with last-known statuses */
      }
    }

    if ("EventSource" in window) {
      es = new EventSource("/api/events");
      es.addEventListener("scan", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as { rows?: ScanRow[] };
          applyRows(data.rows);
        } catch { /* ignore malformed event */ }
      });
      es.onerror = () => {
        es?.close();
        es = null;
        refresh();
        interval = setInterval(refresh, 60_000);
      };
    } else {
      refresh();
      interval = setInterval(refresh, 60_000);
    }

    return () => {
      cancelled = true;
      es?.close();
      if (interval) clearInterval(interval);
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;

    async function refresh() {
      try {
        const [eventRes, satRes] = await Promise.all([
          fetch("/api/eonet/events?status=open&days=30&limit=18", { signal: ctrl.signal }),
          fetch("/api/satellites/live", { signal: ctrl.signal }),
        ]);
        if (!cancelled && eventRes.ok) {
          const data: { events?: EonetEvent[] } = await eventRes.json();
          setEvents((data.events ?? []).filter((e) => e.lat != null && e.lon != null));
        }
        if (!cancelled && satRes.ok) {
          const data: { satellites?: LiveSatellite[] } = await satRes.json();
          setSatellites(data.satellites ?? []);
        }
      } catch {
        /* keep last-known command-center layers */
      }
    }

    refresh();
    const id = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      ctrl.abort();
    };
  }, []);

  // Derive globe points from station status. Decoupled from scanByStation
  // so the array only rebuilds when a status actually changes (not on every
  // identical poll).
  const stationPoints: GlobePoint[] = useMemo(() => {
    return STATIONS.map((s) => {
      const status = (statusByStation[s.id] || "NO DATA").toUpperCase();
      const viz = STATUS_VIZ[status] || DEFAULT_VIZ;
      const shortName = s.name.length > 24 ? s.name.slice(0, 22) + "…" : s.name;
      const spread = stationSpread(s.id, s.lat);
      return {
        kind: "station",
        station: s.id,
        lat: s.lat + spread.lat,
        lng: s.lon + spread.lng,
        altitude: 0.012,
        color: viz.color,
        size: Math.max(0.42, viz.size),
        label: `${shortName} · ${s.state} · ${status}`,
      };
    });
  }, [statusByStation]);

  const eventPoints: GlobePoint[] = useMemo(() => {
    return events.map((event) => ({
      kind: "event",
      station: `EONET:${event.id}`,
      lat: event.lat ?? 0,
      lng: event.lon ?? 0,
      altitude: 0.015,
      color: eventColor(event),
      size: event.category_id.includes("wild") ? 0.58 : 0.48,
      label: `${event.title} · ${event.category}${event.magnitude ? ` · ${event.magnitude}` : ""}`,
    }));
  }, [events]);

  const satellitePoints: GlobePoint[] = useMemo(() => {
    return satellites.map((sat) => ({
      kind: "satellite",
      station: `SAT:${sat.id}`,
      lat: sat.lat,
      lng: sat.lon,
      altitude: sat.visual_altitude,
      color: SATELLITE_COLOR[sat.group],
      size: sat.group === "stations" ? 0.64 : 0.48,
      label: `${sat.name} · ${sat.mission} · ${sat.altitude_km.toLocaleString()} km`,
    }));
  }, [satellites]);

  const satellitePaths: GlobePath[] = useMemo(() => {
    if (!showSatellites) return [];
    return satellites
      .filter((sat) => sat.track?.length > 1)
      .map((sat) => {
        const visualAltitude = sat.altitude_km > 5000 ? 0.12 : 0.045;
        return {
          id: `SATPATH:${sat.id}`,
          color: SATELLITE_COLOR[sat.group],
          points: sat.track.map((point) => ({
            lat: point.lat,
            lng: point.lon,
            altitude: visualAltitude,
          })),
        };
      });
  }, [satellites, showSatellites]);

  const points: GlobePoint[] = useMemo(() => {
    return [
      ...(showStations ? stationPoints : []),
      ...(showEvents ? eventPoints : []),
      ...(showSatellites ? satellitePoints : []),
    ];
  }, [eventPoints, satellitePoints, showEvents, showSatellites, showStations, stationPoints]);

  // Live counts for the floating overlay summary.
  const counts = useMemo(() => {
    const c = { CLEAN: 0, FLAGGED: 0, MISSING: 0, OTHER: 0 };
    for (const p of stationPoints) {
      const s = (p.label || "").split("·").pop()?.trim() || "";
      if (s === "CLEAN") c.CLEAN++;
      else if (s === "FLAGGED") c.FLAGGED++;
      else if (s === "MISSING") c.MISSING++;
      else c.OTHER++;
    }
    return c;
  }, [stationPoints]);

  function focusEvent(event: EonetEvent) {
    if (event.lat == null || event.lon == null) return;
    setIntel({ kind: "event", event });
    setFocus({ lat: event.lat, lng: event.lon, alt: 1.25 });
  }

  function focusSatellite(satellite: LiveSatellite) {
    setIntel({ kind: "satellite", satellite });
    setFocus({
      lat: satellite.lat,
      lng: satellite.lon,
      alt: satellite.altitude_km > 5000 ? 2.5 : 1.15,
    });
  }

  return (
    <>
      <div className="mb-4 -mx-4 sm:-mx-6">
        <div className="border-y border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 py-2 sm:px-6 sm:py-3">
        {/* Globe controls header */}
        <div className="flex items-start justify-between gap-2 sm:mb-2 sm:items-center sm:flex-wrap">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
            <div className="noc-h3 m-0">Unified Command Globe</div>
            <span className="hidden sm:inline text-[0.7rem] text-noc-dim font-mono tracking-wider leading-relaxed">
              <span className="text-noc-cyan">{stationPoints.length}</span> sites
              <span className="text-noc-border-strong px-1.5">|</span>
              <span className="text-noc-cyan">{satellites.length}</span> sats
              <span className="text-noc-border-strong px-1.5">|</span>
              <span className="text-noc-amber">{events.length}</span> events
              <span className="text-noc-border-strong px-1.5">|</span>
              <span className="text-noc-ok">{counts.CLEAN}</span> clean
              <span className="text-noc-border-strong px-1.5">|</span>
              <span className="text-noc-warn">{counts.FLAGGED}</span> flagged
              <span className="text-noc-border-strong px-1.5">|</span>
              <span className="text-noc-crit">{counts.MISSING}</span> missing
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              className="noc-btn flex min-h-8 items-center gap-1 px-2.5 py-1.5 text-[0.66rem] sm:px-3 sm:text-[0.7rem]"
              onClick={() => setAutoRotate((v) => !v)}
            >
              <Play size={11} /> {autoRotate ? "STOP" : "ROTATE"}
            </button>
            <button
              className="noc-btn flex min-h-8 items-center gap-1 px-2.5 py-1.5 text-[0.66rem] sm:px-3 sm:text-[0.7rem]"
              onClick={() => setFocus({ lat: 38, lng: -97, alt: 2.3 })}
            >
              <RotateCcw size={11} /> RESET
            </button>
          </div>
        </div>

        <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1 sm:gap-2">
          <span className="noc-label flex items-center gap-1 mr-1 shrink-0">
            <Map size={11} /> REGION:
          </span>
          {REGIONS.map((r) => (
            <button
              key={r.id}
              className="noc-btn min-h-8 shrink-0 px-2.5 py-1.5 text-[0.64rem] sm:px-3 sm:text-[0.68rem]"
              onClick={() => setFocus({ lat: r.lat, lng: r.lng, alt: r.alt })}
            >
              {r.label}
            </button>
          ))}
          <span className="w-px bg-[color:var(--color-border)] mx-1 shrink-0" />
          <LayerButton active={showStations} onClick={() => setShowStations((v) => !v)}>ASOS</LayerButton>
          <LayerButton active={showEvents} onClick={() => setShowEvents((v) => !v)}>EONET</LayerButton>
          <LayerButton active={showSatellites} onClick={() => setShowSatellites((v) => !v)}>SATELLITES</LayerButton>
        </div>

          <Globe
            points={points}
            paths={satellitePaths}
            height={720}
            className="h-[calc(100dvh-190px)] min-h-[560px] sm:h-[72vh] sm:min-h-[620px]"
            autoRotate={autoRotate}
            focus={focus}
            onPointClick={(p) => {
              if (p.kind === "satellite") {
                const id = p.station.replace(/^SAT:/, "");
                const sat = satellites.find((item) => item.id === id);
                if (sat) focusSatellite(sat);
                return;
              }
              if (p.kind === "event") {
                const id = p.station.replace(/^EONET:/, "");
                const event = events.find((item) => item.id === id);
                if (event) focusEvent(event);
                return;
              }
              const catalog = STATIONS.find((item) => item.id === p.station);
              const scan = scanByStation[p.station];
              setStation({
                id: p.station,
                lat: catalog?.lat ?? scan?.lat ?? p.lat,
                lng: catalog?.lon ?? scan?.lon ?? p.lng,
                name: catalog?.name ?? scan?.name ?? p.label,
                state: scan?.state ?? catalog?.state,
                status: scan?.status,
                minutesSinceLast: scan?.minutes_since_last_report,
                lastMetar: scan?.last_metar,
                lastValid: scan?.last_valid,
                probableReason: scan?.probable_reason,
              });
            }}
          />
        </div>

        <GlobeIntelPanel
          events={events}
          satellites={satellites}
          selected={intel}
          onEvent={focusEvent}
          onSatellite={focusSatellite}
        />
      </div>

      <DrillPanel station={station} onClose={() => setStation(null)} />
    </>
  );
}

function LayerButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`noc-btn min-h-8 shrink-0 px-2.5 py-1.5 text-[0.64rem] sm:px-3 sm:text-[0.68rem] ${active ? "noc-btn-primary" : ""}`}
    >
      {children}
    </button>
  );
}

function GlobeIntelPanel({
  events,
  satellites,
  selected,
  onEvent,
  onSatellite,
}: {
  events: EonetEvent[];
  satellites: LiveSatellite[];
  selected: IntelSelection;
  onEvent: (event: EonetEvent) => void;
  onSatellite: (satellite: LiveSatellite) => void;
}) {
  return (
    <div className="grid xl:grid-cols-[1fr_1fr_0.9fr] gap-3 mt-3">
      <div className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-bg)] overflow-hidden">
        <div className="px-3 py-2 border-b border-[color:var(--color-border)] flex items-center gap-2">
          <Flame size={13} className="text-[color:var(--color-warn)]" />
          <span className="noc-label text-[0.6rem]">Open EONET events</span>
        </div>
        <div className="max-h-[220px] overflow-auto">
          {events.slice(0, 12).map((event) => (
            <button
              key={event.id}
              onClick={() => onEvent(event)}
              className="w-full text-left px-3 py-2 border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-surface-2)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm text-[color:var(--color-fg)] truncate">{event.title}</span>
                <CategoryPill event={event} />
              </div>
              <div className="text-[0.7rem] text-[color:var(--color-fg-muted)] truncate">
                {event.updated_at ? event.updated_at.slice(0, 16).replace("T", " ") : "latest"}
                {event.magnitude ? ` · ${event.magnitude}` : ""}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-bg)] overflow-hidden">
        <div className="px-3 py-2 border-b border-[color:var(--color-border)] flex items-center gap-2">
          <Orbit size={13} className="text-[color:var(--color-accent)]" />
          <span className="noc-label text-[0.6rem]">Live satellites</span>
        </div>
        <div className="max-h-[220px] overflow-auto">
          {satellites.map((sat) => (
            <button
              key={sat.id}
              onClick={() => onSatellite(sat)}
              className="w-full text-left px-3 py-2 border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-surface-2)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm text-[color:var(--color-fg)] truncate">{sat.name}</span>
                <SatellitePill sat={sat} />
              </div>
              <div className="text-[0.7rem] text-[color:var(--color-fg-muted)] truncate">
                {sat.altitude_km.toLocaleString()} km · {sat.velocity_km_s ?? "--"} km/s · {sat.mission}
              </div>
            </button>
          ))}
        </div>
      </div>

      <IntelDetail selected={selected} />
    </div>
  );
}

function IntelDetail({ selected }: { selected: IntelSelection }) {
  if (!selected) {
    return (
      <div className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-bg)] p-3">
        <div className="noc-label text-[0.6rem] mb-2">Selected layer object</div>
        <div className="text-sm text-[color:var(--color-fg-muted)]">
          Click an EONET event or satellite point on the globe to inspect live details.
        </div>
      </div>
    );
  }

  if (selected.kind === "event") {
    const event = selected.event;
    return (
      <div className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-bg)] p-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="font-semibold text-[color:var(--color-fg)]">{event.title}</div>
            <div className="text-[0.72rem] text-[color:var(--color-fg-muted)]">{event.category}</div>
          </div>
          <CategoryPill event={event} />
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <MiniMetric label="Updated" value={event.updated_at ? event.updated_at.slice(0, 16).replace("T", " ") : "--"} />
          <MiniMetric label="Magnitude" value={event.magnitude ?? "--"} />
          <MiniMetric label="Lat / Lon" value={event.lat != null && event.lon != null ? `${event.lat.toFixed(2)}, ${event.lon.toFixed(2)}` : "--"} />
          <MiniMetric label="Source" value={event.source ?? "EONET"} />
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={event.eonet_url} target="_blank" rel="noopener noreferrer" className="noc-btn text-[0.72rem] py-1.5">
            EONET <ExternalLink size={11} />
          </a>
          {event.source_url && (
            <a href={event.source_url} target="_blank" rel="noopener noreferrer" className="noc-btn noc-btn-primary text-[0.72rem] py-1.5">
              Source <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    );
  }

  const sat = selected.satellite;
  const live = satelliteLiveImage(sat);
  return (
    <div className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-bg)] p-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="font-semibold text-[color:var(--color-fg)]">{sat.name}</div>
          <div className="text-[0.72rem] text-[color:var(--color-fg-muted)]">{sat.mission}</div>
        </div>
        <Satellite size={18} className="text-[color:var(--color-accent)] shrink-0" />
      </div>

      {live ? (
        <figure className="mb-3 border border-[color:var(--color-border)] rounded overflow-hidden bg-black">
          <img
            src={live.url}
            alt={`${sat.name} live imagery`}
            loading="lazy"
            className="w-full h-auto block"
          />
          <figcaption className="px-2 py-1 text-[0.62rem] text-[color:var(--color-fg-muted)] flex items-center justify-between gap-2 bg-[color:var(--color-surface)]">
            <span className="truncate">{live.caption}</span>
            <span className="font-mono shrink-0">{new Date().toUTCString().slice(17, 22)}Z</span>
          </figcaption>
        </figure>
      ) : (
        <div className="mb-3 border border-dashed border-[color:var(--color-border)] rounded px-2 py-3 text-[0.7rem] text-[color:var(--color-fg-muted)]">
          No direct live tile for this platform. Position-only telemetry shown below.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MiniMetric label="NORAD" value={String(sat.norad_id)} />
        <MiniMetric label="Altitude" value={`${sat.altitude_km.toLocaleString()} km`} />
        <MiniMetric label="Velocity" value={sat.velocity_km_s != null ? `${sat.velocity_km_s} km/s` : "--"} />
        <MiniMetric label="Period" value={`${sat.period_min} min`} />
        <MiniMetric label="Inclination" value={`${sat.inclination_deg.toFixed(1)} deg`} />
        <MiniMetric label="Lat / Lon" value={`${sat.lat.toFixed(2)}, ${sat.lon.toFixed(2)}`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={sat.public_url} target="_blank" rel="noopener noreferrer" className="noc-btn text-[0.66rem] py-1">
          Mission page <ExternalLink size={10} />
        </a>
        {sat.imagery_url && !live && (
          <a href={sat.imagery_url} target="_blank" rel="noopener noreferrer" className="noc-btn text-[0.66rem] py-1">
            Imagery portal <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-surface)] px-2 py-1.5">
      <div className="noc-label text-[0.54rem] mb-0.5">{label}</div>
      <div className="font-mono text-[0.74rem] text-[color:var(--color-fg)] truncate">{value}</div>
    </div>
  );
}

function CategoryPill({ event }: { event: EonetEvent }) {
  const cls = event.category_id.includes("wild")
    ? "owl-pill owl-pill-warn"
    : event.category_id.includes("storm") || event.category_id.includes("flood")
      ? "owl-pill owl-pill-info"
      : "owl-pill owl-pill-dim";
  const Icon = event.category_id.includes("wild")
    ? Flame
    : event.category_id.includes("storm") || event.category_id.includes("flood")
      ? Waves
      : Satellite;
  return (
    <span className={`${cls} whitespace-nowrap`}>
      <Icon size={10} />
      {event.category}
    </span>
  );
}

function SatellitePill({ sat }: { sat: LiveSatellite }) {
  const label = sat.group === "stations" ? "Station" : sat.group === "weather" ? "Weather" : "EO";
  const cls = sat.group === "weather" ? "owl-pill owl-pill-info" : sat.group === "resource" ? "owl-pill owl-pill-ok" : "owl-pill owl-pill-dim";
  return <span className={`${cls} shrink-0`}>{label}</span>;
}
