/** POST /api/ai-brief
 *
 *  Generates a NOC shift-change briefing from the live scan + active
 *  hazards.  Powered by Azure OpenAI gpt-5-mini.  Pulls fresh context
 *  from the OWL backend and AWC right before generation, so the brief
 *  reflects the actual state at request time.
 *
 *  Body shape (optional): {focus?: string} — narrow to a region, e.g.
 *  "northeast US" or "Hawaii".
 */

import { NextResponse } from "next/server";
import { chat, chatStream } from "@/lib/openai";
import { getScan, getScanReady } from "@/lib/server/scan-cache";
import { fetchAirSigmet } from "@/lib/server/awc";
import { trackEvent, trackMetric } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ScanRow {
  station: string;
  status?: string;
  minutes_since_last_report?: number | null;
  probable_reason?: string | null;
}

interface AirSigmet {
  hazard?: string;
  airSigmetType?: string;
  rawAirSigmet?: string;
  validTimeFrom?: string;
  validTimeTo?: string;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let focus: string | undefined;
  let stream = false;
  try {
    const body = (await req.json().catch(() => ({}))) as { focus?: string; stream?: boolean };
    focus = body.focus;
    stream = !!body.stream;
  } catch { /* empty body OK */ }
  // Also honor ?stream=1 in the query string for easy curl tests.
  if (!stream) {
    const u = new URL(req.url);
    if (u.searchParams.get("stream") === "1") stream = true;
  }

  // Pull live context. Use the *cached* scan — getScanFresh() blocks
  // on a network fetch that can take 60+ seconds when IEM is in
  // rate-limit cooldown, which made the AI Brief button appear hung.
  // The scan cache is warm-restored at boot and refreshed every 15
  // min in the background; that's plenty fresh for a shift brief.
  await getScanReady().catch(() => null);
  const [scan, sigmetsRaw] = await Promise.all([
    Promise.resolve(getScan()),
    fetchAirSigmet().catch(() => [] as Array<Record<string, unknown>>),
  ]);
  const scanRows: ScanRow[] = (scan?.rows as unknown as ScanRow[]) || [];
  const sigmets: AirSigmet[] = sigmetsRaw.map((s) => ({
    hazard:         (s.hazard as string | undefined),
    airSigmetType:  (s.airSigmetType as string | undefined),
    rawAirSigmet:   (s.rawAirSigmet as string | undefined),
    validTimeFrom:  (s.validTimeFrom as string | undefined),
    validTimeTo:    (s.validTimeTo as string | undefined),
  }));

  // Tally per-status counts.
  const counts: Record<string, number> = {};
  for (const r of scanRows) {
    const s = (r.status || "NO DATA").toUpperCase();
    counts[s] = (counts[s] || 0) + 1;
  }

  // Top problem stations (worst-first).
  const order = ["MISSING", "FLAGGED", "INTERMITTENT"];
  const topProblems = scanRows
    .filter((r) => order.includes((r.status || "").toUpperCase()))
    .sort((a, b) => {
      const oa = order.indexOf((a.status || "").toUpperCase());
      const ob = order.indexOf((b.status || "").toUpperCase());
      if (oa !== ob) return oa - ob;
      return (a.minutes_since_last_report ?? 1e9) - (b.minutes_since_last_report ?? 1e9);
    })
    .slice(0, 25);

  // Hazard summary.
  const hazardCounts = new Map<string, number>();
  for (const h of sigmets) {
    const k = h.hazard || "OTHER";
    hazardCounts.set(k, (hazardCounts.get(k) || 0) + 1);
  }

  const sysPrompt =
    "Respond in English only. Do not use Chinese, Spanish, or any other " +
    "language regardless of the model's defaults.\n\n" +
    "You are an ASOS network operations briefer for the NOAA / FAA Automated " +
    "Surface Observing System. Write a concise NOC shift-change briefing " +
    "in exactly 3 short English paragraphs:\n" +
    "  1. NETWORK HEALTH (one paragraph): overall posture from the status counts.\n" +
    "  2. STATIONS NEEDING ATTENTION (one paragraph): cite the top 5 worst by ICAO with the probable_reason.\n" +
    "  3. AVIATION HAZARDS (one paragraph): summarise the active SIGMETs/AIRMETs by hazard type and urgency.\n" +
    "Be precise and operational. Use ICAO IDs verbatim. No marketing language. " +
    "Reference data freshness if it's stale. Output in English.";

  const userMsg =
    `Region focus: ${focus || "all (CONUS + AK + HI + PR/USVI)"}.\n\n` +
    `STATUS COUNTS:\n${JSON.stringify(counts)}\n\n` +
    `TOP PROBLEM STATIONS (worst first):\n` +
    topProblems
      .map(
        (r) =>
          `  ${r.station} ${r.status} ${r.minutes_since_last_report ?? "?"}min ${r.probable_reason || ""}`,
      )
      .join("\n") + "\n\n" +
    `ACTIVE HAZARDS (${sigmets.length}):\n` +
    Array.from(hazardCounts.entries())
      .map(([h, n]) => `  ${h}: ${n}`)
      .join("\n");

  // Streaming path — first token in ~2-3s instead of waiting ~30s
  // for the full generation. Uses Server-Sent Events with two event
  // types: `delta` (a token chunk) and `done` (final metadata).
  if (stream) {
    const encoder = new TextEncoder();
    const sse = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of chatStream(
            [
              { role: "system", content: sysPrompt },
              { role: "user", content: userMsg },
            ],
            { maxTokens: 1200, reasoningEffort: "low" },
          )) {
            // chatStream prefixes reasoning chunks with __OWL_THINKING__
            // so we can fan them out to a separate SSE event the
            // client renders dimmed.
            const thinking = chunk.startsWith("__OWL_THINKING__");
            const text = thinking ? chunk.slice("__OWL_THINKING__".length) : chunk;
            controller.enqueue(
              encoder.encode(
                `event: ${thinking ? "thinking" : "delta"}\ndata: ${JSON.stringify({ text })}\n\n`,
              ),
            );
          }
          const dt = Date.now() - t0;
          trackMetric("owl.ai_brief.duration_ms", dt);
          trackEvent("owl.ai_brief.generated", {
            focus: focus || "all",
            scan_rows: scanRows.length,
            sigmets: sigmets.length,
            duration_ms: dt,
            mode: "stream",
          });
          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({
                duration_ms: dt,
                context: {
                  scan_row_count: scanRows.length,
                  sigmet_count: sigmets.length,
                  counts,
                },
              })}\n\n`,
            ),
          );
        } catch (err) {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`),
          );
        } finally {
          controller.close();
        }
      },
    });
    return new Response(sse, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // Non-streaming path (kept for backward compat + scripted callers).
  const text = await chat(
    [
      { role: "system", content: sysPrompt },
      { role: "user", content: userMsg },
    ],
    { maxTokens: 1200, reasoningEffort: "low" },
  );

  const dt = Date.now() - t0;
  trackMetric("owl.ai_brief.duration_ms", dt);
  trackEvent("owl.ai_brief.generated", {
    focus: focus || "all",
    scan_rows: scanRows.length,
    sigmets: sigmets.length,
    duration_ms: dt,
  });

  return NextResponse.json({
    ok: true,
    text,
    context: {
      scan_row_count: scanRows.length,
      sigmet_count: sigmets.length,
      counts,
    },
    duration_ms: dt,
  });
}
