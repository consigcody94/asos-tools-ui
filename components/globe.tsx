"use client";

/** Flat-map command surface (was a 3D globe).
 *
 *  Operators monitor CONUS + Alaska + Hawaii + the Caribbean — all of
 *  which need to be visible simultaneously. A spinning globe hides
 *  half the network at any time, so we render a 2D Web Mercator map
 *  using MapLibre GL with CartoDB Dark Matter raster tiles.
 *
 *  The exported `Globe` name and Props are preserved so callers
 *  (summary-client.tsx) don't have to change. `paths` and `autoRotate`
 *  are accepted but ignored — paths were satellite orbit tracks (now
 *  disabled) and autoRotate has no analog on a flat map.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export interface GlobePoint {
  lat: number;
  lng: number;
  size?: number;
  color?: string;
  station: string;
  label?: string;
  altitude?: number;     // accepted for shape compatibility, unused on the flat map
  kind?: "station" | "satellite" | "event";
}

export interface GlobePath {
  id: string;
  color?: string;
  points: { lat: number; lng: number; altitude?: number }[];
}

export type MapOverlay =
  | {
      kind?: "raster";
      id: string;
      /** Tile URL template. {z}/{x}/{y} placeholders. */
      tiles: string[];
      opacity?: number;
      visible: boolean;
    }
  | {
      kind: "geojson";
      id: string;
      /** URL returning a FeatureCollection. Fetched once per visible toggle. */
      url: string;
      /** Stroke colour for line rendering. */
      lineColor?: string;
      /** Optional fill colour. Omitted → outline-only. */
      fillColor?: string;
      lineWidth?: number;
      opacity?: number;
      visible: boolean;
    };

interface Props {
  points: GlobePoint[];
  paths?: GlobePath[];   // ignored — kept for prop compatibility
  height?: number;
  className?: string;
  autoRotate?: boolean;  // ignored on flat map
  /** Bumped to recenter without re-mounting. */
  focus?: { lat: number; lng: number; alt?: number } | null;
  onPointClick?: (p: GlobePoint) => void;
  /** Optional raster overlays (radar, etc.). Toggle by setting visible. */
  overlays?: MapOverlay[];
  /** "mercator" (flat 2D) or "globe" (3D orthographic). MapLibre v5+ has
   *  native globe projection — no component swap, just a runtime toggle. */
  projection?: "mercator" | "globe";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SOURCE_ID = "owl-points";
const LAYER_ID = "owl-points-layer";

export function Globe({
  points,
  height = 620,
  className,
  focus = null,
  onPointClick,
  overlays = [],
  projection = "mercator",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  // The click handler is captured once when MapLibre binds the layer
  // event. Without a ref it'd close over stale state from mount.
  const clickRef = useRef<typeof onPointClick>(onPointClick);
  useEffect(() => { clickRef.current = onPointClick; }, [onPointClick]);

  // One-time map setup.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
          },
        },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
        glyphs:
          "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      },
      center: [-97, 38],
      zoom: 3.4,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }),
      "top-right",
    );

    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      className: "owl-map-popup",
    });

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: pointsToGeoJSON(points),
      });
      map.addLayer({
        id: LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            2, ["*", ["get", "size"], 4],
            6, ["*", ["get", "size"], 8],
            10, ["*", ["get", "size"], 14],
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 0.6,
          "circle-stroke-color": "#0b1220",
          "circle-opacity": 0.92,
        },
      });

      map.on("click", LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as GlobePoint;
        // GeoJSON properties round-trip through JSON.stringify, so
        // numeric fields stay numeric but extra keys are preserved.
        clickRef.current?.(props);
      });

      map.on("mouseenter", LAYER_ID, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const p = f.properties as GlobePoint;
        const [lng, lat] = (f.geometry.coordinates as [number, number]);
        const html = `
          <div style="font-family: 'Rajdhani', sans-serif; min-width: 140px;">
            <div style="color:#00e5ff;font-weight:700;font-family:'Share Tech Mono',monospace;letter-spacing:0.08em;">${escapeHtml(p.station)}</div>
            ${p.label ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${escapeHtml(p.label)}</div>` : ""}
          </div>
        `;
        popupRef.current?.setLngLat([lng, lat]).setHTML(html).addTo(map);
      });

      map.on("mouseleave", LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update points data without re-mounting.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(pointsToGeoJSON(points));
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [points]);

  // Recenter on focus changes.
  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [focus.lng, focus.lat],
      zoom: focusToZoom(focus.alt),
      duration: 900,
      essential: true,
    });
  }, [focus]);

  // Switch projection (mercator <-> globe) without re-mounting.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      try {
        // setProjection is a v5+ API; old MapLibre ignores it.
        (map as unknown as { setProjection?: (p: { type: string }) => void })
          .setProjection?.({ type: projection });
      } catch (err) {
        console.warn("[map] setProjection failed:", (err as Error).message);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [projection]);

  // Sync raster + geojson overlays. Each overlay renders below the
  // points layer. Layer naming: ov-line-* for boundaries, ov-fill-*
  // for filled areas, ov-layer-* for raster tiles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = async () => {
      const seen = new Set<string>();
      for (const ov of overlays) {
        const sid = `ov-${ov.id}`;
        seen.add(sid);
        if (!ov.visible) {
          for (const suffix of ["layer", "line", "fill"]) {
            const lid = `ov-${suffix}-${ov.id}`;
            if (map.getLayer(lid)) map.removeLayer(lid);
          }
          if (map.getSource(sid)) map.removeSource(sid);
          continue;
        }
        // RASTER (tile) overlay.
        if (ov.kind !== "geojson") {
          if (!map.getSource(sid)) {
            map.addSource(sid, { type: "raster", tiles: ov.tiles, tileSize: 256 });
            map.addLayer(
              { id: `ov-layer-${ov.id}`, type: "raster", source: sid, paint: { "raster-opacity": ov.opacity ?? 0.7 } },
              map.getLayer(LAYER_ID) ? LAYER_ID : undefined,
            );
          } else {
            map.setPaintProperty(`ov-layer-${ov.id}`, "raster-opacity", ov.opacity ?? 0.7);
          }
          continue;
        }
        // GEOJSON overlay — fetch once on first visibility, then style.
        if (!map.getSource(sid)) {
          try {
            const r = await fetch(ov.url, { cache: "no-store" });
            const data = await r.json();
            map.addSource(sid, { type: "geojson", data });
            if (ov.fillColor) {
              map.addLayer(
                {
                  id: `ov-fill-${ov.id}`, type: "fill", source: sid,
                  paint: { "fill-color": ov.fillColor, "fill-opacity": (ov.opacity ?? 0.4) * 0.6 },
                },
                map.getLayer(LAYER_ID) ? LAYER_ID : undefined,
              );
            }
            map.addLayer(
              {
                id: `ov-line-${ov.id}`, type: "line", source: sid,
                paint: {
                  "line-color": ov.lineColor ?? "#88ccff",
                  "line-width": ov.lineWidth ?? 1.2,
                  "line-opacity": ov.opacity ?? 0.85,
                },
              },
              map.getLayer(LAYER_ID) ? LAYER_ID : undefined,
            );
          } catch (err) {
            console.warn(`[overlay ${ov.id}] fetch failed:`, (err as Error).message);
          }
        } else {
          if (map.getLayer(`ov-line-${ov.id}`)) {
            map.setPaintProperty(`ov-line-${ov.id}`, "line-opacity", ov.opacity ?? 0.85);
          }
          if (map.getLayer(`ov-fill-${ov.id}`)) {
            map.setPaintProperty(`ov-fill-${ov.id}`, "fill-opacity", (ov.opacity ?? 0.4) * 0.6);
          }
        }
      }
      const style = map.getStyle();
      for (const src of Object.keys(style.sources ?? {})) {
        if (src.startsWith("ov-") && !seen.has(src)) {
          for (const suffix of ["layer", "line", "fill"]) {
            const lid = `${suffix === "layer" ? "ov-layer" : "ov-" + suffix}-${src.slice(3)}`;
            if (map.getLayer(lid)) map.removeLayer(lid);
          }
          map.removeSource(src);
        }
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [overlays]);

  return (
    <div
      ref={containerRef}
      style={{ height: className ? undefined : height, width: "100%", position: "relative" }}
      className={`bg-noc-deep ${className ?? ""}`}
    />
  );
}

/** Translate the legacy "altitude" focus param to a Mercator zoom level. */
function focusToZoom(alt: number | undefined): number {
  if (alt == null) return 5.5;
  if (alt >= 2.3) return 3.4;       // CONUS overview
  if (alt >= 1.5) return 4.5;
  if (alt >= 1.1) return 5.5;
  if (alt >= 0.9) return 6.5;
  return 7.5;
}

function pointsToGeoJSON(points: GlobePoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        station: p.station,
        color: p.color ?? "#4da3ff",
        size: p.size ?? 0.4,
        label: p.label ?? "",
        kind: p.kind ?? "station",
      },
    })),
  };
}
