import { NextResponse } from "next/server";
import { flushScanCache, getScan } from "@/lib/server/scan-cache";
import { record } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  flushScanCache();
  getScan();
  const flushed_at = new Date().toISOString();
  const actor = req.headers.get("x-forwarded-user") ?? "operator";
  await record("scan-cache.flush", null, { source: "admin-ui" }, actor);
  return NextResponse.json({ ok: true, flushed_at, refresh: "started" });
}
