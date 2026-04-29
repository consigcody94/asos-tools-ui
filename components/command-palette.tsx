"use client";

/** Command palette — press ⌘K / Ctrl-K to open.
 *  Fuzzy-search for stations + instant nav to tabs.
 *  Keeps everything server-fetched (hits /api/stations/search on input).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, X } from "lucide-react";

interface StationHit { id: string; name: string; state: string; lat: number; lon: number }
type Hit =
  | { kind: "nav"; label: string; href: string; hint?: string }
  | { kind: "station"; station: StationHit };

const NAV_HITS: Hit[] = [
  { kind: "nav", label: "Summary",      href: "/",            hint: "global network health" },
  { kind: "nav", label: "AOMC",         href: "/aomc",        hint: "per-station watchlist" },
  { kind: "nav", label: "Forecasters",  href: "/forecasters", hint: "SIGMET / AIRMET / PIREP / AFD" },
  { kind: "nav", label: "NOAA Atlas",   href: "/noaa",        hint: "government APIs + modernization queue" },
  { kind: "nav", label: "Reports",      href: "/reports",     hint: "CSV + PNG exports" },
  { kind: "nav", label: "Stations",     href: "/stations",    hint: "920-station directory" },
  { kind: "nav", label: "Admin",        href: "/admin",       hint: "sources + scheduler" },
  { kind: "nav", label: "About",        href: "/about",       hint: "architecture + credits" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>(NAV_HITS);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Global hotkey.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input when the palette opens.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
    else { setQ(""); setActive(0); }
  }, [open]);

  // Fuzzy station search — debounced via requestIdleCallback-style timeout.
  useEffect(() => {
    const s = q.trim();
    if (!s) { setHits(NAV_HITS); setActive(0); return; }
    // Match nav items first.
    const navMatches = NAV_HITS.filter((n) =>
      n.kind === "nav" && n.label.toLowerCase().includes(s.toLowerCase()),
    );
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/stations/search?q=${encodeURIComponent(s)}&limit=15`);
        const list = r.ok ? (await r.json()) : [];
        if (cancelled) return;
        const sh: Hit[] = (list as StationHit[]).map((st) => ({ kind: "station", station: st }));
        setHits([...navMatches, ...sh]);
        setActive(0);
      } catch { /* ignore */ }
    }, 120);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q]);

  const jump = useCallback((h: Hit) => {
    setOpen(false);
    if (h.kind === "nav") router.push(h.href);
    else router.push(`/stations?focus=${encodeURIComponent(h.station.id)}`);
  }, [router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh] px-4"
      style={{ background: "rgba(5, 8, 22, 0.75)", backdropFilter: "blur(3px)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[640px] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[color:var(--color-border)]">
          <Search size={15} className="text-[color:var(--color-fg-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search stations (ICAO / name) or jump to a tab…"
            className="flex-1 bg-transparent outline-none text-[color:var(--color-fg)] text-[0.95rem] placeholder:text-[color:var(--color-fg-dim)]"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); if (hits[active]) jump(hits[active]); }
            }}
          />
          <button onClick={() => setOpen(false)} className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[55vh] overflow-y-auto">
          {hits.length === 0 && (
            <div className="px-4 py-6 text-center text-[color:var(--color-fg-muted)] text-sm">No matches.</div>
          )}
          {hits.map((h, i) => {
            const isActive = i === active;
            const key = h.kind === "nav" ? `nav-${h.href}` : `st-${h.station.id}`;
            return (
              <button
                key={key}
                onClick={() => jump(h)}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left text-sm border-b border-[color:var(--color-border)] transition-colors ${
                  isActive ? "bg-[color:var(--color-accent-soft)]" : "hover:bg-[color:var(--color-surface-2)]"
                }`}
              >
                {h.kind === "nav" ? (
                  <>
                    <div className="flex items-baseline gap-3">
                      <span className="owl-pill owl-pill-info">NAV</span>
                      <span className="text-[color:var(--color-fg)] font-medium">{h.label}</span>
                      {h.hint && <span className="text-[color:var(--color-fg-dim)] text-xs">{h.hint}</span>}
                    </div>
                    {isActive && <CornerDownLeft size={12} className="text-[color:var(--color-fg-muted)]" />}
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-3 min-w-0">
                      <span className="owl-pill owl-pill-dim font-mono">{h.station.id}</span>
                      <span className="text-[color:var(--color-fg)] truncate">{h.station.name}</span>
                      {h.station.state && <span className="text-[color:var(--color-fg-dim)] text-xs">{h.station.state}</span>}
                    </div>
                    {isActive && <CornerDownLeft size={12} className="text-[color:var(--color-fg-muted)]" />}
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-[color:var(--color-border)] flex items-center justify-between text-[0.68rem] text-[color:var(--color-fg-dim)]">
          <div className="flex items-center gap-3">
            <Kbd>↑</Kbd><Kbd>↓</Kbd> navigate
            <span className="mx-1">·</span>
            <Kbd>Enter</Kbd> jump
            <span className="mx-1">·</span>
            <Kbd>Esc</Kbd> close
          </div>
          <span>{hits.length} result{hits.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-[0.62rem] font-mono text-[color:var(--color-fg-muted)]">
      {children}
    </span>
  );
}

function isTyping(t: EventTarget | null): boolean {
  if (!t) return false;
  const n = t as HTMLElement;
  const tag = n.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || n.isContentEditable;
}
