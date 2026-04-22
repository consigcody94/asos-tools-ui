"use client";

/** Bottom-of-page auto-scrolling news ticker.
 *
 *  Pulls aggregated NOAA / FAA / NTSB / AWC headlines from the OWL
 *  backend (HF Space) `/api/news` endpoint when available, otherwise
 *  shows a small set of operator-relevant fallback links.  No CSS
 *  marquee — uses CSS keyframes on a duplicated strip for seamless
 *  loop (same trick the Streamlit edition uses).
 */

import { useEffect, useState } from "react";
import { OWL_API_BASE } from "@/lib/api";
import { Radio } from "lucide-react";

interface Item {
  source: string;
  title: string;
  link: string;
}

const FALLBACK: Item[] = [
  { source: "NWS",  title: "Aviation Weather Center — current SIGMETs / AIRMETs", link: "https://aviationweather.gov" },
  { source: "FAA",  title: "FAA Newsroom & advisories",                            link: "https://www.faa.gov/newsroom" },
  { source: "NCEI", title: "NCEI — Climate Data Online",                            link: "https://www.ncei.noaa.gov/cdo-web/" },
  { source: "NWS",  title: "api.weather.gov — current alerts feed",                 link: "https://api.weather.gov/alerts/active" },
  { source: "NTSB", title: "NTSB Aviation accident reports",                         link: "https://www.ntsb.gov/investigations" },
  { source: "FAA",  title: "FAA WeatherCams portal",                                link: "https://weathercams.faa.gov" },
  { source: "NESDIS", title: "NESDIS GOES-19 imagery",                              link: "https://www.star.nesdis.noaa.gov/GOES" },
  { source: "SWPC", title: "NOAA Space Weather Prediction Center",                  link: "https://www.swpc.noaa.gov" },
];

export function NewsTicker() {
  const [items, setItems] = useState<Item[]>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    fetch(`${OWL_API_BASE}/api/news?limit=24`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const arr: Item[] = Array.isArray(d) ? d : (d.items || d.headlines || []);
        if (Array.isArray(arr) && arr.length > 0) {
          setItems(
            arr
              .filter((x) => x && x.title && x.link)
              .map((x) => ({
                source: x.source || "—",
                title: x.title,
                link: x.link,
              })),
          );
        }
      })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, []);

  // Duplicate the strip for seamless animation: animate -50% so item N+1
  // arrives exactly where item 1 was when the loop wraps.
  const dup = [...items, ...items];

  return (
    <div className="
      owl-ticker-track
      fixed left-[260px] right-0 bottom-0 h-8 z-40
      bg-[linear-gradient(90deg,rgba(11,18,32,0.95)_0%,rgba(15,26,48,0.90)_50%,rgba(11,18,32,0.95)_100%)]
      border-t border-noc-cyan-dim shadow-[0_-4px_18px_rgba(0,229,255,0.06)]
      backdrop-blur-sm overflow-hidden
    ">
      {/* Live-feed badge pinned left */}
      <div className="
        absolute left-0 top-0 bottom-0 w-[88px] z-10
        flex items-center justify-center gap-1
        bg-gradient-to-r from-noc-cyan to-noc-cyan-dim
        text-noc-deep font-display font-bold text-[10px]
        uppercase tracking-[0.22em]
        shadow-[0_0_12px_rgba(0,229,255,0.55)]
      ">
        <Radio size={10} /> LIVE FEED
      </div>

      <div
        className="
          owl-ticker-strip
          flex items-center h-full whitespace-nowrap gap-7 pl-[100px]
          will-change-transform
        "
      >
        {dup.map((it, i) => (
          <a
            key={i}
            href={it.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-noc-text hover:text-noc-cyan font-body text-xs tracking-wide flex items-center gap-2 shrink-0"
          >
            <span className="
              text-noc-cyan border border-noc-cyan-dim px-1.5 py-0.5
              text-[9px] uppercase tracking-[0.12em] font-display font-bold
            ">
              {it.source}
            </span>
            {it.title}
          </a>
        ))}
      </div>
    </div>
  );
}
