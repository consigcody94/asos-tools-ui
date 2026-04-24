import { NextResponse } from "next/server";
import { spaceWeatherSummary } from "@/lib/server/swpc";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await spaceWeatherSummary());
}
