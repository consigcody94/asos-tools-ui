"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/** Header pill: "Next refresh in NN s" countdown.
 *  Operators want the visual cadence — even if the data updates via SSE,
 *  the timer shows that the system is alive. */
export function RefreshTimer({ intervalSeconds = 60 }: { intervalSeconds?: number }) {
  const [secondsLeft, setSecondsLeft] = useState(intervalSeconds);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setRefreshing(true);
          // Simulate a brief "refreshing" flash matched to the SSE cadence.
          setTimeout(() => setRefreshing(false), 800);
          return intervalSeconds;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [intervalSeconds]);

  return (
    <div className="flex items-center gap-1.5 font-mono text-[0.66rem] text-[color:var(--color-fg-muted)]">
      <Clock size={11} className="text-[color:var(--color-accent)]" />
      <span>
        {refreshing ? (
          <span className="text-[color:var(--color-ok)]">refreshing…</span>
        ) : (
          <>next refresh <span className="text-[color:var(--color-fg)]">{secondsLeft}s</span></>
        )}
      </span>
    </div>
  );
}

/** Header pill: "Last updated" relative time. */
export function LastUpdated({ at }: { at: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const txt = at ? formatAge(now, at) : "never";
  return (
    <div className="flex items-center gap-1.5 font-mono text-[0.66rem] text-[color:var(--color-fg-muted)]">
      <span>last updated</span>
      <span className="text-[color:var(--color-fg)]">{txt}</span>
    </div>
  );
}

function formatAge(now: number, iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
