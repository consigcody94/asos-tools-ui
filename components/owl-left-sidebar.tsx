"use client";

import { useEffect, useRef } from "react";
import { Search, MapPinned, RotateCcw, Filter } from "lucide-react";
import { usePersistedState } from "@/lib/use-persisted-state";

export interface OwlFilterState {
  search: string;
  region: string;       // id from REGIONS
  onlyDown: boolean;    // hide UP rows
  rotationOn: boolean;
  rotationPauseSec: number;
  programs: { ASOS: boolean; AWIPS: boolean; BUOY: boolean; FACILITY: boolean; NWR: boolean; RADAR: boolean; UPPERAIR: boolean };
  overlays: {
    radar: boolean; radarOpacity: number;
    wwa: boolean;
    wfo: boolean;
    rfc: boolean;
    cwsu: boolean;
    timezones: boolean;
  };
  projection: "mercator" | "globe";
}

export const DEFAULT_FILTERS: OwlFilterState = {
  search: "",
  region: "conus",
  onlyDown: false,
  rotationOn: false,
  rotationPauseSec: 5,
  programs: { ASOS: true, AWIPS: false, BUOY: false, FACILITY: false, NWR: false, RADAR: false, UPPERAIR: false },
  overlays: {
    radar: false, radarOpacity: 0.6,
    wwa: false, wfo: false, rfc: false, cwsu: false, timezones: false,
  },
  projection: "mercator",
};

export const REGIONS = [
  { id: "conus", label: "CONUS", lat: 38, lng: -97, alt: 2.3 },
  { id: "ne",    label: "NE",    lat: 42, lng: -72, alt: 1.1 },
  { id: "se",    label: "SE",    lat: 32, lng: -84, alt: 1.1 },
  { id: "ctrl",  label: "CTRL",  lat: 41, lng: -93, alt: 1.1 },
  { id: "west",  label: "West",  lat: 38, lng: -110, alt: 1.1 },
  { id: "ak",    label: "AK",    lat: 64, lng: -150, alt: 1.0 },
  { id: "hi",    label: "HI",    lat: 20.7, lng: -157, alt: 0.7 },
  { id: "carib", label: "PR",    lat: 18, lng: -66, alt: 0.7 },
];

interface Props {
  onRegion: (lat: number, lng: number, alt: number) => void;
  onResetMap: () => void;
}

export function useOwlFilters() {
  return usePersistedState<OwlFilterState>("owl-filters", DEFAULT_FILTERS);
}

export function OwlLeftSidebar({
  filters, setFilters, onRegion, onResetMap,
}: Props & {
  filters: OwlFilterState;
  setFilters: (v: OwlFilterState | ((p: OwlFilterState) => OwlFilterState)) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  // `/` focuses the search input (NWS Status Map convention).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "/") { searchRef.current?.focus(); e.preventDefault(); }
      if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) onResetMap();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResetMap]);

  function patch(p: Partial<OwlFilterState>) {
    setFilters((prev) => ({ ...prev, ...p }));
  }

  function reset() {
    setFilters(DEFAULT_FILTERS);
    onRegion(REGIONS[0].lat, REGIONS[0].lng, REGIONS[0].alt);
  }

  return (
    <aside className="flex flex-col gap-3 text-sm">
      <Card title="Search" icon={<Search size={12} />}>
        <input
          ref={searchRef}
          type="search"
          value={filters.search}
          onChange={(e) => patch({ search: e.target.value })}
          placeholder="PID / SID / WFO / city / state…"
          className="w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 font-mono text-[0.74rem] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-dim)] focus:border-[color:var(--color-accent)] focus:outline-none"
        />
        <p className="mt-1 text-[0.62rem] text-[color:var(--color-fg-muted)]">Press <kbd>/</kbd> to focus</p>
      </Card>

      <Card title="Filters" icon={<Filter size={12} />}>
        <CheckRow
          checked={filters.onlyDown}
          onChange={(v) => patch({ onlyDown: v })}
          label="Show only Down / Degraded"
        />
        <CheckRow
          checked={filters.rotationOn}
          onChange={(v) => patch({ rotationOn: v })}
          label="Timed Rotation by Program"
        />
        {filters.rotationOn && (
          <div className="ml-5 mt-1 flex items-center gap-2 text-[0.7rem] text-[color:var(--color-fg-muted)]">
            <span>Pause</span>
            <input
              type="number"
              min={1}
              max={60}
              value={filters.rotationPauseSec}
              onChange={(e) => patch({ rotationPauseSec: Math.max(1, Math.min(60, Number(e.target.value) || 5)) })}
              className="w-14 rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-1 py-0.5 font-mono"
            />
            <span>seconds</span>
          </div>
        )}
      </Card>

      <Card title="View">
        <div className="flex gap-1">
          <button
            onClick={() => patch({ projection: "mercator" })}
            className={`noc-btn flex-1 px-2 py-1 text-[0.66rem] ${filters.projection === "mercator" ? "noc-btn-primary" : ""}`}
            title="Flat Web-Mercator map (CONUS-friendly)"
          >2D Map</button>
          <button
            onClick={() => patch({ projection: "globe" })}
            className={`noc-btn flex-1 px-2 py-1 text-[0.66rem] ${filters.projection === "globe" ? "noc-btn-primary" : ""}`}
            title="3D orthographic globe (natural Earth)"
          >3D Globe</button>
        </div>
      </Card>

      <Card title="Region" icon={<MapPinned size={12} />}>
        <div className="flex flex-wrap gap-1">
          {REGIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => { patch({ region: r.id }); onRegion(r.lat, r.lng, r.alt); }}
              className={`noc-btn px-2 py-1 text-[0.66rem] ${filters.region === r.id ? "noc-btn-primary" : ""}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Programs">
        <div className="space-y-1">
          <ProgramCheck
            label="ASOS"
            checked={filters.programs.ASOS}
            onChange={(v) => patch({ programs: { ...filters.programs, ASOS: v } })}
          />
          <ProgramCheck
            label="RADAR (NEXRAD)"
            checked={filters.programs.RADAR}
            onChange={(v) => patch({ programs: { ...filters.programs, RADAR: v } })}
          />
          <ProgramCheck
            label="Buoys (NDBC)"
            checked={filters.programs.BUOY}
            onChange={(v) => patch({ programs: { ...filters.programs, BUOY: v } })}
          />
          <ProgramCheck
            label="NWR"
            checked={filters.programs.NWR}
            onChange={(v) => patch({ programs: { ...filters.programs, NWR: v } })}
          />
          <ProgramCheck
            label="Upper Air"
            checked={filters.programs.UPPERAIR}
            onChange={(v) => patch({ programs: { ...filters.programs, UPPERAIR: v } })}
          />
          <ProgramCheck label="AWIPS" disabled hint="awaiting feed" />
          <ProgramCheck label="Facility (NCO WAN)" disabled hint="awaiting feed" />
        </div>
      </Card>

      <Card title="Overlays">
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-[0.74rem]">
            <input
              type="checkbox"
              checked={filters.overlays.radar}
              onChange={(e) => patch({ overlays: { ...filters.overlays, radar: e.target.checked } })}
            />
            <span className="text-[color:var(--color-fg)]">Radar Base Reflectivity</span>
          </label>
          {filters.overlays.radar && (
            <div className="ml-5 flex items-center gap-2 text-[0.66rem] text-[color:var(--color-fg-muted)]">
              <span>Opacity</span>
              <input
                type="range"
                min={0.1} max={1} step={0.05}
                value={filters.overlays.radarOpacity}
                onChange={(e) => patch({ overlays: { ...filters.overlays, radarOpacity: Number(e.target.value) } })}
                className="flex-1"
              />
              <span className="w-8 text-right">{Math.round(filters.overlays.radarOpacity * 100)}%</span>
            </div>
          )}
          <OverlayCheck label="WWA (active alerts)" k="wwa" filters={filters} patch={patch} />
          <OverlayCheck label="Time Zones" k="timezones" filters={filters} patch={patch} />
          {/* WFO / RFC / CWSU public ArcGIS endpoints are currently 404
              upstream — leaving these disabled until we host static
              GeoJSON ourselves or NWS republishes the layers. */}
          <ProgramCheck label="WFO Footprints" disabled hint="upstream unavailable" />
          <ProgramCheck label="RFC Boundaries" disabled hint="upstream unavailable" />
          <ProgramCheck label="CWSU Boundaries" disabled hint="upstream unavailable" />
        </div>
      </Card>

      <button
        onClick={reset}
        className="noc-btn flex items-center justify-center gap-1 px-2 py-1.5 text-[0.7rem]"
      >
        <RotateCcw size={11} /> Reset filters
      </button>
    </aside>
  );
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)]">
      <header className="flex items-center gap-1.5 border-b border-[color:var(--color-border)] px-2.5 py-1.5 text-[0.62rem] uppercase tracking-[0.16em] text-[color:var(--color-fg-muted)]">
        {icon}
        <span>{title}</span>
      </header>
      <div className="px-2.5 py-2">{children}</div>
    </section>
  );
}

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-[0.74rem]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-[color:var(--color-fg)]">{label}</span>
    </label>
  );
}

type OverlayKey = "wwa" | "wfo" | "rfc" | "cwsu" | "timezones";

function OverlayCheck({
  label, k, filters, patch,
}: {
  label: string;
  k: OverlayKey;
  filters: OwlFilterState;
  patch: (p: Partial<OwlFilterState>) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[0.74rem]">
      <input
        type="checkbox"
        checked={filters.overlays[k]}
        onChange={(e) => patch({ overlays: { ...filters.overlays, [k]: e.target.checked } })}
      />
      <span className="text-[color:var(--color-fg)]">{label}</span>
    </label>
  );
}

function ProgramCheck({
  label, checked, onChange, disabled, hint,
}: { label: string; checked?: boolean; onChange?: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex items-center justify-between gap-2 py-0.5 text-[0.74rem] ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <span className="flex items-center gap-2">
        <input type="checkbox" disabled={disabled} checked={checked ?? false} onChange={(e) => onChange?.(e.target.checked)} />
        <span className="text-[color:var(--color-fg)]">{label}</span>
      </span>
      {disabled && <span className="text-[0.62rem] text-[color:var(--color-fg-muted)]">{hint}</span>}
    </label>
  );
}
