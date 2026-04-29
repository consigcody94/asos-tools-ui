"use client";

import { useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";

/** Modal help panel, opens on `?` keypress, "Help" button, or `:open` prop.
 *  Closes on `Esc` or backdrop click. Mirrors the NWS Status-Map idiom. */
export function HelpOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "?") { setOpen(true); e.preventDefault(); }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Help (press ? )"
        aria-label="Help"
        className="noc-btn flex items-center gap-1 px-2 py-1 text-[0.66rem]"
      >
        <HelpCircle size={12} /> Help
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 sm:p-10"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold tracking-tight text-[color:var(--color-fg)]">OWL — Help</h2>
              <button onClick={() => setOpen(false)} className="noc-btn p-1.5" aria-label="Close help"><X size={14} /></button>
            </div>

            <div className="space-y-4 text-sm text-[color:var(--color-fg-muted)]">
              <Section title="What this app shows">
                Interactive flat map of NOAA / NWS observation network sites with
                status-driven symbology (Up / Degraded / Down / Patching). Right
                sidebar carries the legend, counters, and a Down-Sites table grouped
                by program. Left sidebar carries search, region, and program filters.
              </Section>

              <Section title="Data refresh">
                Point status refreshes every 5 minutes. Source data: ASOS METARs from
                IEM (with AWC fallback), NWS API alerts, NDBC buoys, NEXRAD outage
                index, NWR outage index, and NCO/CO-OPS where applicable. The header
                shows the last successful refresh time and a countdown to the next.
              </Section>

              <Section title="Status meanings">
                <ul className="ml-4 list-disc space-y-1">
                  <li><code className="text-[color:var(--color-ok)]">Up</code> — operational, on cadence</li>
                  <li><code className="text-[color:var(--color-warn)]">Degraded</code> — partial / sensor-flagged / intermittent</li>
                  <li><code className="text-[color:var(--color-crit)]">Down</code> — silent or decommissioned (no METAR &gt; 2h)</li>
                  <li><code className="text-[color:var(--color-info)]">Patching</code> — in security patching window (AWIPS connector required)</li>
                </ul>
              </Section>

              <Section title="Keyboard">
                <ul className="ml-4 list-disc space-y-1">
                  <li><kbd>?</kbd> open help</li>
                  <li><kbd>Esc</kbd> close help / popups</li>
                  <li><kbd>/</kbd> focus the search field</li>
                  <li><kbd>R</kbd> reset map zoom</li>
                </ul>
              </Section>

              <Section title="Filters (left sidebar)">
                Timed Rotation cycles through programs at a configurable pause
                (default 5s). Search supports station ID, name, state, or any
                substring. Region buttons recenter the map. "Show only Down /
                Degraded" hides healthy sites from the map and counters.
              </Section>

              <Section title="Map controls">
                Use mouse wheel / pinch to zoom, drag to pan. The MAP/UI block lets
                you switch basemap, scale fonts and icons, and reset zoom. Overlays
                (radar reflectivity, WFO/RFC/CWSU/MCC boundaries, time zones) can be
                toggled and have an opacity slider each.
              </Section>

              <Section title="Tips">
                <ul className="ml-4 list-disc space-y-1">
                  <li>Click any site for a popup with program info and outage details.</li>
                  <li>Auto-Expand syncs the Down-Sites table with the program rotation.</li>
                  <li>Most filter and panel-collapse states are persisted across reloads.</li>
                  <li>F11 (full-screen) hides the browser chrome for a true command-deck feel.</li>
                </ul>
              </Section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-[0.7rem] uppercase tracking-[0.18em] text-[color:var(--color-accent)]">{title}</h3>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
