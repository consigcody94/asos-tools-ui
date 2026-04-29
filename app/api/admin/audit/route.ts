import { NextResponse } from "next/server";
import { recent } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const events = await recent(Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ count: events.length, events });
}
