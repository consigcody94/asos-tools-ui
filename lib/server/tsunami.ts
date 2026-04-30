/** NWS Tsunami Warning Center bulletins (PTWC + NTWC).
 *
 *  Two warning centers issue all US tsunami products:
 *    - Pacific Tsunami Warning Center (PTWC) in Honolulu, HI
 *    - National Tsunami Warning Center (NTWC) in Palmer, AK
 *      (covers US/Canada Pacific + Atlantic + Caribbean + Gulf)
 *
 *  Both publish Atom feeds at tsunami.gov, free, no auth, near
 *  real-time. We aggregate active products from both feeds for the
 *  Hazards tab.
 *
 *  Reference:
 *    https://www.tsunami.gov/?page=apipage
 *    https://www.tsunami.gov/events/xml/PAAQAtomAll.xml   (NTWC)
 *    https://www.tsunami.gov/events/xml/PHEBAtomAll.xml   (PTWC)
 *
 *  Cache: 2 minutes — these feeds tick rarely outside an active
 *  event, but during one we want to surface fresh bulletins fast.
 */

import { fetchText } from "./fetcher";

const FEEDS: Array<{ id: "NTWC" | "PTWC"; url: string; aor: string }> = [
  {
    id: "NTWC",
    url: "https://www.tsunami.gov/events/xml/PAAQAtomAll.xml",
    aor: "US/Canada Pacific, Atlantic, Caribbean, Gulf of Mexico",
  },
  {
    id: "PTWC",
    url: "https://www.tsunami.gov/events/xml/PHEBAtomAll.xml",
    aor: "Pacific Basin (Hawaii AOR)",
  },
];

export interface TsunamiBulletin {
  id: string;
  center: "NTWC" | "PTWC";
  area_of_responsibility: string;
  title: string;
  summary: string;
  link: string;
  issued: string;       // ISO timestamp
  /** "advisory" | "watch" | "warning" | "information statement" — extracted from title. */
  level: "info" | "advisory" | "watch" | "warning" | "unknown";
}

let _cache: { at: number; rows: TsunamiBulletin[] } | null = null;
const TTL_MS = 2 * 60 * 1000;

function levelFromTitle(t: string): TsunamiBulletin["level"] {
  const u = t.toUpperCase();
  if (u.includes("WARNING")) return "warning";
  if (u.includes("WATCH")) return "watch";
  if (u.includes("ADVISORY")) return "advisory";
  if (u.includes("INFORMATION")) return "info";
  return "unknown";
}

/** Tiny Atom parser: pulls <entry> blocks out of a feed and extracts
 *  id/title/summary/link/updated. Avoids a full XML library — Atom
 *  feeds from tsunami.gov are flat and predictable. */
function parseAtom(xml: string, center: "NTWC" | "PTWC", aor: string): TsunamiBulletin[] {
  const out: TsunamiBulletin[] = [];
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/g) ?? [];
  for (const entry of entries) {
    const id = entry.match(/<id>([^<]*)<\/id>/)?.[1] ?? "";
    const title = decode(entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const summary = decode(entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "");
    const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
    const updated = entry.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? "";
    if (!id || !title) continue;
    out.push({
      id,
      center,
      area_of_responsibility: aor,
      title: title.trim(),
      summary: summary.replace(/\s+/g, " ").trim().slice(0, 600),
      link,
      issued: updated,
      level: levelFromTitle(title),
    });
  }
  return out;
}

function decode(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Fetch all currently-active tsunami bulletins from NTWC + PTWC. */
export async function fetchTsunamiBulletins(): Promise<TsunamiBulletin[]> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.rows;
  const merged: TsunamiBulletin[] = [];
  for (const f of FEEDS) {
    try {
      const xml = await fetchText(f.url, { timeoutMs: 8_000, retries: 1 });
      if (!xml) continue;
      merged.push(...parseAtom(xml, f.id, f.aor));
    } catch (err) {
      console.warn(`[tsunami] ${f.id} failed:`, (err as Error).message);
    }
  }
  // Newest-first by issued date.
  merged.sort((a, b) => b.issued.localeCompare(a.issued));
  _cache = { at: Date.now(), rows: merged };
  return merged;
}
