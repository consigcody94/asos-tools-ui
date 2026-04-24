import { NextResponse } from "next/server";
import { fetchAfd } from "@/lib/server/awc";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const cwa = new URL(req.url).searchParams.get("cwa") || "";
  if (!cwa) return NextResponse.json({ error: "cwa required" }, { status: 400 });
  const out = await fetchAfd(cwa);
  if (!out) return NextResponse.json({ error: "AFD not available" }, { status: 404 });
  return NextResponse.json(out);
}
