"use client";

/** Stations table — searchable, sortable, fast.
 *
 *  918 rows is small enough that we don't need a virtualizer; the
 *  whole list renders in a single overflow-auto box.  Search is a
 *  case-insensitive substring match across ICAO + name + state +
 *  operator + IATA.  Sort toggles ascending/descending per column.
 *
 *  When clicked, a row deep-links to the Summary tab with the station
 *  pre-selected (Phase 7.5 — uses URL query params).
 */

import { useMemo, useState } from "react";
import { Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { type Station } from "@/lib/data/stations";
import { displayOperator } from "@/lib/data/operator-display";

type SortKey = "id" | "name" | "state" | "operator" | "lat" | "lon" | "elev_ft";

interface Props {
  stations: Station[];
}

export function StationsTable({ stations }: Props) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = stations;
    if (q) {
      rows = stations.filter((s) => {
        return (
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.state.toLowerCase().includes(q) ||
          // Search both raw and displayed forms so users can type
          // "noaa" or "suad" and find the em-dash-flagged stations.
          (s.operator.toLowerCase().includes(q) ||
            displayOperator(s.operator).toLowerCase().includes(q)) ||
          (s.iata || "").toLowerCase().includes(q) ||
          (s.wmo || "").toLowerCase().includes(q)
        );
      });
    }
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let c: number;
      if (typeof av === "number" && typeof bv === "number") c = av - bv;
      else c = String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? c : -c;
    });
    return rows;
  }, [stations, query, sortKey, sortDir]);

  function setSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="noc-panel">
      {/* Search bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xl">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-noc-dim"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ICAO / IATA / WMO / name / state / operator..."
            className="
              w-full pl-9 pr-3 py-2
              bg-noc-deep border border-noc-border-strong
              text-noc-text font-mono text-sm tracking-wide
              focus:border-noc-cyan focus:outline-none
              focus:shadow-[0_0_0_1px_var(--color-noc-cyan),0_0_12px_rgba(0,229,255,0.25)]
              placeholder:text-noc-dim placeholder:font-body placeholder:tracking-normal
            "
          />
        </div>
        <div className="text-xs font-mono text-noc-dim tabular-nums whitespace-nowrap">
          <span className="text-noc-cyan">{filtered.length}</span> / {stations.length}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto max-h-[70vh] border border-noc-border">
        <table className="w-full text-sm font-mono">
          <thead className="sticky top-0 bg-noc-elevated z-10">
            <tr>
              <Th label="ICAO"     k="id"       cur={sortKey} dir={sortDir} onClick={setSort} mono />
              <Th label="Name"     k="name"     cur={sortKey} dir={sortDir} onClick={setSort} />
              <Th label="State"    k="state"    cur={sortKey} dir={sortDir} onClick={setSort} mono />
              <Th label="Operator" k="operator" cur={sortKey} dir={sortDir} onClick={setSort} />
              <Th label="Lat"      k="lat"      cur={sortKey} dir={sortDir} onClick={setSort} mono right />
              <Th label="Lon"      k="lon"      cur={sortKey} dir={sortDir} onClick={setSort} mono right />
              <Th label="Elev (ft)" k="elev_ft" cur={sortKey} dir={sortDir} onClick={setSort} mono right />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, idx) => (
              <tr
                key={s.id}
                className={`
                  ${idx % 2 === 0 ? "bg-noc-deep" : "bg-noc-panel"}
                  hover:bg-[rgba(0,229,255,0.05)]
                  border-t border-noc-border
                  transition-colors
                `}
              >
                <td className="px-3 py-1.5 text-noc-cyan font-bold tabular-nums">
                  {s.id}
                </td>
                <td className="px-3 py-1.5 text-noc-text font-body">{s.name}</td>
                <td className="px-3 py-1.5 text-noc-muted">{s.state}</td>
                <td className="px-3 py-1.5 text-noc-muted font-body uppercase tracking-wider text-[0.7rem]">
                  {displayOperator(s.operator)}
                </td>
                <td className="px-3 py-1.5 text-noc-dim text-right tabular-nums">
                  {s.lat?.toFixed(4)}
                </td>
                <td className="px-3 py-1.5 text-noc-dim text-right tabular-nums">
                  {s.lon?.toFixed(4)}
                </td>
                <td className="px-3 py-1.5 text-noc-dim text-right tabular-nums">
                  {s.elev_ft ?? "—"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-noc-muted">
                  No stations match{" "}
                  <span className="text-noc-cyan">
                    &ldquo;{query}&rdquo;
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  label, k, cur, dir, onClick, mono = false, right = false,
}: {
  label: string;
  k: SortKey;
  cur: SortKey;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  mono?: boolean;
  right?: boolean;
}) {
  const active = cur === k;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      onClick={() => onClick(k)}
      className={`
        px-3 py-2 text-[0.7rem] font-display font-bold uppercase tracking-[0.16em]
        cursor-pointer select-none border-b border-noc-border-strong
        ${active ? "text-noc-cyan" : "text-noc-muted hover:text-noc-text"}
        ${right ? "text-right" : "text-left"}
        ${mono ? "" : ""}
      `}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon size={11} className="opacity-70" />
      </span>
    </th>
  );
}
