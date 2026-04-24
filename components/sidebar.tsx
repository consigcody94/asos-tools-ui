"use client";

/** Persistent left rail — brand, nav, author credit.
 *  Uses Next.js `usePathname` so the active tab is reflected in the URL.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, Globe, Info, MapPin, Settings, Cloud,
} from "lucide-react";
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
        w-[240px] shrink-0 h-dvh sticky top-0
        border-r border-[color:var(--color-border)]
        bg-[color:var(--color-surface)]
        flex flex-col
      "
    >
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 border-b border-[color:var(--color-border)]">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-white font-semibold text-sm"
            style={{ background: "var(--color-accent-strong)" }}
            aria-hidden
          >
            O
          </div>
          <div>
            <div className="text-[0.95rem] font-semibold leading-tight text-[color:var(--color-fg)]">
              OWL
            </div>
            <div className="text-[0.62rem] tracking-[0.1em] uppercase text-[color:var(--color-fg-muted)] leading-tight">
              Observation Watch Log
            </div>
          </div>
        </div>
      </div>

      {/* Network pulse (compact) */}
      {pulse && (
        <div className="px-5 py-3 border-b border-[color:var(--color-border)]">
          <div className="noc-h3 mb-2 text-[0.62rem]">Network Pulse</div>
          <div className="grid grid-cols-3 gap-1.5">
            <PulseCell label="Clean"   value={pulse.clean}   tone="ok"   />
            <PulseCell label="Flagged" value={pulse.flagged} tone="warn" />
            <PulseCell label="Missing" value={pulse.missing} tone="crit" />
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
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
                "flex items-center gap-2.5 px-3 py-1.5 rounded-md",
                "text-[0.85rem] font-medium transition-colors",
                active
                  ? "bg-[color:var(--color-accent-soft)] text-[color:var(--color-fg)]"
                  : "text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-fg)]",
              )}
            >
              <Icon
                size={15}
                strokeWidth={1.75}
                className={active ? "text-[color:var(--color-accent)]" : ""}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Author credit — replaces the HF link. */}
      <div className="px-5 py-4 border-t border-[color:var(--color-border)]">
        <div className="text-[0.68rem] leading-relaxed text-[color:var(--color-fg-dim)]">
          Made by{" "}
          <a
            href="mailto:cto@sentinelowl.org"
            className="text-[color:var(--color-accent)] hover:text-[color:var(--color-fg)] font-medium transition-colors"
          >
            Cody Churchwell
          </a>
          <br/>
          CTO, Sentinel OWL
        </div>
        <div className="mt-2 text-[0.62rem] text-[color:var(--color-fg-dim)]">
          v2.0.0 ·{" "}
          <a
            href="https://github.com/consigcody94/asos-tools-ui"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[color:var(--color-fg-muted)]"
          >
            source
          </a>
        </div>
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
      ? "var(--color-ok)"
      : tone === "warn"
        ? "var(--color-warn)"
        : "var(--color-crit)";
  return (
    <div className="bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] px-2 py-1.5 rounded">
      <div
        className="text-[0.56rem] uppercase tracking-[0.08em] mb-0.5 font-semibold"
        style={{ color }}
      >
        {label}
      </div>
      <div
        className="font-mono text-[0.95rem] leading-none font-medium"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}
