import { NextResponse } from "next/server";
import { fetchNews } from "@/lib/server/news";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "30", 10));
  const items = await fetchNews(limit);
  return NextResponse.json(items);
}
