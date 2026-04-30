"use client";

/** Persistent left rail — brand, nav, author credit.
 *  Uses Next.js `usePathname` so the active tab is reflected in the URL.
 */

import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, Globe, Info, MapPin, Settings, Cloud, Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: typeof Globe }[] = [
  { href: "/",            label: "Summary",     icon: Globe },
  { href: "/aomc",        label: "AOMC",        icon: Activity },
  { href: "/forecasters", label: "Forecasters", icon: Cloud },
  { href: "/noaa",        label: "NOAA Atlas",  icon: Database },
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
        w-full sm:w-[240px] shrink-0 sm:h-dvh sm:sticky sm:top-0 z-40
        border-b sm:border-b-0 sm:border-r border-[color:var(--color-border)]
        bg-[color:var(--color-surface)]
        flex flex-col
      "
    >
      {/* Brand — animated video logo (mark + name composited inline). */}
      <div className="px-3 py-2 sm:px-5 sm:pt-5 sm:pb-4 border-b border-[color:var(--color-border)]">
        <BrandLogo size={180} className="mx-auto sm:mx-0" alt="OWL — Observation Watch Log" />
      </div>

      {/* Network pulse (compact) */}
      {pulse && (
        <div className="hidden sm:block px-5 py-3 border-b border-[color:var(--color-border)]">
          <div className="noc-h3 mb-2 text-[0.62rem]">Network Pulse</div>
          <div className="grid grid-cols-3 gap-1.5">
            <PulseCell label="Clean"   value={pulse.clean}   tone="ok"   />
            <PulseCell label="Flagged" value={pulse.flagged} tone="warn" />
            <PulseCell label="Missing" value={pulse.missing} tone="crit" />
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="sm:flex-1 px-2 py-1.5 sm:py-3 sm:space-y-0.5 sm:overflow-y-auto flex flex-nowrap overflow-x-auto sm:block gap-1">
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
                "flex items-center gap-2 px-2.5 py-1.5 sm:gap-2.5 sm:px-3 rounded-md shrink-0",
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
      <div className="hidden sm:block px-5 py-4 border-t border-[color:var(--color-border)]">
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
