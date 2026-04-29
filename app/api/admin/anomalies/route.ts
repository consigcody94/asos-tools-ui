import { NextResponse } from "next/server";
import { findings, tick } from "@/lib/server/anomaly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Recompute on demand. Cheap (bounded by station count * WINDOW).
  tick();
  return NextResponse.json(findings());
}
