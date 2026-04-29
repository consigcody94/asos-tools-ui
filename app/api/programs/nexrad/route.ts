import { NextResponse } from "next/server";
import { nexradOutages } from "@/lib/server/nexrad-outages";

export const runtime = "nodejs";
export const revalidate = 900; // 15 min

export async function GET() {
  const rows = await nexradOutages();
  return NextResponse.json({ source: "weather.gov/nl2/NEXRADView", count: rows.length, rows });
}
