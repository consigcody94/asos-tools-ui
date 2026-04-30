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

/** Async iterator over content chunks from an OpenAI-compatible
 *  streaming response. Each yielded string is the delta — *not* the
 *  cumulative text — so the caller appends to a running buffer. */
export async function* chatStream(
  messages: ChatMsg[],
  opts: ChatOpts = {},
): AsyncGenerator<string, void, void> {
  if ((!OPENAI_BASE || !OPENAI_KEY) && (!AZURE_ENDPOINT || !AZURE_KEY)) {
    yield "AI Brief is not configured on this deployment. " +
      "Set OPENAI_BASE_URL + OPENAI_API_KEY or AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY.";
    return;
  }
  const azure = Boolean(AZURE_ENDPOINT && AZURE_KEY && !OPENAI_BASE);
  const url = azure
    ? `${AZURE_ENDPOINT}/openai/deployments/${encodeURIComponent(DEPLOYMENT)}/chat/completions?api-version=${API_VERSION}`
    : `${OPENAI_BASE}/chat/completions`;

  const isGpt5 = DEPLOYMENT.startsWith("gpt-5");
  const body: Record<string, unknown> = { messages, model: DEPLOYMENT, stream: true };
  if (isGpt5) {
    body.max_completion_tokens = opts.maxTokens ?? 4000;
    body.reasoning_effort = opts.reasoningEffort ?? "low";
  } else {
    body.max_tokens = opts.maxTokens ?? 4000;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
  }
  if (azure) delete body.model;

  const ctrl = opts.signal ? null : new AbortController();
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 60_000) : null;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(azure ? { "api-key": AZURE_KEY } : { Authorization: `Bearer ${OPENAI_KEY}` }),
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? ctrl!.signal,
    });
    if (!r.ok || !r.body) {
      const txt = await r.text().catch(() => "");
      yield `AI Brief upstream error (status ${r.status}): ${txt.slice(0, 160)}`;
      return;
    }
    // OpenAI-compatible SSE: each "event" is a `data: {...}\n\n` line.
    // The terminating sentinel is `data: [DONE]`.
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Split on the SSE event separator (\n\n).
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = obj.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* malformed chunk — skip */
        }
      }
    }
  } catch (err) {
    yield `AI Brief stream failed: ${(err as Error).message}`;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  // Default 45 s wall-clock so the AI Brief can't hang the route. The
  // caller can pass a longer signal explicitly if it really wants.
  const ctrl = opts.signal ? null : new AbortController();
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 45_000) : null;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(azure ? { "api-key": AZURE_KEY } : { Authorization: `Bearer ${OPENAI_KEY}` }),
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? ctrl!.signal,
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
  } finally {
    if (timer) clearTimeout(timer);
  }
}
