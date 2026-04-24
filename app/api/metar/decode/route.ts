/** GET /api/metar/decode?m=<raw-metar>
 *  POST /api/metar/decode  (body: {metar} or {metars: [...]})
 *
 *  Returns the decoded METAR structure described in
 *  lib/server/metar-decode.ts. Accepts either a single METAR via GET
 *  query param, or one-or-many via POST body.
 */

import { NextResponse } from "next/server";
import { decodeMetar } from "@/lib/server/metar-decode";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("m");
  if (!raw) {
    return NextResponse.json(
      { error: "query param `m` required, e.g. ?m=KJFK+241451Z+27015KT+10SM+FEW250+22/12+A2983" },
      { status: 400 },
    );
  }
  return NextResponse.json(decodeMetar(raw));
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }

  if (typeof body === "object" && body !== null) {
    const b = body as { metar?: string; metars?: string[] };
    if (Array.isArray(b.metars)) {
      return NextResponse.json(b.metars.map((m) => decodeMetar(m)));
    }
    if (typeof b.metar === "string") {
      return NextResponse.json(decodeMetar(b.metar));
    }
  }
  return NextResponse.json(
    { error: "body must be {metar: string} or {metars: string[]}" },
    { status: 400 },
  );
}
