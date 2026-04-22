"use client";

/** Persistent left rail with brand mark, network pulse mini-cards, and
 *  the tab navigation.  Uses Next.js `usePathname` so the active tab is
 *  reflected in the URL (deep-linkable, browser-back-able).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowUpRight, BarChart3, Globe, Info, MapPin, Settings, ShieldAlert, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: typeof Globe }[] = [
  { href: "/",            label: "Summary",     icon: Globe },
  { href: "/aomc",        label: "AOMC",        icon: Activity },
  { href: "/forecasters", label: "Forecasters", icon: Cloud },
  { href: "/reports",     label: "Reports",     icon: BarChart3 },
  { href: "/stations",    label: "Stations",    icon: MapPin },
  { href: "/admin",       label: "Admin",       icon: Settings },
  { href: "/about",       label: "About",       icon: Info },
];

interface PulseProps {
  clean: number;
  flagged: number;
  missing: number;
}

export function Sidebar({ pulse }: { pulse?: PulseProps }) {
  const pathname = usePathname();

  return (
    <aside
      className="
        w-[260px] shrink-0 h-dvh sticky top-0
        border-r border-noc-border
        bg-[linear-gradient(180deg,var(--color-noc-panel)_0%,var(--color-noc-deep)_100%)]
        flex flex-col
      "
    >
      {/* Brand */}
      <div className="px-5 pt-6 pb-4 border-b border-noc-border">
        <div className="font-display text-[1.5rem] font-bold tracking-[0.04em] text-noc-cyan drop-shadow-[0_0_10px_rgba(0,229,255,0.45)]">
          O.W.L.
        </div>
        <div className="font-display text-[0.65rem] tracking-[0.36em] uppercase text-noc-cyan opacity-80 mt-1">
          Observation Watch Log
        </div>
        <div className="noc-label mt-3 text-[0.65rem]">
          ASOS network observation monitor
        </div>
      </div>

      {/* Network pulse */}
      {pulse && (
        <div className="px-5 py-4 border-b border-noc-border space-y-3">
          <div className="noc-h3 text-[0.7rem]">Network Pulse</div>
          <div className="grid grid-cols-3 gap-2">
            <PulseCell label="Clean"   value={pulse.clean}   tone="ok"   />
            <PulseCell label="Flagged" value={pulse.flagged} tone="warn" />
            <PulseCell label="Missing" value={pulse.missing} tone="crit" />
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2",
                "font-display uppercase tracking-[0.16em] text-[0.78rem]",
                "border-l-2 transition-all",
                active
                  ? "border-l-noc-cyan bg-[rgba(0,229,255,0.05)] text-noc-text shadow-[inset_0_0_20px_rgba(0,229,255,0.06)]"
                  : "border-l-transparent text-noc-muted hover:text-noc-text hover:bg-[rgba(0,229,255,0.03)] hover:border-l-noc-cyan-dim",
              )}
            >
              <Icon size={14} className={active ? "text-noc-cyan" : ""} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-noc-border">
        <div className="noc-label text-[0.6rem] mb-2">Data Sources</div>
        <div className="text-[0.7rem] text-noc-dim leading-relaxed">
          NCEI · IEM · AWC · NWS · FAA WeatherCams · NESDIS · SWPC
        </div>
        <a
          href="https://huggingface.co/spaces/consgicody/asos-tools"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[0.7rem] text-noc-cyan hover:text-noc-text"
        >
          Streamlit edition <ArrowUpRight size={12} />
        </a>
      </div>
    </aside>
  );
}

function PulseCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "crit";
}) {
  const color =
    tone === "ok"
      ? "var(--color-noc-ok)"
      : tone === "warn"
        ? "var(--color-noc-warn)"
        : "var(--color-noc-crit)";
  return (
    <div className="bg-noc-panel-alt border border-noc-border px-2 py-2">
      <div
        className="text-[0.6rem] uppercase tracking-[0.16em] mb-1 flex items-center gap-1"
        style={{ color }}
      >
        <ShieldAlert size={9} /> {label}
      </div>
      <div
        className="font-mono text-lg leading-none"
        style={{
          color,
          textShadow: `0 0 8px ${color}55`,
        }}
      >
        {value}
      </div>
    </div>
  );
}
