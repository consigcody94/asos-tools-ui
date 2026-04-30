/** GET /api/ncei-status — published maintenance window state.
 *
 *  Used by the UI to render a banner during scheduled NCEI outages so
 *  operators understand why cross-check counts may be paused. Driven
 *  off the env-configurable window in lib/server/ncei.ts; defaults to
 *  the published Apr 30 2026 window (06:00–12:00 ET).
 */

import { NextResponse } from "next/server";
import { getNceiMaintenanceStatus } from "@/lib/server/ncei";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getNceiMaintenanceStatus());
}
