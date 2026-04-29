import { NextResponse } from "next/server";
import {
  GOVERNMENT_API_ATLAS,
  GITHUB_MODERNIZATION_QUEUE,
  NOAA_PROGRAM_COVERAGE,
  REPORTING_PRODUCTS,
  atlasCounts,
} from "@/lib/server/noaa-atlas";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    counts: atlasCounts(),
    sources: GOVERNMENT_API_ATLAS,
    github: GITHUB_MODERNIZATION_QUEUE,
    reports: REPORTING_PRODUCTS,
    coverage: NOAA_PROGRAM_COVERAGE,
  });
}
