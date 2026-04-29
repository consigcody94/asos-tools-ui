import { NextResponse } from "next/server";
import { eonetEvents } from "@/lib/server/eonet";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam === "closed" || statusParam === "all" || statusParam === "open"
      ? statusParam
      : "open";
  const limit = parseInt(url.searchParams.get("limit") || "30", 10);
  const days = parseInt(url.searchParams.get("days") || "20", 10);
  const category = url.searchParams.get("category") || undefined;

  const events = await eonetEvents({ status, limit, days, category });
  return NextResponse.json({
    source: "NASA EONET v3",
    status,
    count: events.length,
    events,
  });
}
