/** GET /api/tsunami — active NTWC + PTWC bulletins. */

import { NextResponse } from "next/server";
import { fetchTsunamiBulletins } from "@/lib/server/tsunami";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await fetchTsunamiBulletins();
  return NextResponse.json({
    bulletins: rows,
    count: rows.length,
    fetched_at: new Date().toISOString(),
  });
}
