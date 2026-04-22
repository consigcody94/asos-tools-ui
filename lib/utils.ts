import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard className combiner.  Tailwind-aware so duplicate utilities
 *  resolve to the right one (e.g. `cn("p-2", "p-4")` => `"p-4"`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number with tabular-nums-friendly thousands separator. */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

/** Pad a number to N digits as a string ("003"). */
export function pad(n: number, width: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(width, "0");
}

/** Compact ISO 8601 in UTC (e.g. "2026-04-21T05:14:32Z"). */
export function isoUtc(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}
