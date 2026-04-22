/** Azure OpenAI client (server-only, REST-based — no SDK dep).
 *
 *  Uses the GA chat-completions API on a deployment named via
 *  AZURE_OPENAI_DEPLOYMENT (default "gpt-5-mini").  Endpoint comes
 *  from AZURE_OPENAI_ENDPOINT.  Key from AZURE_OPENAI_KEY.
 *
 *  When env is unset (local dev), the helper returns a graceful
 *  "AI Brief is not configured" string instead of throwing.
 */

import { trackException, trackMetric } from "./telemetry";

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/+$/, "");
const KEY = process.env.AZURE_OPENAI_KEY || "";
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini";
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
  if (!ENDPOINT || !KEY) {
    return (
      "AI Brief is not configured on this deployment. " +
      "Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY env vars to enable."
    );
  }

  const url =
    `${ENDPOINT}/openai/deployments/${encodeURIComponent(DEPLOYMENT)}/chat/completions` +
    `?api-version=${API_VERSION}`;

  // gpt-5 family models are reasoning models — they spend tokens on
  // internal thinking BEFORE emitting visible content.  We need a
  // generous max_completion_tokens budget AND an explicit low
  // reasoning_effort so the budget isn't fully consumed by reasoning.
  // The non-reasoning models (gpt-4o etc.) silently ignore these
  // extra fields.
  const body: Record<string, unknown> = {
    messages,
    max_completion_tokens: opts.maxTokens ?? 4000,
    reasoning_effort: opts.reasoningEffort ?? "low",
  };
  // gpt-5 series doesn't accept temperature param; only set when
  // we're talking to a non-reasoning model.
  if (!DEPLOYMENT.startsWith("gpt-5") && opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }

  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": KEY,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    const dt = Date.now() - t0;
    trackMetric("owl.ai.chat.latency_ms", dt);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      trackException(new Error(`Azure OpenAI ${r.status}: ${txt.slice(0, 200)}`));
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
