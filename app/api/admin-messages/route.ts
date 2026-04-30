/** GET /api/admin-messages — latest NCEP SDM administrative bulletin.
 *
 *  Backed by lib/server/nws-admin.ts (NOUS42 KWNO / ADASDM product).
 *  Used by the OWL ops banner to surface NWS-wide system advisories
 *  the moment NCEP's Senior Duty Meteorologist issues them — exactly
 *  the same way every NWS office monitors network-wide outages.
 */

import { NextResponse } from "next/server";
import { getLatestAdminMessage } from "@/lib/server/nws-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const msg = await getLatestAdminMessage();
  return NextResponse.json({
    message: msg,
    fetched_at: new Date().toISOString(),
  });
}
