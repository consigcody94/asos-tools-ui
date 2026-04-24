import { NextResponse } from "next/server";
import { SOURCES } from "@/lib/server/sources";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(SOURCES);
}
