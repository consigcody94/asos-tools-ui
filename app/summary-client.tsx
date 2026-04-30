"use client";

/** Client half of the Summary page — owns the interactive globe + drill
 *  panel + region presets.  Renders the full 918-station catalog at all
 *  times; status colors come from a periodic poll of the OWL API.
 *
 *  When SignalR is wired (Phase 3) the poll is replaced with a
 *  real-time push subscription and points re-color without a request.
 */

import { useEffect, useMemo, useState } from "react";
import { Globe, type GlobePoint, type MapOverlay } from "@/components/globe";
import { DrillPanel } from "@/components/drill-panel";
import { OwlLeftSidebar, useOwlFilters, REGIONS as OWL_REGIONS } from "@/components/owl-left-sidebar";
import { OwlRightSidebar } from "@/components/owl-right-sidebar";
import { ExternalLink, Flame, Orbit, Satellite, Waves } from "lucide-react";
import { STATIONS } from "@/lib/data/stations";

const REGIONS = OWL_REGIONS;

// Status -> (color, point size) for the globe rendering.
// Colours align with the global theme tokens — muted, not neon.
const STATUS_VIZ: Record<string, { color: string; size: number }> = {
  CLEAN:        { color: "#3fb27f", size: 0.30 },
  RECOVERED:    { color: "#5fa8e6", size: 0.35 },
  INTERMITTENT: { color: "#c48828", size: 0.40 },
  FLAGGED:      { color: "#e0a73a", size: 0.50 },
  MISSING:      { color: "#e25c6b", size: 0.60 },
  OFFLINE:      { color: "#475569", size: 0.25 },
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
  /** Diagnostic fields populated by the server-side classifier. Optional
   *  on the client because the slim /api/scan-results response (no `full=1`)
   *  still omits them; the SSR snapshot includes them. */
  evidence_quality?: {
    buckets_seen: number;
    buckets_expected: number;
    fraction: number;
    flagged_in_window: number;
    reports_seen: number;
    consecutive_silent_buckets?: number;
  };
  state_log?: Array<{ at: string; state: "OK" | "FLAGGED" | "MISSING" }>;
  cross_check?: {
    source: "ncei" | "awc" | "nws";
    agrees_with_iem: boolean;
    checked_at: string;
    buckets_seen: number;
    suggested_status?: string;
    skipped?: string;
  };
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

interface ProgramRow {
  station: string;
  name?: string;
  state?: string;
  lat?: number;
  lon?: number;
  status: string;            // raw — UP / DOWN / DEGRADED / UNKNOWN / etc.
  reason?: string | null;
  since?: string | null;
  minutes_since?: number | null;
  hours_since?: number | null;
}

const PROGRAM_COLOR = {
  ASOS:     { UP: "#3fb27f", DEGRADED: "#e0a73a", DOWN: "#e25c6b", UNKNOWN: "#5f6f8f" },
  RADAR:    { UP: "#5fa8e6", DEGRADED: "#e0a73a", DOWN: "#e25c6b", UNKNOWN: "#5f6f8f" },
  BUOY:     { UP: "#3fb27f", DEGRADED: "#e0a73a", DOWN: "#e25c6b", UNKNOWN: "#5f6f8f" },
  NWR:      { UP: "#3fb27f", DEGRADED: "#e0a73a", DOWN: "#e25c6b", UNKNOWN: "#5f6f8f" },
  UPPERAIR: { UP: "#a78bfa", DEGRADED: "#e0a73a", DOWN: "#e25c6b", UNKNOWN: "#5f6f8f" },
} as const;

type ReducedStatusKey = keyof (typeof PROGRAM_COLOR)["ASOS"];

function reduceProgramStatus(s: string): ReducedStatusKey {
  const u = (s || "").toUpperCase();
  if (u === "UP" || u === "CLEAN" || u === "RECOVERED") return "UP";
  if (u === "DOWN" || u === "MISSING" || u === "OFFLINE") return "DOWN";
  if (u === "DEGRADED" || u === "INTERMITTENT" || u === "FLAGGED") return "DEGRADED";
  return "UNKNOWN";
}

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
  // For non-GEO sats we want imagery that's reliably populated, not the
  // black night-side rectangle the satellite's *current* sub-point lands
  // on. NASA GIBS layers are global daily mosaics; rendering the whole
  // world with the satellite's instrument as the source gives a real
  // composite no matter where it is in its orbit.
  // We use yesterday's date because today's swath isn't always processed
  // yet (GIBS lag).
  const day = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  const bbox = `-90,-180,90,180`;
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

interface SummaryClientProps {
  initialStatuses?: Record<string, string>;
  initialScannedAt?: string | null;
}

export function SummaryClient({
  initialStatuses,
  initialScannedAt: _initialScannedAt,
}: SummaryClientProps = {}) {
  const [filters, setFilters] = useOwlFilters();
  const [focus, setFocus] = useState<{ lat: number; lng: number; alt?: number } | null>(null);
  const [autoExpandDownTable, setAutoExpandDownTable] = useState(false);
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
    /** Click-target kind. Drives drill-panel fetch behavior — non-ASOS
     *  kinds skip the METAR/imagery calls that would 404 for buoys,
     *  radar sites, satellites, and EONET events. */
    kind?: "asos" | "buoy" | "radar" | "satellite" | "event";
    /** Optional diagnostic fields piped through to StationTimeline. */
    evidenceQuality?: ScanRow["evidence_quality"] | null;
    stateLog?: ScanRow["state_log"] | null;
    crossCheck?: ScanRow["cross_check"] | null;
  } | null>(null);
  // Seed status state from the SSR'd snapshot so the very first render
  // has all 918 stations colored — no waiting on SSE / poll round-trips.
  const [statusByStation, setStatusByStation] = useState<Record<string, string>>(
    () => initialStatuses ?? {},
  );
  const [scanByStation, setScanByStation] = useState<Record<string, ScanRow>>({});
  const [events, setEvents] = useState<EonetEvent[]>([]);
  const [satellites, setSatellites] = useState<LiveSatellite[]>([]);
  const [intel, setIntel] = useState<IntelSelection>(null);

  // Per-program rows from /api/programs/*. NEXRAD + Buoys carry
  // coordinates so they render on the map; NWR + Upper-Air don't and
  // appear list-only in the right sidebar's Down Sites table.
  const [nexradRows, setNexradRows] = useState<ProgramRow[]>([]);
  const [buoyRows, setBuoyRows] = useState<ProgramRow[]>([]);
  const [nwrRows, setNwrRows] = useState<ProgramRow[]>([]);
  const [uaRows, setUaRows] = useState<ProgramRow[]>([]);

  // Prefer the Proxmox SSE stream for scan updates. Fallback to polling
  // if EventSource is unavailable or the stream drops.
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    let es: EventSource | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    function applyRows(rows?: ScanRow[]) {
      if (cancelled) return;
      // An empty/undefined payload almost always means a transient
      // upstream blip (warming, IEM rate limit, network error). It is
      // never a signal that "all 918 stations went dark." Keep last
      // known statuses on the client and ignore the empty pulse.
      if (!rows || rows.length === 0) return;

      // Merge into the previous map so a partial scan (e.g., AWC
      // fallback returning a subset) doesn't blank the stations the
      // current pulse didn't cover. ASOS METARs only update hourly.
      setStatusByStation((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const r of rows) {
          if (r.station) next[r.station] = (r.status || "NO DATA").toUpperCase();
        }
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
      setScanByStation((prev) => {
        const next: Record<string, ScanRow> = { ...prev };
        for (const r of rows) {
          if (r.station) next[r.station] = r;
        }
        return next;
      });
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
        // EventSource fires onerror on each transient network blip. We
        // close it and start a single polling fallback. Without the
        // `interval` guard, every reconnect attempt would stack another
        // setInterval and quickly DDoS our own /api/scan-results.
        es?.close();
        es = null;
        if (!interval) {
          refresh();
          interval = setInterval(refresh, 60_000);
        }
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

  // Poll the four secondary programs together. NEXRAD + Buoys carry
  // coordinates and end up on the map; NWR + Upper Air don't (no
  // public catalog with lat/lon for those at this resolution) so they
  // appear in the Down-Sites table only.
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    async function pull() {
      try {
        const [nexr, buoy, nwr, ua] = await Promise.all([
          fetch("/api/programs/nexrad", { signal: ctrl.signal }).then((r) => r.json()).catch(() => ({ rows: [] })),
          fetch("/api/programs/buoys",  { signal: ctrl.signal }).then((r) => r.json()).catch(() => ({ rows: [] })),
          fetch("/api/programs/nwr",    { signal: ctrl.signal }).then((r) => r.json()).catch(() => ({ rows: [] })),
          fetch("/api/programs/upperair", { signal: ctrl.signal }).then((r) => r.json()).catch(() => ({ rows: [] })),
        ]);
        if (cancelled) return;
        setNexradRows(nexr.rows ?? []);
        setBuoyRows(buoy.rows ?? []);
        setNwrRows(nwr.rows ?? []);
        setUaRows(ua.rows ?? []);
      } catch {
        /* keep last-known program rows on transient blip */
      }
    }
    pull();
    const id = setInterval(pull, 5 * 60_000); // 5 min — matches NWS Status Map cadence
    return () => { cancelled = true; clearInterval(id); ctrl.abort(); };
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


  // Build NEXRAD + buoy points from the polled program rows. Each
  // program gets its own color palette so operators can tell them
  // apart at a glance.
  const nexradPoints: GlobePoint[] = useMemo(() => {
    if (!filters.programs.RADAR) return [];
    return nexradRows
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
      .map((r) => {
        const reduced = reduceProgramStatus(r.status);
        return {
          kind: "event",
          station: `RADAR:${r.station}`,
          lat: r.lat as number,
          lng: r.lon as number,
          altitude: 0.013,
          color: PROGRAM_COLOR.RADAR[reduced],
          size: reduced === "DOWN" ? 0.6 : reduced === "DEGRADED" ? 0.5 : 0.36,
          label: `${r.station} · NEXRAD · ${reduced}${r.reason ? ` · ${r.reason}` : ""}`,
        };
      });
  }, [filters.programs.RADAR, nexradRows]);

  const buoyPoints: GlobePoint[] = useMemo(() => {
    if (!filters.programs.BUOY) return [];
    return buoyRows
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
      .map((r) => {
        const reduced = reduceProgramStatus(r.status);
        return {
          kind: "event",
          station: `BUOY:${r.station}`,
          lat: r.lat as number,
          lng: r.lon as number,
          altitude: 0.012,
          color: PROGRAM_COLOR.BUOY[reduced],
          size: reduced === "DOWN" ? 0.55 : reduced === "DEGRADED" ? 0.45 : 0.32,
          label: `${r.station} · NDBC buoy · ${reduced}${r.minutes_since != null ? ` · ${r.minutes_since}m ago` : ""}`,
        };
      });
  }, [filters.programs.BUOY, buoyRows]);

  // Apply user-side filters: ASOS toggle, search, only-down.
  const filteredStationPoints: GlobePoint[] = useMemo(() => {
    if (!filters.programs.ASOS) return [];
    let out = stationPoints;
    if (filters.onlyDown) {
      out = out.filter((p) => {
        const lab = (p.label || "").toLowerCase();
        return lab.includes("missing") || lab.includes("offline") || lab.includes("flagged") || lab.includes("intermittent");
      });
    }
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      out = out.filter((p) =>
        p.station.toLowerCase().includes(q) ||
        (p.label || "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [filters.programs.ASOS, filters.onlyDown, filters.search, stationPoints]);

  const points: GlobePoint[] = useMemo(() => {
    return [
      ...filteredStationPoints,
      ...nexradPoints,
      ...buoyPoints,
      ...eventPoints,
      ...satellitePoints,
    ];
  }, [eventPoints, satellitePoints, filteredStationPoints, nexradPoints, buoyPoints]);

  // Timed rotation through configured regions. Pauses while a popup
  // (drill panel) is open, mirroring the NWS Status Map convention.
  useEffect(() => {
    if (!filters.rotationOn) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % REGIONS.length;
      const r = REGIONS[i];
      setFocus({ lat: r.lat, lng: r.lng, alt: r.alt });
    }, Math.max(1, filters.rotationPauseSec) * 1000);
    return () => clearInterval(id);
  }, [filters.rotationOn, filters.rotationPauseSec]);

  // Counts now live in the right sidebar via reduceCounts(); this memo
  // is no longer needed at the SummaryClient level.

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

  // Build the Down-Sites table input from every enabled program.
  // Each row carries `program` so the right sidebar groups them.
  const sidebarRows = useMemo(() => {
    type Row = { station: string; name?: string; state?: string; status: string; program: string };
    const out: Row[] = [];
    if (filters.programs.ASOS) {
      for (const s of STATIONS) {
        out.push({
          station: s.id, name: s.name, state: s.state,
          status: statusByStation[s.id] || "NO DATA", program: "ASOS",
        });
      }
    }
    if (filters.programs.RADAR) {
      for (const r of nexradRows) {
        out.push({ station: r.station, name: r.name, state: r.state, status: r.status, program: "RADAR" });
      }
    }
    if (filters.programs.BUOY) {
      for (const r of buoyRows) {
        out.push({ station: r.station, status: r.status, program: "BUOY" });
      }
    }
    if (filters.programs.NWR) {
      for (const r of nwrRows) {
        out.push({ station: r.station, state: r.state, status: r.status, program: "NWR" });
      }
    }
    if (filters.programs.UPPERAIR) {
      for (const r of uaRows) {
        out.push({ station: r.station, status: r.status, program: "UPPERAIR" });
      }
    }
    return out;
  }, [filters.programs, statusByStation, nexradRows, buoyRows, nwrRows, uaRows]);

  // Build map overlays from the filter state. NEXRAD reflectivity via
  // the Iowa State Mesonet tile cache (the same source the NWS internal
  // Status Map uses) — public, no auth, well-cached, sub-second
  // responses. The previous opengeo WMS attempt was speculative; this
  // one is operationally proven.
  const mapOverlays: MapOverlay[] = useMemo(() => {
    return [
      {
        id: "nexrad-n0q",
        tiles: [
          "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q/{z}/{x}/{y}.png",
        ],
        opacity: filters.overlays.radarOpacity,
        visible: filters.overlays.radar,
      },
      // Active WWA polygons — fill with translucent red so warnings pop.
      {
        kind: "geojson", id: "wwa",
        url: "/api/overlays/wwa",
        lineColor: "#e25c6b", fillColor: "#e25c6b",
        opacity: 0.6, lineWidth: 1,
        visible: filters.overlays.wwa,
      },
      // WFO footprints — outline only, dim teal.
      {
        kind: "geojson", id: "wfo",
        url: "/api/overlays/wfo",
        lineColor: "#5fa8e6", lineWidth: 0.8,
        opacity: 0.55, visible: filters.overlays.wfo,
      },
      // RFC — outline only, slightly thicker, magenta.
      {
        kind: "geojson", id: "rfc",
        url: "/api/overlays/rfc",
        lineColor: "#c084fc", lineWidth: 1.2,
        opacity: 0.6, visible: filters.overlays.rfc,
      },
      // CWSU — yellow outline.
      {
        kind: "geojson", id: "cwsu",
        url: "/api/overlays/cwsu",
        lineColor: "#fbbf24", lineWidth: 1.0,
        opacity: 0.6, visible: filters.overlays.cwsu,
      },
      // Time zones — neutral grey.
      {
        kind: "geojson", id: "timezones",
        url: "/api/overlays/timezones",
        lineColor: "#94a3b8", lineWidth: 0.6,
        opacity: 0.45, visible: filters.overlays.timezones,
      },
    ];
  }, [filters.overlays]);

  function focusStation(stationId: string) {
    const s = STATIONS.find((x) => x.id === stationId);
    if (!s) return;
    setFocus({ lat: s.lat, lng: s.lon, alt: 0.7 });
    const scan = scanByStation[stationId];
    setStation({
      id: stationId,
      lat: s.lat,
      lng: s.lon,
      name: s.name,
      state: s.state,
      status: scan?.status,
      minutesSinceLast: scan?.minutes_since_last_report,
      lastMetar: scan?.last_metar,
      lastValid: scan?.last_valid,
      probableReason: scan?.probable_reason,
    });
  }

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-[240px_1fr_300px] -mx-2 sm:-mx-4">
        {/* Left sidebar */}
        <div className="hidden lg:block px-2">
          <OwlLeftSidebar
            filters={filters}
            setFilters={setFilters}
            onRegion={(lat, lng, alt) => setFocus({ lat, lng, alt })}
            onResetMap={() => setFocus({ lat: 38, lng: -97, alt: 2.3 })}
          />
        </div>

        {/* Map column */}
        <div>
          <Globe
            points={points}
            paths={[]}
            overlays={mapOverlays}
            projection={filters.projection}
            basemap={filters.basemap}
            height={720}
            className="h-[calc(100dvh-200px)] min-h-[560px] sm:h-[72vh] sm:min-h-[620px]"
            focus={focus}
            onPointClick={(p) => {
              // Satellite — drill the inline live-feed panel.
              if (p.station.startsWith("SAT:")) {
                const id = p.station.replace(/^SAT:/, "");
                const sat = satellites.find((item) => item.id === id);
                if (sat) focusSatellite(sat);
                return;
              }
              // EONET event — drill the event intel block.
              if (p.station.startsWith("EONET:")) {
                const id = p.station.replace(/^EONET:/, "");
                const event = events.find((item) => item.id === id);
                if (event) focusEvent(event);
                return;
              }
              // NEXRAD radar — find matching row, open drill panel.
              // Mark kind="radar" so the drill panel skips ASOS-only
              // METAR/imagery fetches and just renders the geo hazards.
              if (p.station.startsWith("RADAR:")) {
                const id = p.station.replace(/^RADAR:/, "");
                const row = nexradRows.find((r) => r.station === id);
                setStation({
                  id, lat: p.lat, lng: p.lng,
                  name: row?.name ?? `${id} NEXRAD`,
                  state: row?.state,
                  status: row?.status ?? "UP",
                  probableReason: row?.reason ?? null,
                  lastValid: row?.since ?? null,
                  kind: "radar",
                });
                return;
              }
              // NDBC buoy — find matching row, open drill panel.
              if (p.station.startsWith("BUOY:")) {
                const id = p.station.replace(/^BUOY:/, "");
                const row = buoyRows.find((r) => r.station === id);
                setStation({
                  id, lat: p.lat, lng: p.lng,
                  name: `Buoy ${id}`,
                  status: row?.status ?? "UP",
                  minutesSinceLast: row?.minutes_since,
                  lastValid: row?.since ?? null,
                  kind: "buoy",
                });
                return;
              }
              // ASOS — full drill including METAR + diagnostic timeline.
              // We pass every new diagnostic field through so the
              // StationTimeline component can render evidence_quality,
              // state_log, and cross_check without refetching them.
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
                evidenceQuality: scan?.evidence_quality ?? null,
                stateLog: scan?.state_log ?? null,
                crossCheck: scan?.cross_check ?? null,
                kind: "asos",
              });
            }}
          />

          <GlobeIntelPanel
            events={events}
            satellites={satellites}
            selected={intel}
            onEvent={focusEvent}
            onSatellite={focusSatellite}
          />
        </div>

        {/* Right sidebar */}
        <div className="hidden lg:block px-2">
          <OwlRightSidebar
            rows={sidebarRows}
            autoExpand={autoExpandDownTable}
            setAutoExpand={setAutoExpandDownTable}
            onSelect={focusStation}
          />
        </div>
      </div>

      <DrillPanel station={station} onClose={() => setStation(null)} />
    </>
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
