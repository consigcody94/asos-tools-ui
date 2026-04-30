/** POST /api/ai-brief
 *
 *  Generates a structured NOC shift-change briefing from the full live
 *  operating picture: ASOS scan + CAP alerts + SIGMETs + G-AIRMETs +
 *  CWAs + NHC tropical storms + Tsunami bulletins + NIFC wildfires +
 *  NCEP SDM admin messages + NCEI maintenance state.
 *
 *  Body params (all optional):
 *    focus       — region tag ("northeast", "southeast", "west",
 *                  "hawaii", "alaska", or arbitrary free text passed
 *                  to the model). Default: full network.
 *    audience    — "noc" (default) | "field-tech" | "management" |
 *                  "aviation" — adjusts technical depth.
 *    horizon     — "now" (default) | "6h" | "24h" — prediction window.
 *    length      — "summary" | "standard" (default) | "detailed".
 *    compareToLast — boolean (default true) — include delta vs the
 *                    most-recent prior brief in this process.
 *    stream      — boolean — Server-Sent Events streaming.
 *
 *  Response: structured prose with consistent section ordering so
 *  operators can scan in 5 seconds. Sections:
 *    EXECUTIVE SUMMARY  · NETWORK HEALTH  · URGENT — STATIONS UNDER
 *    ACTIVE WEATHER  · INTERMITTENT (FLAPPING)  · TOP PROBLEM
 *    STATIONS  · AVIATION HAZARDS  · ACTIVE ALERTS  · TROPICAL ·
 *    WILDFIRES & TSUNAMI · DELTA SINCE LAST BRIEF · DATA FRESHNESS ·
 *    TICKETS TO OPEN
 *
 *  Powered by GPT-5 mini (Azure OpenAI / Ollama Cloud / OpenAI). Streaming
 *  delivers first token in ~2-3s vs ~30s for the full generation.
 */

import { NextResponse } from "next/server";
import { chat, chatStream } from "@/lib/openai";
import {
  buildAiBriefContext,
  computeBriefDelta,
  type AiBriefContext,
  type BriefDelta,
} from "@/lib/server/ai-brief-context";
import { trackEvent, trackMetric } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Audience = "noc" | "field-tech" | "management" | "aviation";
type Horizon = "now" | "6h" | "24h";
type Length = "summary" | "standard" | "detailed";

interface BriefBody {
  focus?: string;
  audience?: Audience;
  horizon?: Horizon;
  length?: Length;
  compareToLast?: boolean;
  stream?: boolean;
}

// ---- System prompt builder ------------------------------------------------
//
// Centralised so streaming + non-streaming paths share the exact same
// instructions. Every section is named so the LLM produces a stable
// document shape across runs.

function buildSystemPrompt(audience: Audience, horizon: Horizon, length: Length): string {
  const audienceGuide: Record<Audience, string> = {
    noc:
      "You are an ASOS Network Operations Center (NOC) shift briefer. " +
      "Audience: 24/7 ops engineers triaging the ASOS network. They " +
      "expect ICAO codes verbatim, terse operational language, and " +
      "specific action items. No marketing language.",
    "field-tech":
      "You are an ASOS field-maintenance dispatch briefer. Audience: " +
      "regional field technicians who own physical site repairs. " +
      "Emphasize sensor codes (PWINO, FZRANO, RVRNO etc.), priority " +
      "ranking by impact + accessibility, and ticket-ready summaries.",
    management:
      "You are an ASOS Network executive summary writer. Audience: " +
      "non-technical management who need to understand network posture " +
      "without aviation jargon. Translate ICAO IDs to airport names " +
      "and convert technical issues to operational impact.",
    aviation:
      "You are an aviation weather briefer. Audience: airline dispatch " +
      "and air traffic flow management. Emphasize SIGMETs, G-AIRMETs, " +
      "CWAs, and the airports (by ICAO) where station outages affect " +
      "flight ops. Skip non-aviation hazards.",
  };

  const horizonGuide: Record<Horizon, string> = {
    now: "Time horizon: current state. Describe what is happening now.",
    "6h":
      "Time horizon: next 6 hours. Project trajectory based on current " +
      "patterns — which stations are likely to escalate, which hazards are " +
      "likely to clear, what should be watched.",
    "24h":
      "Time horizon: next 24 hours. Identify systemic risks (incoming " +
      "tropical activity, sustained drought-fire-wind alignment, multi-day " +
      "outages worth scheduling field response).",
  };

  const lengthGuide: Record<Length, string> = {
    summary:
      "Length: 4-6 sentences total. Hit only the most-critical items. " +
      "Skip empty sections entirely.",
    standard:
      "Length: 1-2 paragraphs per section, only including sections with " +
      "non-trivial data. Skip empty sections.",
    detailed:
      "Length: full structured brief, all sections present even when " +
      "empty (note 'no active items' in those). 3-4 sentences per section.",
  };

  return [
    "Respond in English only. Do not switch languages.",
    "",
    audienceGuide[audience],
    "",
    horizonGuide[horizon],
    "",
    lengthGuide[length],
    "",
    "ALWAYS use the exact section headers below as bold or all-caps. ",
    "Order: EXECUTIVE SUMMARY · NETWORK HEALTH · URGENT (STATIONS UNDER ACTIVE WEATHER) · ",
    "INTERMITTENT (FLAPPING) · TOP PROBLEM STATIONS · AVIATION HAZARDS · ACTIVE ALERTS · ",
    "TROPICAL · WILDFIRES & TSUNAMI · DELTA SINCE LAST BRIEF · DATA FRESHNESS · TICKETS TO OPEN.",
    "",
    "RULES:",
    "- Use ICAO IDs verbatim. Don't translate to airport names unless audience=management.",
    "- For each cited station, include a one-clause reason: \"KSEA INTERMITTENT (3-hour comm gap, just recovered)\".",
    "- Never invent data not present in the context.",
    "- Caveat data freshness using the stale_sources array verbatim.",
    "- Section TICKETS TO OPEN: each line is a single actionable ticket — \"Field tech: investigate PWINO at KAVL\" etc.",
    "- Skip a section ENTIRELY when length=summary or standard and that section has no data.",
  ].join("\n");
}

// ---- Context → user-message JSON ------------------------------------------

function buildUserMessage(
  ctx: AiBriefContext,
  delta: BriefDelta | null,
  body: BriefBody,
): string {
  const blocks: string[] = [];

  blocks.push(
    `META: built_at=${ctx.built_at}, scan_age_min=${ctx.scan_freshness.minutes_old ?? "?"}, ` +
      `total_stations=${ctx.total_stations}, focus=${body.focus ?? "all"}, ` +
      `audience=${body.audience ?? "noc"}, horizon=${body.horizon ?? "now"}, ` +
      `length=${body.length ?? "standard"}.`,
  );
  blocks.push(`STATUS_COUNTS: ${JSON.stringify(ctx.status_counts)}`);

  if (ctx.top_problems.length > 0) {
    blocks.push("TOP_PROBLEM_STATIONS:");
    for (const p of ctx.top_problems) {
      blocks.push(
        `  ${p.station} ${p.status} ${p.minutes_since_last_report ?? "?"}min ` +
          (p.inside_active_alert ? `[URGENT: ${p.overlapping_alerts.join(",")}] ` : "") +
          `${p.probable_reason ?? ""}`,
      );
    }
  }

  if (ctx.intermittent_stations.length > 0) {
    blocks.push(
      "INTERMITTENT_STATIONS (SUAD-spec — flapping pattern, 3+ MISSING " +
        "metars then recovery):",
    );
    for (const r of ctx.intermittent_stations) {
      blocks.push(
        `  ${r.station} log=[${r.state_log_summary}] last=${r.minutes_since_last_report ?? "?"}min`,
      );
    }
  }

  // Long-missing alert — > 2 weeks silent. Every entry must appear in
  // the brief; no slicing. The model should call out each one in the
  // "URGENT" section with explicit duration so field dispatch can
  // route response.
  if (ctx.long_missing_alert.length > 0) {
    blocks.push(
      `LONG_MISSING_ALERT (silent > 14 days — every entry MUST appear in URGENT section):`,
    );
    for (const r of ctx.long_missing_alert) {
      blocks.push(
        `  ${r.station} ${r.state ?? ""} silent=${r.silence_human} last_valid=${r.last_valid ?? "?"} ${r.probable_reason ?? ""}`,
      );
    }
  }

  if (ctx.cap_alerts.total > 0) {
    blocks.push(
      `ACTIVE_ALERTS: ${ctx.cap_alerts.total} total · by event:\n` +
        ctx.cap_alerts.by_event
          .map((e) => `  ${e.event} (${e.severity}): ${e.count}`)
          .join("\n"),
    );
    if (ctx.cap_alerts.sample.length > 0) {
      blocks.push(
        "ALERT_SAMPLES:\n" +
          ctx.cap_alerts.sample
            .map((a) => `  ${a.event} (${a.severity}): ${a.headline}`)
            .join("\n"),
      );
    }
  }

  if (ctx.aviation.sigmet_count + ctx.aviation.gairmet_count + ctx.aviation.cwa_count > 0) {
    blocks.push(
      `AVIATION_HAZARDS: ${ctx.aviation.sigmet_count} SIGMETs · ` +
        `${ctx.aviation.gairmet_count} G-AIRMETs · ${ctx.aviation.cwa_count} CWAs`,
    );
    if (ctx.aviation.sigmet_by_hazard.length > 0) {
      blocks.push(
        "  by hazard: " +
          ctx.aviation.sigmet_by_hazard
            .map((h) => `${h.hazard}=${h.count}`)
            .join(", "),
      );
    }
  }

  if (ctx.tropical_storms.length > 0) {
    blocks.push("TROPICAL_STORMS:");
    for (const s of ctx.tropical_storms) {
      blocks.push(
        `  ${s.name} ${s.classification} ${s.intensity_kt}kt ${s.pressure_mb}mb ${s.movement}`,
      );
    }
  }

  if (ctx.tsunami.length > 0) {
    blocks.push("TSUNAMI_BULLETINS:");
    for (const t of ctx.tsunami) {
      blocks.push(`  ${t.center} ${t.level.toUpperCase()}: ${t.title}`);
    }
  }

  if (ctx.wildfires.length > 0) {
    blocks.push("WILDFIRES (top 8 by acreage):");
    for (const f of ctx.wildfires) {
      blocks.push(
        `  ${f.name} ${f.state} acres=${f.acres ?? "?"} containment=${f.containment_pct ?? "?"}% ${f.status ?? ""}`,
      );
    }
  }

  if (ctx.admin_message) {
    blocks.push(
      `NCEP_SDM_ADMIN: issued=${ctx.admin_message.issued}\n  ${ctx.admin_message.preview}`,
    );
  }

  if (ctx.ncei_maintenance.active) {
    blocks.push(`NCEI_MAINTENANCE_ACTIVE: ${ctx.ncei_maintenance.message}`);
  }

  if (delta) {
    const dStr = Object.entries(delta.count_delta)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`)
      .join(", ");
    blocks.push(
      `DELTA_SINCE_LAST: ` +
        `newly_problem=[${delta.newly_problem.slice(0, 12).join(",")}] ` +
        `recovered=[${delta.recovered.slice(0, 12).join(",")}] ` +
        `count_changes={${dStr}}`,
    );
  }

  if (ctx.stale_sources.length > 0) {
    blocks.push(`STALE_SOURCES: ${ctx.stale_sources.join(", ")}`);
  }

  return blocks.join("\n\n");
}

// ---- Route handler --------------------------------------------------------

export async function POST(req: Request) {
  const t0 = Date.now();
  let body: BriefBody = {};
  try {
    body = (await req.json().catch(() => ({}))) as BriefBody;
  } catch { /* empty body OK */ }
  const u = new URL(req.url);
  if (u.searchParams.get("stream") === "1") body.stream = true;

  const audience: Audience = body.audience ?? "noc";
  const horizon: Horizon = body.horizon ?? "now";
  const length: Length = body.length ?? "standard";
  const compareToLast = body.compareToLast !== false;

  const ctx = await buildAiBriefContext(body.focus);
  const delta = compareToLast ? computeBriefDelta(ctx) : null;

  const sysPrompt = buildSystemPrompt(audience, horizon, length);
  const userMsg = buildUserMessage(ctx, delta, body);

  // Streaming path — first token in ~2-3s. Same SSE events as before
  // (delta / thinking / done) so existing client code continues working.
  if (body.stream) {
    const encoder = new TextEncoder();
    const sse = new ReadableStream({
      async start(controller) {
        let contentTokens = 0;
        let thinkingTokens = 0;
        try {
          for await (const chunk of chatStream(
            [
              { role: "system", content: sysPrompt },
              { role: "user", content: userMsg },
            ],
            // 6000 tokens — bigger budget for the structured brief.
            // GLM-5.1 still has reasoning overhead; 6k gives both reasoning
            // and 12-section brief room to breathe.
            { maxTokens: 6000, reasoningEffort: "low" },
          )) {
            const thinking = chunk.startsWith("__OWL_THINKING__");
            const text = thinking ? chunk.slice("__OWL_THINKING__".length) : chunk;
            if (thinking) thinkingTokens += text.length;
            else contentTokens += text.length;
            controller.enqueue(
              encoder.encode(
                `event: ${thinking ? "thinking" : "delta"}\ndata: ${JSON.stringify({ text })}\n\n`,
              ),
            );
          }
          if (contentTokens === 0) {
            const fallback =
              "AI Brief: the model produced reasoning but no final brief " +
              "(common when it overflows its context budget on chain-of-thought). " +
              `Reasoning length: ~${thinkingTokens} chars. ` +
              "Click Regenerate to retry; if this keeps happening, lower the " +
              "reasoning budget or switch models in /etc/owl.env.";
            controller.enqueue(
              encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: fallback })}\n\n`),
            );
          }
          const dt = Date.now() - t0;
          trackMetric("owl.ai_brief.duration_ms", dt);
          trackEvent("owl.ai_brief.generated", {
            focus: body.focus || "all",
            audience, horizon, length,
            scan_rows: ctx.total_stations,
            sigmet_count: ctx.aviation.sigmet_count,
            cap_count: ctx.cap_alerts.total,
            duration_ms: dt,
            mode: "stream",
            content_tokens: contentTokens,
            thinking_tokens: thinkingTokens,
            stale_sources: ctx.stale_sources.length,
          });
          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({
                duration_ms: dt,
                content_tokens: contentTokens,
                thinking_tokens: thinkingTokens,
                context: {
                  total_stations: ctx.total_stations,
                  status_counts: ctx.status_counts,
                  cap_count: ctx.cap_alerts.total,
                  sigmet_count: ctx.aviation.sigmet_count,
                  tropical_count: ctx.tropical_storms.length,
                  tsunami_count: ctx.tsunami.length,
                  fires_count: ctx.wildfires.length,
                  stale_sources: ctx.stale_sources,
                  has_delta: delta != null,
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
    { maxTokens: 6000, reasoningEffort: "low" },
  );

  const dt = Date.now() - t0;
  trackMetric("owl.ai_brief.duration_ms", dt);
  trackEvent("owl.ai_brief.generated", {
    focus: body.focus || "all",
    audience, horizon, length,
    scan_rows: ctx.total_stations,
    sigmet_count: ctx.aviation.sigmet_count,
    cap_count: ctx.cap_alerts.total,
    duration_ms: dt,
    stale_sources: ctx.stale_sources.length,
  });

  return NextResponse.json({
    ok: true,
    text,
    context: {
      total_stations: ctx.total_stations,
      status_counts: ctx.status_counts,
      cap_count: ctx.cap_alerts.total,
      sigmet_count: ctx.aviation.sigmet_count,
      tropical_count: ctx.tropical_storms.length,
      tsunami_count: ctx.tsunami.length,
      fires_count: ctx.wildfires.length,
      stale_sources: ctx.stale_sources,
      has_delta: delta != null,
    },
    delta,
    duration_ms: dt,
  });
}
