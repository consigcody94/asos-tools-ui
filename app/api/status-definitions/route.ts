/** GET /api/status-definitions — single source of truth for status meanings.
 *
 *  The Admin tab + drill panel + status legend all consume this.
 *  Defining once, server-side, prevents the docs from drifting out of
 *  sync with what the classifier actually does. */

import { NextResponse } from "next/server";
import { STATUS_LIST } from "@/lib/server/status-definitions";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({ definitions: STATUS_LIST });
}
