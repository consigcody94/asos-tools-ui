import { NextResponse } from "next/server";
import { nwrOutages } from "@/lib/server/nwr";

export const runtime = "nodejs";
export const revalidate = 1800; // 30 min

export async function GET() {
  const rows = await nwrOutages();
  return NextResponse.json({ source: "weather.gov/nwr/outages", count: rows.length, rows });
}
