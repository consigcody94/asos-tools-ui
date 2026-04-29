import { NextResponse } from "next/server";
import { fetchText } from "@/lib/server/fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IEM_BASE = process.env.IEM_API_BASE || "https://mesonet.agron.iastate.edu";
const MAX_DAYS = 30;

function dateParts(prefix: "1" | "2", d: Date): Record<string, string> {
  return {
    [`year${prefix}`]: String(d.getUTCFullYear()),
    [`month${prefix}`]: String(d.getUTCMonth() + 1),
    [`day${prefix}`]: String(d.getUTCDate()),
    [`hour${prefix}`]: String(d.getUTCHours()),
    [`minute${prefix}`]: String(d.getUTCMinutes()),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const station = (url.searchParams.get("station") || "").trim().toUpperCase();
  const daysRaw = Number(url.searchParams.get("days") || "7");
  const days = Math.min(MAX_DAYS, Math.max(1, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 7));

  if (!/^[KPT][A-Z0-9]{3,4}$/.test(station)) {
    return NextResponse.json({ error: "station must be a US ICAO such as KJFK" }, { status: 400 });
  }

  const end = new Date();
  end.setUTCHours(23, 59, 0, 0);
  const start = new Date(end.getTime() - days * 86_400_000);

  const text = await fetchText(`${IEM_BASE}/cgi-bin/request/asos1min.py`, {
    timeoutMs: 60_000,
    retries: 1,
    query: {
      station,
      vars: ["tmpf", "dwpf", "sknt", "drct", "gust", "alti", "mslp", "p01i", "vsby"],
      sample: "1min",
      what: "download",
      delim: "comma",
      ...dateParts("1", start),
      ...dateParts("2", end),
    },
  });

  if (!text) {
    return NextResponse.json(
      { error: "IEM did not return CSV; try again later after the upstream rate-limit window clears" },
      { status: 503 },
    );
  }

  return new NextResponse(text, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${station}-${days}day-1min.csv"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
