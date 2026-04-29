import { NextResponse } from "next/server";
import { SOURCES } from "@/lib/server/sources";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    SOURCES.map((source) => ({
      id: source.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      refresh: source.cadence,
      ...source,
    })),
  );
}
