/** GET /api/station/[id]/metar — latest decoded METAR for a station.
 *
 *  Prefers the already-computed scan cache (the most-recent report we
 *  pulled from IEM during the last full-network sweep). If that row is
 *  absent, falls back to a single-station 2-hour fetch via IEM so the
 *  drill panel still works for freshly-added or skipped stations.
 */

import { NextResponse } from "next/server";
import { aomcById } from "@/lib/server/stations";
import { getCachedScan } from "@/lib/server/scan-cache";
import { fetchRecentMetars } from "@/lib/server/iem";
import { decodeMetar } from "@/lib/server/metar-decode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const up = id.trim().toUpperCase();
  const station = aomcById(up);
  if (!station) {
    return NextResponse.json({ error: `unknown station ${up}` }, { status: 404 });
  }

  // 1) Try scan cache first.
  const scan = getCachedScan();
  if (scan) {
    const row = scan.rows.find((r) => r.station === up);
    if (row?.last_metar) {
      return NextResponse.json({
        station: { id: station.id, name: station.name, lat: station.lat, lon: station.lon, state: station.state },
        source: "scan_cache",
        scanned_at: scan.scanned_at,
        status: row.status,
        decoded: decodeMetar(row.last_metar),
      });
    }
  }

  // 2) Fallback: single-station fresh fetch.
  try {
    const rows = await fetchRecentMetars([station.id], 2);
    if (rows.length === 0) {
      return NextResponse.json({
        station: { id: station.id, name: station.name, lat: station.lat, lon: station.lon, state: station.state },
        source: "iem_live",
        decoded: null,
        error: "no METAR available in last 2h",
      }, { status: 404 });
    }
    rows.sort((a, b) => (a.valid < b.valid ? 1 : -1));
    const latest = rows[0];
    return NextResponse.json({
      station: { id: station.id, name: station.name, lat: station.lat, lon: station.lon, state: station.state },
      source: "iem_live",
      decoded: decodeMetar(latest.metar),
    });
  } catch (e) {
    return NextResponse.json({
      station: { id: station.id, name: station.name, lat: station.lat, lon: station.lon, state: station.state },
      source: "iem_live",
      decoded: null,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 502 });
  }
}
