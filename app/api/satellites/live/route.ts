import { NextResponse } from "next/server";
import { liveSatellites } from "@/lib/server/orbits";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET() {
  const satellites = await liveSatellites();
  return NextResponse.json({
    source: "CelesTrak GP + SGP4",
    count: satellites.length,
    updated_at: new Date().toISOString(),
    satellites,
  });
}
