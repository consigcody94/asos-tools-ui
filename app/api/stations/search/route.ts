import { NextResponse } from "next/server";
import { searchStations } from "@/lib/server/stations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "20", 10));
  return NextResponse.json(searchStations(q, limit));
}
