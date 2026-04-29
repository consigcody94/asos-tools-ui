import { NextResponse } from "next/server";
import { flushScanCache, getScan } from "@/lib/server/scan-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  flushScanCache();
  getScan();
  return NextResponse.json({
    ok: true,
    flushed_at: new Date().toISOString(),
    refresh: "started",
  });
}
