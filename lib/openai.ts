/** OpenAI-compatible chat client (server-only, REST-based — no SDK dep).
 *
 *  Supports:
 *    - OPENAI_BASE_URL + OPENAI_API_KEY + AI_BRIEF_MODEL
 *    - Azure OpenAI via AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY
 *
 *  When env is unset (local dev), the helper returns a graceful
 *  "AI Brief is not configured" string instead of throwing.
 */

import { trackException, trackMetric } from "./telemetry";

const OPENAI_BASE = (process.env.OPENAI_BASE_URL || "").replace(/\/+$/, "");
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const AZURE_ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/+$/, "");
const AZURE_KEY = process.env.AZURE_OPENAI_KEY || "";
const DEPLOYMENT = process.env.AI_BRIEF_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || "2024-10-21";

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** gpt-5 family only: 'minimal' | 'low' | 'medium' | 'high'.
   *  Lower = fewer reasoning tokens consumed before visible output. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

export async function chat(messages: ChatMsg[], opts: ChatOpts = {}): Promise<string> {
  if ((!OPENAI_BASE || !OPENAI_KEY) && (!AZURE_ENDPOINT || !AZURE_KEY)) {
    return (
      "AI Brief is not configured on this deployment. " +
      "Set OPENAI_BASE_URL + OPENAI_API_KEY or AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY."
    );
  }

  const azure = Boolean(AZURE_ENDPOINT && AZURE_KEY && !OPENAI_BASE);
  const url = azure
    ? `${AZURE_ENDPOINT}/openai/deployments/${encodeURIComponent(DEPLOYMENT)}/chat/completions?api-version=${API_VERSION}`
    : `${OPENAI_BASE}/chat/completions`;

  // gpt-5 reasoning models accept `reasoning_effort` and require
  // `max_completion_tokens`. Everything else (gpt-4o, Ollama, Azure
  // OpenAI 4.x, Anthropic via gateways, vLLM, etc.) takes `max_tokens`
  // and silently 400s on `reasoning_effort` — so gate those fields on
  // the model name.
  const isGpt5 = DEPLOYMENT.startsWith("gpt-5");
  const body: Record<string, unknown> = {
    messages,
    model: DEPLOYMENT,
  };
  if (isGpt5) {
    body.max_completion_tokens = opts.maxTokens ?? 4000;
    body.reasoning_effort = opts.reasoningEffort ?? "low";
  } else {
    body.max_tokens = opts.maxTokens ?? 4000;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
  }
  if (azure) delete body.model;

  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(azure ? { "api-key": AZURE_KEY } : { Authorization: `Bearer ${OPENAI_KEY}` }),
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    const dt = Date.now() - t0;
    trackMetric("owl.ai.chat.latency_ms", dt);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      const provider = azure ? "Azure OpenAI" : "OpenAI-compat";
      trackException(new Error(`${provider} ${r.status}: ${txt.slice(0, 200)}`));
      return `AI Brief temporarily unavailable (status ${r.status}).`;
    }
    const data = await r.json();
    const text: string =
      data?.choices?.[0]?.message?.content?.toString() ?? "";
    return text.trim() || "AI Brief returned empty content.";
  } catch (e) {
    trackException(e);
    return "AI Brief failed — see Application Insights for details.";
  }
}
