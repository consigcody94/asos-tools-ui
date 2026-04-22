"use client";

/** Station drill panel — opens when a globe point is clicked.
 *  Pulls latest METAR + nearest cams + GOES loop URL from the OWL API.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { OWL_API_BASE, type WeatherCam } from "@/lib/api";

interface Props {
  station: { id: string; lat: number; lng: number; name?: string } | null;
  onClose: () => void;
}

export function DrillPanel({ station, onClose }: Props) {
  const [cams, setCams] = useState<WeatherCam[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!station) return;
    setLoading(true);
    setCams([]);
    const ctrl = new AbortController();

    fetch(
      `${OWL_API_BASE}/api/webcams/near?lat=${station.lat}&lon=${station.lng}&radius_nm=25&limit=4`,
      { signal: ctrl.signal },
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data: WeatherCam[]) => setCams(data || []))
      .catch(() => setCams([]))
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [station]);

  if (!station) return null;

  // Pick a GOES sector for this station's lat/lon (mirrors radar.py routing).
  const goesUrl = goesLoopFor(station.lat, station.lng);

  return (
    <div className="noc-panel mt-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-mono text-2xl text-noc-cyan tracking-[0.1em] drop-shadow-[0_0_10px_rgba(0,229,255,0.5)]">
            {station.id}
          </div>
          {station.name && (
            <div className="noc-label mt-1">{station.name}</div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close drill panel"
          className="text-noc-dim hover:text-noc-cyan p-1"
        >
          <X size={18} />
        </button>
      </div>

      {/* Webcams — 4-up fixed 4:3 grid, no grey-bar dead space */}
      <div className="mb-4">
        <div className="noc-h3 mb-2">Nearest FAA WeatherCams</div>
        {loading && (
          <div className="text-noc-dim text-sm">Loading…</div>
        )}
        {!loading && cams.length === 0 && (
          <div className="text-noc-dim text-sm">
            No FAA WeatherCams within 25 NM.
          </div>
        )}
        {!loading && cams.length > 0 && (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${Math.min(4, cams.length)}, minmax(0, 1fr))` }}
          >
            {cams.slice(0, 4).map((cam) => (
              <CamTile key={cam.id} cam={cam} />
            ))}
          </div>
        )}
      </div>

      {/* GOES loop */}
      <div>
        <div className="noc-h3 mb-2">
          GOES-19 Satellite Loop{" "}
          <span className="text-noc-ok ml-1">· NESDIS LIVE</span>
        </div>
        <div
          className="relative w-full overflow-hidden bg-noc-deep border border-noc-border"
          style={{ aspectRatio: "16 / 9" }}
        >
          <img
            src={goesUrl}
            alt="GOES-19 animated satellite loop"
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      </div>
    </div>
  );
}

function CamTile({ cam }: { cam: WeatherCam }) {
  const imgUrl = `${OWL_API_BASE}/api/webcams/${cam.id}/latest.jpg`;
  return (
    <figure className="m-0 p-0">
      <div
        className="relative overflow-hidden border border-noc-border bg-noc-deep"
        style={{ aspectRatio: "4 / 3" }}
      >
        <img
          src={imgUrl}
          alt={cam.site_name}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
      <figcaption className="text-[11px] leading-tight mt-1 text-noc-muted">
        <strong className="text-noc-text">{cam.site_name}</strong>{" "}
        · {cam.direction} · {cam.distance_nm} NM
      </figcaption>
    </figure>
  );
}

/** Geographic routing identical to asos_tools/radar.py::goes_loop_for_station */
function goesLoopFor(lat: number, lon: number): string {
  const base = "https://cdn.star.nesdis.noaa.gov/GOES19/ABI";
  const conus = `${base}/CONUS/GEOCOLOR/GOES19-CONUS-GEOCOLOR-625x375.gif`;
  const sector = (s: string) =>
    `${base}/SECTOR/${s}/GEOCOLOR/GOES19-${s.toUpperCase()}-GEOCOLOR-600x600.gif`;

  if (16 <= lat && lat <= 20 && -68 <= lon && lon <= -63) return sector("pr");
  if (18 <= lat && lat <= 23 && -162 <= lon && lon <= -154) return sector("sp");
  if (lat >= 50 && lon <= -130) return conus;          // AK fallback
  if (36 <= lat && lat <= 48 && -85 <= lon && lon <= -65) return sector("ne");
  if (24 <= lat && lat <= 37 && -92 <= lon && lon <= -75) return sector("se");
  if (38 <= lat && lat <= 50 && -100 <= lon && lon <= -85) return sector("umv");
  if (28 <= lat && lat <= 38 && -100 <= lon && lon <= -85) return sector("smv");
  if (40 <= lat && lat <= 50 && -120 <= lon && lon <= -100) return sector("nr");
  if (30 <= lat && lat <= 40 && -120 <= lon && lon <= -100) return sector("sr");
  return conus;
}
