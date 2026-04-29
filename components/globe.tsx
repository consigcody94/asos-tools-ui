"use client";

/** Globe.gl wrapper as a first-class React component.
 *
 *  Three.js + Globe.gl are loaded dynamically on the client only — the
 *  module is large (~1.1 MB) and the entire scene needs WebGL, so SSR
 *  would be wasted bytes.  We hand the underlying instance back via
 *  `onReady` so parent components (drill panel, region presets) can
 *  drive the camera without re-mounting.
 *
 *  No iframe. No postMessage bridge. Direct prop binding the way React
 *  is meant to be used.
 */

import { useEffect, useRef, useState } from "react";

export interface GlobePoint {
  lat: number;
  lng: number;
  size?: number;
  color?: string;
  station: string;
  label?: string;
  altitude?: number;
  kind?: "station" | "satellite" | "event";
}

export interface GlobePath {
  id: string;
  color?: string;
  points: { lat: number; lng: number; altitude?: number }[];
}

interface Props {
  points: GlobePoint[];
  paths?: GlobePath[];
  height?: number;
  className?: string;
  autoRotate?: boolean;
  /** Bumped to trigger a camera flyTo without re-mounting. */
  focus?: { lat: number; lng: number; alt?: number } | null;
  onPointClick?: (p: GlobePoint) => void;
}

export function Globe({
  points,
  paths = [],
  height = 620,
  className,
  autoRotate = false,
  focus = null,
  onPointClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<unknown>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    (async () => {
      const { default: GlobeGL } = await import("globe.gl");
      if (cancelled || !containerRef.current) return;

      // All markers (stations + satellites + events) render via WebGL points.
      // pointsMerge(true) batches the entire 918+12 point set into ONE
      // instanced draw call. With merge=false we were issuing ~930 draw
      // calls per frame, which is what made the user's CPU/GPU melt.
      // Field accessors (lat/lng/altitude/color/size) match globe.gl's
      // default property names so no per-point function dispatch fires.

      const g = new GlobeGL(containerRef.current)
        .backgroundColor("rgba(5, 8, 22, 1)")
        .globeImageUrl(
          "//unpkg.com/three-globe/example/img/earth-blue-marble.jpg",
        )
        .bumpImageUrl(
          "//unpkg.com/three-globe/example/img/earth-topology.png",
        )
        .showAtmosphere(true)
        .atmosphereColor("#38bdf8")
        .atmosphereAltitude(0.18)
        .pointsMerge(true)
        .pointResolution(6)
        .pointsTransitionDuration(0)
        .pointAltitude("altitude")
        .pointRadius("size")
        .pointColor("color")
        .pointsData(points)
        .pathsData(paths)
        .pathPoints("points")
        .pathPointLat("lat")
        .pathPointLng("lng")
        .pathPointAlt("altitude")
        .pathColor((p: unknown) => (p as GlobePath).color ?? "#4da3ff")
        .pathStroke(1.2)
        .pathDashLength(0.42)
        .pathDashGap(0.18)
        .pathDashAnimateTime(9000)
        .pointLabel(
          (p: unknown) => {
            const pt = p as GlobePoint;
            return `<div style="
              font-family: 'Rajdhani', sans-serif;
              background: rgba(11, 18, 32, 0.92);
              border: 1px solid rgba(0, 229, 255, 0.35);
              padding: 6px 10px;
              color: #f1f5f9;">
              <span style="color:#00e5ff;font-weight:700;font-family:'Share Tech Mono',monospace;letter-spacing:0.08em;">
                ${pt.station}
              </span>
              ${pt.label ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${pt.label}</div>` : ""}
            </div>`;
          },
        )
        .onPointClick(
          (p: unknown) => onPointClick?.(p as GlobePoint),
        )
        .pointOfView({ lat: 38, lng: -97, altitude: 2.3 }, 0)
        .width(containerRef.current.clientWidth)
        .height(containerRef.current.clientHeight || height);

      const controls = (g.controls() as { autoRotate: boolean; autoRotateSpeed: number }) || {};
      if (controls) {
        controls.autoRotate = autoRotate;
        controls.autoRotateSpeed = 0.4;
      }

      globeRef.current = g;
      setLoaded(true);

      const onResize = () => {
        if (!containerRef.current) return;
        g.width(containerRef.current.clientWidth);
        g.height(containerRef.current.clientHeight || height);
      };
      window.addEventListener("resize", onResize);

      return () => {
        window.removeEventListener("resize", onResize);
      };
    })();

    return () => {
      cancelled = true;
      // globe.gl has no destroy method, but the canvas + Three resources
      // get garbage collected when the container is removed.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update points without re-mounting the globe.
  useEffect(() => {
    const g = globeRef.current as {
      pointsData: (d: GlobePoint[]) => unknown;
    } | null;
    if (g && loaded) g.pointsData(points);
  }, [points, loaded]);

  useEffect(() => {
    const g = globeRef.current as { pathsData: (d: GlobePath[]) => unknown } | null;
    if (g && loaded) g.pathsData(paths);
  }, [paths, loaded]);

  // Camera flyTo on focus change.
  useEffect(() => {
    if (!focus) return;
    const g = globeRef.current as {
      pointOfView: (
        c: { lat: number; lng: number; altitude: number },
        ms: number,
      ) => unknown;
    } | null;
    g?.pointOfView(
      { lat: focus.lat, lng: focus.lng, altitude: focus.alt ?? 1.1 },
      1500,
    );
  }, [focus]);

  // Toggle rotation on prop change.
  useEffect(() => {
    const g = globeRef.current as {
      controls: () => { autoRotate: boolean };
    } | null;
    const c = g?.controls();
    if (c) c.autoRotate = autoRotate;
  }, [autoRotate]);

  return (
    <div
      ref={containerRef}
      style={{ height: className ? undefined : height, width: "100%", position: "relative" }}
      className={`bg-noc-deep ${className ?? ""}`}
    />
  );
}
