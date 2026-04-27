"use client";

/** Station drill panel — opens when a globe point is clicked.
 *  Shows: FAA WeatherCams + NWS RIDGE NEXRAD loop + NESDIS GOES loop
 *  + Site Hazards (USGS + NHC + NDBC + FAA NOTAM). All fetched from
 *  this app's own /api routes — zero external dependency at runtime.
 */

import { useEffect, useState } from "react";
import { X, ExternalLink, Copy, Check } from "lucide-react";
import { getCamerasNear, getStationHazards, type WeatherCam } from "@/lib/api";

interface Props {
  station: { id: string; lat: number; lng: number; name?: string } | null;
  onClose: () => void;
}

interface QuakeRec { mag: number | null; place: string; time_ms: number | null; distance_km?: number; url: string }
interface StormRec { id: string; name: string; class_label: string; intensity_kt: string; pressure_mb: string; distance_km?: number; public_advisory: string }
interface BuoyPack { buoy: { id: string; name: string; distance_km: number }; obs: Record<string, number | null> | null }
interface NotamSum { configured: boolean; count: number; equipment_out: number; asos_related: number; items: Array<Record<string, string>> }

interface DecodedMetarClient {
  raw: string;
  station: string;
  observed_at: string | null;
  modifier: "AUTO" | "COR" | null;
  wind: {
    direction: number | "VRB" | null;
    speed_kt: number | null;
    gust_kt: number | null;
    variable_from: number | null;
    variable_to: number | null;
  } | null;
  visibility_sm: number | null;
  visibility_text: string | null;
  weather: Array<{ raw: string; text: string }>;
  clouds: Array<{ coverage: string; height_ft: number | null; type: string | null }>;
  sky_summary: string | null;
  temperature_c: number | null;
  temperature_f: number | null;
  dewpoint_c: number | null;
  dewpoint_f: number | null;
  altimeter_inhg: number | null;
  altimeter_hpa: number | null;
  ceiling_ft: number | null;
  flight_category: "VFR" | "MVFR" | "IFR" | "LIFR" | null;
  remarks: string | null;
  has_maintenance: boolean;
  maintenance_reasons: Array<{ sensor: string; reason: string }>;
}

interface StationMetarResponse {
  source: string;
  scanned_at?: string;
  status?: string;
  decoded: DecodedMetarClient | null;
  error?: string;
}

interface StacScene {
  id: string;
  collection: string;
  datetime: string;
  cloud_cover: number | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  worldview_link: string;
  cog_visual_url: string | null;
  platform: string | null;
}

interface ImageryResponse {
  station: { id: string; name: string; state: string; lat: number; lon: number };
  bbox: [number, number, number, number];
  gibs: Array<{ layer: string; label: string; date: string; url: string }>;
  sentinel2: StacScene[];
  landsat: StacScene[];
  links: {
    nasa_worldview: string;
    copernicus_browser: string;
    zoom_earth: string;
    eosda_landviewer: string;
    sentinel_hub: string;
  };
}

export function DrillPanel({ station, onClose }: Props) {
  const [cams, setCams] = useState<WeatherCam[]>([]);
  const [camsLoading, setCamsLoading] = useState(false);
  const [hazards, setHazards] = useState<{
    quakes: QuakeRec[]; storms: StormRec[]; buoy: BuoyPack | null; notams: NotamSum;
  } | null>(null);
  const [metar, setMetar] = useState<StationMetarResponse | null>(null);
  const [metarLoading, setMetarLoading] = useState(false);
  const [imagery, setImagery] = useState<ImageryResponse | null>(null);
  const [imageryLoading, setImageryLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!station) return;
    setCamsLoading(true);
    setCams([]);
    setHazards(null);
    setMetar(null);
    setMetarLoading(true);

    getCamerasNear(station.lat, station.lng, 25, 4)
      .then(setCams)
      .catch(() => setCams([]))
      .finally(() => setCamsLoading(false));

    getStationHazards(station.id)
      .then((h) =>
        setHazards({
          quakes: (h.quakes as unknown as QuakeRec[]) ?? [],
          storms: (h.storms as unknown as StormRec[]) ?? [],
          buoy: (h.buoy as BuoyPack | null) ?? null,
          notams: (h.notams as unknown as NotamSum) ?? { configured: false, count: 0, equipment_out: 0, asos_related: 0, items: [] },
        }),
      )
      .catch(() => setHazards(null));

    fetch(`/api/station/${encodeURIComponent(station.id)}/metar`)
      .then((r) => r.json())
      .then((data: StationMetarResponse) => setMetar(data))
      .catch(() => setMetar(null))
      .finally(() => setMetarLoading(false));

    setImageryLoading(true);
    setImagery(null);
    fetch(`/api/station/${encodeURIComponent(station.id)}/imagery`)
      .then((r) => r.json())
      .then((data: ImageryResponse) => setImagery(data))
      .catch(() => setImagery(null))
      .finally(() => setImageryLoading(false));
  }, [station]);

  if (!station) return null;

  const goesUrl = goesLoopFor(station.lat, station.lng);
  const radarUrl = stationRadarLoop(station.lat, station.lng);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(station.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="noc-panel mt-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="font-mono text-[1.6rem] leading-none font-semibold text-[color:var(--color-fg)]">
            {station.id}
          </div>
          <button
            onClick={copyId}
            title="Copy station ID"
            className="noc-btn text-[0.68rem] px-2 py-1"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
          {station.name && (
            <div className="text-[color:var(--color-fg-muted)] text-[0.85rem]">{station.name}</div>
          )}
          <a
            href={`https://www.aviationweather.gov/metar/data?ids=${station.id}&format=raw`}
            target="_blank" rel="noopener noreferrer"
            className="text-[color:var(--color-accent)] text-[0.72rem] inline-flex items-center gap-1 hover:underline"
          >
            AWC <ExternalLink size={10} />
          </a>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] p-1"
        >
          <X size={18} />
        </button>
      </div>

      {/* Decoded METAR */}
      <DecodedMetarBlock metar={metar} loading={metarLoading} />

      {/* Live coverage — WeatherCam + NEXRAD + GOES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <TileCam cams={cams} loading={camsLoading} />
        <TileImage
          title="NEXRAD Radar"
          subtitle={radarUrl.fallback ? "CONUS composite (no nearby WSR-88D)" : `${radarUrl.site} · ${radarUrl.km} km`}
          src={radarUrl.url}
          alt="NWS NEXRAD loop"
        />
        <TileImage
          title="GOES Satellite"
          subtitle={goesUrl.label}
          src={goesUrl.url}
          alt="NESDIS GOES loop"
        />
      </div>

      {/* Overhead imagery archive */}
      <OverheadImagery imagery={imagery} loading={imageryLoading} />

      {/* Site hazards */}
      <SiteHazards hazards={hazards} />
    </div>
  );
}

// -- Live coverage tiles -----------------------------------------------------

function TileCam({ cams, loading }: { cams: WeatherCam[]; loading: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="noc-h3">Nearest FAA WeatherCam</div>
        <span className="text-[0.62rem] text-[color:var(--color-fg-dim)]">10-min still</span>
      </div>
      <div
        className="relative w-full overflow-hidden rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)]"
        style={{ aspectRatio: "16 / 9" }}
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-[color:var(--color-fg-dim)] text-xs">Loading…</div>
        ) : cams.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-[color:var(--color-fg-dim)] text-xs text-center px-4">
            No FAA WeatherCam within 25 NM of this station.
          </div>
        ) : (
          <img
            src={`https://weathercams.faa.gov/cameras/${cams[0].id}/latestImage`}
            alt={cams[0].site_name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
      </div>
      {cams[0] && (
        <div className="text-[0.7rem] text-[color:var(--color-fg-muted)] mt-1 truncate">
          <span className="text-[color:var(--color-fg)] font-medium">{cams[0].site_name}</span>
          {" · "}{cams[0].direction} · {cams[0].distance_nm} NM
        </div>
      )}
    </div>
  );
}

function TileImage({ title, subtitle, src, alt }: { title: string; subtitle: string; src: string; alt: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="noc-h3">{title}</div>
        <span className="text-[0.62rem] text-[color:var(--color-fg-dim)]">5-min loop</span>
      </div>
      <div
        className="relative w-full overflow-hidden rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)]"
        style={{ aspectRatio: "16 / 9" }}
      >
        <img src={src} alt={alt} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
      </div>
      <div className="text-[0.7rem] text-[color:var(--color-fg-muted)] mt-1">{subtitle}</div>
    </div>
  );
}

// -- Site hazards ------------------------------------------------------------

function SiteHazards({ hazards }: { hazards: { quakes: QuakeRec[]; storms: StormRec[]; buoy: BuoyPack | null; notams: NotamSum } | null }) {
  if (!hazards) {
    return <div className="noc-h3 mb-2">Site Hazards <span className="ml-2 text-[color:var(--color-fg-dim)] normal-case">loading…</span></div>;
  }
  const anything = hazards.quakes.length || hazards.storms.length || hazards.buoy?.obs || (hazards.notams.configured && hazards.notams.count);
  return (
    <div>
      <div className="noc-h3 mb-2">Site Hazards</div>
      {!anything && (
        <div className="text-[0.78rem] text-[color:var(--color-fg-dim)]">
          No earthquakes within 300 km · no tropical systems within 500 km · no buoy within 200 km.
          {!hazards.notams.configured && (
            <>
              {" · "}FAA NOTAM feed not configured — set{" "}
              <code className="text-[color:var(--color-fg-muted)]">FAA_NOTAM_CLIENT_ID</code> +{" "}
              <code className="text-[color:var(--color-fg-muted)]">FAA_NOTAM_CLIENT_SECRET</code>.
            </>
          )}
        </div>
      )}
      {hazards.quakes.length > 0 && (
        <HazardBlock
          title={`USGS · ${hazards.quakes.length} earthquakes within 300 km (24h, M2.5+)`}
          rows={hazards.quakes.slice(0, 5).map((q) => (
            <tr key={q.url}>
              <td className="font-mono">{q.mag?.toFixed(1)}</td>
              <td>{q.place}</td>
              <td className="font-mono text-[color:var(--color-fg-muted)]">{q.distance_km} km</td>
              <td>
                <a href={q.url} target="_blank" rel="noopener noreferrer" className="text-[color:var(--color-accent)]">
                  <ExternalLink size={12} />
                </a>
              </td>
            </tr>
          ))}
          cols={["Mag", "Location", "Dist", ""]}
        />
      )}
      {hazards.storms.length > 0 && (
        <HazardBlock
          title={`NHC · ${hazards.storms.length} active tropical systems within 500 km`}
          rows={hazards.storms.map((s) => (
            <tr key={s.id}>
              <td className="font-mono">{s.id}</td>
              <td>{s.name}</td>
              <td>{s.class_label}</td>
              <td className="font-mono text-[color:var(--color-fg-muted)]">{s.distance_km} km</td>
              <td>
                {s.public_advisory && (
                  <a href={s.public_advisory} target="_blank" rel="noopener noreferrer" className="text-[color:var(--color-accent)]">
                    <ExternalLink size={12} />
                  </a>
                )}
              </td>
            </tr>
          ))}
          cols={["ID", "Name", "Class", "Dist", ""]}
        />
      )}
      {hazards.buoy?.buoy && (
        <div className="mt-3 border border-[color:var(--color-border)] rounded bg-[color:var(--color-surface-2)] p-3">
          <div className="text-[0.72rem] text-[color:var(--color-fg-muted)] mb-1.5">
            Nearest NDBC buoy · <span className="font-mono text-[color:var(--color-fg)]">{hazards.buoy.buoy.id}</span> · {hazards.buoy.buoy.name} · {hazards.buoy.buoy.distance_km} km
          </div>
          {hazards.buoy.obs ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[0.8rem]">
              <BuoyMetric label="Wind" value={hazards.buoy.obs.wind_kt != null ? `${hazards.buoy.obs.wind_kt} kt @ ${hazards.buoy.obs.wind_dir_deg ?? "—"}°` : "—"} />
              <BuoyMetric label="Gust" value={hazards.buoy.obs.gust_kt != null ? `${hazards.buoy.obs.gust_kt} kt` : "—"} />
              <BuoyMetric label="Pressure" value={hazards.buoy.obs.pres_inhg != null ? `${hazards.buoy.obs.pres_inhg} inHg` : "—"} />
              <BuoyMetric label="Air / Water" value={hazards.buoy.obs.air_f != null ? `${hazards.buoy.obs.air_f}°F / ${hazards.buoy.obs.water_f ?? "—"}°F` : "—"} />
            </div>
          ) : (
            <div className="text-[0.75rem] text-[color:var(--color-fg-dim)]">Realtime2 feed unreachable.</div>
          )}
        </div>
      )}
      {hazards.notams.configured && hazards.notams.count > 0 && (
        <HazardBlock
          title={`FAA NOTAM · ${hazards.notams.count} active · ${hazards.notams.equipment_out} equipment-U/S · ${hazards.notams.asos_related} weather-related`}
          rows={hazards.notams.items.map((n, i) => (
            <tr key={`${n.number}-${i}`}>
              <td className="font-mono">{n.number}</td>
              <td>{n.type}</td>
              <td className="text-[0.72rem]">{(n.text || "").slice(0, 140)}</td>
            </tr>
          ))}
          cols={["Number", "Type", "Text"]}
        />
      )}
    </div>
  );
}

function HazardBlock({ title, cols, rows }: { title: string; cols: string[]; rows: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="text-[0.72rem] text-[color:var(--color-fg-muted)] mb-1.5">{title}</div>
      <div className="border border-[color:var(--color-border)] rounded overflow-hidden">
        <table className="owl-table">
          <thead>
            <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );
}

function BuoyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="noc-label text-[0.6rem] mb-0.5">{label}</div>
      <div className="font-mono text-[color:var(--color-fg)]">{value}</div>
    </div>
  );
}

// -- URL builders (client-side, no round-trip for a static URL) -------------

function goesLoopFor(lat: number, lon: number): { url: string; label: string } {
  const base18 = "https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR";
  const base19 = "https://cdn.star.nesdis.noaa.gov/GOES19/ABI";
  const g18 = (s: string, size = "600x600") => `${base18}/${s}/GEOCOLOR/GOES18-${s.toUpperCase()}-GEOCOLOR-${size}.gif`;
  const g19 = (s: string) => `${base19}/SECTOR/${s}/GEOCOLOR/GOES19-${s.toUpperCase()}-GEOCOLOR-600x600.gif`;
  const conus = `${base19}/CONUS/GEOCOLOR/GOES19-CONUS-GEOCOLOR-625x375.gif`;
  if (16 <= lat && lat <= 20 && -68 <= lon && lon <= -63) return { url: g19("pr"), label: "GOES-19 PR" };
  if (18 <= lat && lat <= 23 && -162 <= lon && lon <= -154) return { url: g18("hi"), label: "GOES-18 HI" };
  if (lat >= 50 && lon <= -130) return { url: g18("ak", "1000x1000"), label: "GOES-18 AK" };
  if (40 <= lat && lat <= 50 && -130 <= lon && lon <= -116) return { url: g18("pnw"), label: "GOES-18 PNW" };
  if (30 <= lat && lat <= 40 && -125 <= lon && lon <= -114) return { url: g18("psw"), label: "GOES-18 PSW" };
  if (36 <= lat && lat <= 48 && -85 <= lon && lon <= -65) return { url: g19("ne"), label: "GOES-19 NE" };
  if (24 <= lat && lat <= 37 && -92 <= lon && lon <= -75) return { url: g19("se"), label: "GOES-19 SE" };
  if (38 <= lat && lat <= 50 && -100 <= lon && lon <= -85) return { url: g19("umv"), label: "GOES-19 UMV" };
  if (28 <= lat && lat <= 38 && -100 <= lon && lon <= -85) return { url: g19("smv"), label: "GOES-19 SMV" };
  if (40 <= lat && lat <= 50 && -120 <= lon && lon <= -100) return { url: g19("nr"), label: "GOES-19 NR" };
  if (30 <= lat && lat <= 40 && -120 <= lon && lon <= -100) return { url: g19("sr"), label: "GOES-19 SR" };
  return { url: conus, label: "GOES-19 CONUS" };
}

/** Nearest-WSR-88D URL builder. Hard-coded shortlist of majors; anything
 *  outside range falls back to the national composite. A full 159-site
 *  catalog is on the server (`lib/server/stations.ts`) but we avoid a
 *  round-trip for this common lookup. */
function stationRadarLoop(
  lat: number, lon: number,
): { url: string; site?: string; km?: number; fallback: boolean } {
  const SITES: Array<[string, number, number]> = [
    ["KOKX", 40.87, -72.86], ["KDIX", 39.95, -74.41], ["KLWX", 38.98, -77.48],
    ["KBOX", 41.96, -71.14], ["KBUF", 42.95, -78.74], ["KBGM", 42.20, -75.98],
    ["KFFC", 33.36, -84.57], ["KBMX", 33.17, -86.77], ["KOHX", 36.25, -86.56],
    ["KTBW", 27.71, -82.40], ["KAMX", 25.61, -80.41], ["KJAX", 30.48, -81.70],
    ["KLOT", 41.60, -88.08], ["KDTX", 42.70, -83.47], ["KMKX", 42.97, -88.55],
    ["KFWS", 32.57, -97.30], ["KHGX", 29.47, -95.08], ["KLCH", 30.13, -93.21],
    ["KFTG", 39.79, -104.55], ["KMTX", 41.26, -112.45], ["KMUX", 37.15, -121.89],
    ["KNKX", 32.91, -117.04], ["KATX", 48.19, -122.49], ["KRTX", 45.71, -122.96],
    ["KMAX", 42.08, -122.72], ["KABX", 35.15, -106.82], ["PHKM", 20.13, -155.78],
    ["PHKI", 21.89, -159.55], ["PHWA", 19.10, -155.57], ["PAIH", 59.46, -146.30],
    ["PAHG", 60.73, -151.35], ["PACG", 56.85, -135.53], ["TJUA", 18.12, -66.08],
  ];
  let best: [string, number, number] | null = null;
  let bestD = Infinity;
  for (const s of SITES) {
    const dlat = lat - s[1];
    const dlon = (lon - s[2]) * Math.cos((lat + s[1]) * Math.PI / 360);
    const d = Math.hypot(dlat, dlon) * 111;
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best || bestD > 400) {
    return { url: "https://radar.weather.gov/ridge/standard/CONUS_0.gif", fallback: true };
  }
  return {
    url: `https://radar.weather.gov/ridge/standard/${best[0]}_loop.gif`,
    site: best[0],
    km: Math.round(bestD * 10) / 10,
    fallback: false,
  };
}

// -- Decoded METAR block ----------------------------------------------------

function DecodedMetarBlock({ metar, loading }: { metar: StationMetarResponse | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="mb-5">
        <div className="noc-h3 mb-2">Current Observation</div>
        <div className="text-[0.78rem] text-[color:var(--color-fg-dim)]">Decoding latest METAR…</div>
      </div>
    );
  }
  if (!metar?.decoded) {
    return (
      <div className="mb-5">
        <div className="noc-h3 mb-2">Current Observation</div>
        <div className="text-[0.78rem] text-[color:var(--color-fg-dim)]">
          {metar?.error ?? "No recent METAR available."}
        </div>
      </div>
    );
  }

  const d = metar.decoded;
  const cat = d.flight_category;
  const catPill =
    cat === "VFR"   ? "owl-pill owl-pill-ok"   :
    cat === "MVFR"  ? "owl-pill owl-pill-info" :
    cat === "IFR"   ? "owl-pill owl-pill-warn" :
    cat === "LIFR"  ? "owl-pill owl-pill-crit" :
                      "owl-pill owl-pill-dim";

  const windStr = d.wind
    ? formatWind(d.wind)
    : "—";
  const vis = d.visibility_text ?? (d.visibility_sm != null ? `${d.visibility_sm} SM` : "—");
  const temp = d.temperature_f != null ? `${d.temperature_f.toFixed(0)}°F / ${d.temperature_c?.toFixed(1)}°C` : "—";
  const dew  = d.dewpoint_f != null ? `${d.dewpoint_f.toFixed(0)}°F / ${d.dewpoint_c?.toFixed(1)}°C` : "—";
  const alti = d.altimeter_inhg != null
    ? `${d.altimeter_inhg.toFixed(2)} inHg / ${d.altimeter_hpa?.toFixed(0)} hPa`
    : "—";
  const ceil = d.ceiling_ft != null ? `${d.ceiling_ft.toLocaleString()} ft` : "—";
  const whenStr = d.observed_at ? new Date(d.observed_at).toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, "Z") : "—";

  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-baseline gap-3">
          <div className="noc-h3 m-0">Current Observation</div>
          {cat && <span className={catPill}>{cat}</span>}
        </div>
        <div className="text-[0.68rem] text-[color:var(--color-fg-dim)]">
          Observed {whenStr} · source: {metar.source === "scan_cache" ? "scan cache" : "IEM live"}
        </div>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Metric label="Wind"      value={windStr} />
        <Metric label="Visibility" value={vis} />
        <Metric label="Temp / Dew" value={`${d.temperature_f?.toFixed(0) ?? "—"}° / ${d.dewpoint_f?.toFixed(0) ?? "—"}°F`} sub={`${d.temperature_c?.toFixed(1) ?? "—"} / ${d.dewpoint_c?.toFixed(1) ?? "—"} °C`} />
        <Metric label="Altimeter" value={d.altimeter_inhg != null ? `${d.altimeter_inhg.toFixed(2)} inHg` : "—"} sub={d.altimeter_hpa != null ? `${d.altimeter_hpa.toFixed(0)} hPa` : undefined} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <Metric label="Sky"      value={d.sky_summary ?? "—"} />
        <Metric label="Ceiling"  value={ceil} />
        <Metric label="Weather"  value={d.weather.length ? d.weather.map((w) => w.text).join(" · ") : "None reported"} />
      </div>

      {/* Maintenance reasons */}
      {d.has_maintenance && d.maintenance_reasons.length > 0 && (
        <div className="mb-3 border-l-2 border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)] px-3 py-2 rounded-r">
          <div className="text-[0.68rem] uppercase tracking-wider text-[color:var(--color-warn)] font-semibold mb-1">
            Maintenance flag ($) active
          </div>
          <ul className="space-y-1 text-[0.78rem] text-[color:var(--color-fg)]">
            {d.maintenance_reasons.map((r, i) => (
              <li key={i}>
                <span className="font-semibold">{r.sensor}</span>
                <span className="text-[color:var(--color-fg-muted)]"> — {r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Raw + remarks */}
      <details className="text-[0.74rem]">
        <summary className="cursor-pointer text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]">
          Raw METAR {alti !== "—" ? "· altimeter " + alti : ""}
        </summary>
        <pre className="mt-2 p-2 rounded bg-[color:var(--color-bg)] border border-[color:var(--color-border)] font-mono text-[0.74rem] text-[color:var(--color-fg)] whitespace-pre-wrap break-all">
          {d.raw}
        </pre>
        {d.remarks && (
          <div className="mt-2 text-[color:var(--color-fg-muted)]">
            <span className="noc-label">Remarks</span>
            <div className="font-mono mt-1 break-all">{d.remarks}</div>
          </div>
        )}
      </details>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-[color:var(--color-border)] rounded bg-[color:var(--color-surface-2)] px-3 py-2">
      <div className="noc-label text-[0.62rem] mb-0.5">{label}</div>
      <div className="text-[color:var(--color-fg)] text-[0.88rem] font-mono leading-tight">{value}</div>
      {sub && <div className="text-[0.68rem] text-[color:var(--color-fg-dim)] mt-0.5 font-mono">{sub}</div>}
    </div>
  );
}

function formatWind(w: DecodedMetarClient["wind"]): string {
  if (!w) return "—";
  if (w.speed_kt === 0 || (w.direction === 0 && w.speed_kt === 0)) return "Calm";
  const dir = w.direction === "VRB" ? "VRB" : w.direction !== null ? `${String(w.direction).padStart(3, "0")}°` : "—";
  const spd = w.speed_kt !== null ? `${w.speed_kt} kt` : "—";
  const gust = w.gust_kt !== null ? ` G ${w.gust_kt} kt` : "";
  const vary = w.variable_from !== null && w.variable_to !== null
    ? ` (${String(w.variable_from).padStart(3, "0")}–${String(w.variable_to).padStart(3, "0")}°)` : "";
  return `${dir} @ ${spd}${gust}${vary}`;
}

// -- Overhead Imagery (NASA Worldview / GIBS + STAC Sentinel-2 + Landsat) ---

function OverheadImagery({ imagery, loading }: { imagery: ImageryResponse | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="mb-5">
        <div className="noc-h3 mb-2">Overhead Imagery</div>
        <div className="text-[0.78rem] text-[color:var(--color-fg-dim)]">Querying NASA / Element84 STAC…</div>
      </div>
    );
  }
  if (!imagery) {
    return (
      <div className="mb-5">
        <div className="noc-h3 mb-2">Overhead Imagery</div>
        <div className="text-[0.78rem] text-[color:var(--color-fg-dim)]">No imagery available.</div>
      </div>
    );
  }

  const gibsToday = imagery.gibs[0]; // MODIS Terra true-color today
  const s2 = imagery.sentinel2[0];
  const ls = imagery.landsat[0];

  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between flex-wrap mb-2 gap-2">
        <div className="noc-h3 m-0">Overhead Imagery</div>
        <div className="text-[0.62rem] text-[color:var(--color-fg-dim)]">
          NASA GIBS · Sentinel-2 · Landsat-9 · ≤30% cloud filter
        </div>
      </div>

      {/* 3 tiles: GIBS today + Sentinel-2 latest + Landsat latest */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <ImageryTile
          title="MODIS true-color"
          subtitle={`Today · ${gibsToday?.date ?? "—"}`}
          src={gibsToday?.url}
          alt="NASA MODIS Terra true-color"
          link={imagery.links.nasa_worldview}
          linkLabel="Open in NASA Worldview"
        />
        <ImageryTile
          title="Sentinel-2 (latest)"
          subtitle={s2 ? `${s2.datetime.slice(0, 10)} · ${s2.cloud_cover != null ? `${s2.cloud_cover.toFixed(0)}% cloud` : "—"}` : "no recent low-cloud scene"}
          src={s2?.thumbnail_url ?? undefined}
          alt={s2?.id || "Sentinel-2 scene"}
          link={imagery.links.copernicus_browser}
          linkLabel="Open in Copernicus Browser"
        />
        <ImageryTile
          title="Landsat-9 (latest)"
          subtitle={ls ? `${ls.datetime.slice(0, 10)} · ${ls.cloud_cover != null ? `${ls.cloud_cover.toFixed(0)}% cloud` : "—"}` : "no recent low-cloud scene"}
          src={ls?.thumbnail_url ?? undefined}
          alt={ls?.id || "Landsat scene"}
          link={`https://landsatlook.usgs.gov/stac-browser/collections/landsat-c2l2-sr/items/${ls?.id}`}
          linkLabel="Open in USGS Landsat Look"
        />
      </div>

      {/* External viewer chips */}
      <div className="flex flex-wrap gap-2 text-[0.7rem]">
        <span className="text-[color:var(--color-fg-muted)] mr-1">Open in:</span>
        <ViewerChip href={imagery.links.nasa_worldview}     label="NASA Worldview" />
        <ViewerChip href={imagery.links.copernicus_browser} label="Copernicus" />
        <ViewerChip href={imagery.links.sentinel_hub}       label="Sentinel Hub" />
        <ViewerChip href={imagery.links.eosda_landviewer}   label="EOSDA LandViewer" />
        <ViewerChip href={imagery.links.zoom_earth}         label="Zoom Earth" />
      </div>
    </div>
  );
}

function ImageryTile({ title, subtitle, src, alt, link, linkLabel }: {
  title: string;
  subtitle: string;
  src: string | undefined;
  alt: string;
  link?: string;
  linkLabel?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="noc-h3 text-[0.62rem]">{title}</div>
        <span className="text-[0.6rem] text-[color:var(--color-fg-dim)]">{subtitle}</span>
      </div>
      <div
        className="relative w-full overflow-hidden rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)]"
        style={{ aspectRatio: "1 / 1" }}
      >
        {src ? (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[color:var(--color-fg-dim)] text-xs text-center px-3">
            No scene available
          </div>
        )}
      </div>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[0.66rem] mt-1 inline-flex items-center gap-1 text-[color:var(--color-accent)] hover:underline"
        >
          {linkLabel ?? "Open"} <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

function ViewerChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] hover:border-[color:var(--color-accent)]"
    >
      {label} <ExternalLink size={9} />
    </a>
  );
}
