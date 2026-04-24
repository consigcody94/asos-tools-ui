/** GET /api/ready — liveness + readiness probe.
 *
 *  Returns 200 as soon as the Next.js server is accepting requests.
 *  Intentionally does NOT touch the scan cache, IEM, or any external
 *  upstream — ACA's readiness probe must return within ~5s or the
 *  replica is marked Unavailable.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "owl-ui",
    now: new Date().toISOString(),
  });
}
