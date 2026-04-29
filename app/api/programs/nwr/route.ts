import { NextResponse } from "next/server";
import { nwrOutages } from "@/lib/server/nwr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const rows = await nwrOutages();
  // Default: only return non-UP transmitters (the operational signal).
  // Pass ?all=1 to get the full ~1000-transmitter catalog.
  const projected = all ? rows : rows.filter((r) => r.status !== "UP");
  return NextResponse.json({
    source: "weather.gov/source/nwr/JS/ccl-data.js",
    total_in_catalog: rows.length,
    count: projected.length,
    rows: projected,
  });
}
