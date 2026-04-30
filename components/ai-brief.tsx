"use client";

/** AI Brief — modal-style panel that calls /api/ai-brief and streams
 *  the generated text into a copyable block. Powered by whichever
 *  OpenAI-compatible model is configured in /etc/owl.env (currently
 *  GLM-5.1 via Ollama Cloud) against live OWL scan + AWC SIGMETs.
 */

import { useState } from "react";
import { Sparkles, Copy, X } from "lucide-react";

export function AiBrief() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  // Reasoning chain-of-thought from GLM-5.1, streamed before the
  // visible answer starts. Rendered dimmed so the operator sees
  // SOMETHING is happening during the ~20 s "thinking" phase.
  const [thinking, setThinking] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setText("");
    setThinking("");
    setErr(null);
    const t0 = performance.now();
    try {
      // Request streaming response. Server returns text/event-stream
      // with `event: delta` (token chunks) and `event: done` (final
      // metadata). We append deltas to the buffer as they arrive so
      // the user sees the brief materialise like a typewriter.
      const r = await fetch("/api/ai-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      if (!r.ok || !r.body) {
        setErr(`request failed (${r.status})`);
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      let thinkAcc = "";
      let lastEvent = "delta";
      // Read SSE chunks. Each event is a `event: NAME\ndata: JSON\n\n`
      // block. We split on the double-newline separator, keep the
      // tail in the buffer until the next chunk completes it.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const lines = evt.split("\n");
          let evtName = "delta";
          let dataLine = "";
          for (const ln of lines) {
            if (ln.startsWith("event:")) evtName = ln.slice(6).trim();
            else if (ln.startsWith("data:")) dataLine = ln.slice(5).trim();
          }
          if (!dataLine) continue;
          lastEvent = evtName;
          try {
            const obj = JSON.parse(dataLine);
            if (evtName === "delta" && typeof obj.text === "string") {
              acc += obj.text;
              setText(acc);
            } else if (evtName === "thinking" && typeof obj.text === "string") {
              // GLM-5.1 reasoning chain — keep last ~600 chars so
              // the user sees a live ticker without an unbounded
              // scroll-buster.
              thinkAcc = (thinkAcc + obj.text).slice(-600);
              setThinking(thinkAcc);
            } else if (evtName === "done") {
              const dt = obj.duration_ms ?? Math.round(performance.now() - t0);
              setDuration(dt);
            } else if (evtName === "error") {
              setErr(obj.error ?? "stream error");
            }
          } catch {
            /* skip malformed event */
          }
        }
      }
      // If the stream closed without a `done` event, still record the
      // wall-clock duration so the operator gets useful feedback.
      if (lastEvent !== "done") setDuration(Math.round(performance.now() - t0));
      // Final-blank rescue: if streaming ended with zero content tokens
      // AND no error AND no thinking content, the upstream silently
      // produced nothing. Show a clear failure message rather than a
      // blank modal — this is what the user previously hit when GLM
      // exhausted its budget on reasoning.
      if (!acc && !thinkAcc) {
        setErr("AI Brief: upstream returned no content. Click Regenerate to retry.");
      } else if (!acc && thinkAcc) {
        setErr(
          "AI Brief: model reasoned for " +
          Math.round(performance.now() - t0) / 1000 +
          "s but produced no final brief. Click Regenerate to retry.",
        );
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); if (!text) generate(); }}
        className="noc-btn noc-btn-primary flex items-center gap-2"
      >
        <Sparkles size={14} />
        Generate AI Brief
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="noc-panel max-w-3xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-display text-2xl text-noc-cyan tracking-wide drop-shadow-[0_0_10px_rgba(0,229,255,0.45)]">
                  AI BRIEF · NOC SHIFT CHANGE
                </div>
                <div className="noc-label text-[0.65rem] mt-1">
                  GLM-5.1 via Ollama Cloud &middot; live scan + active SIGMETs &middot; not human-reviewed
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-noc-dim hover:text-noc-cyan p-1"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Pre-stream skeleton: ONLY visible if neither thinking
                nor real text has started arriving (the first 1-3 s). */}
            {loading && !text && !thinking && (
              <div className="py-8 text-center">
                <div className="noc-light noc-light-warn inline-block" />
                <span className="noc-label text-noc-warn">
                  Connecting to GLM-5.1...
                </span>
              </div>
            )}

            {/* GLM-5.1 reasoning ticker: shown only while we're still
                in the thinking phase (no real content yet). Dimmed to
                signal "this is the model working, not the answer". */}
            {loading && !text && thinking && (
              <div className="bg-noc-deep/50 border border-noc-border/50 p-3 mb-3">
                <div className="noc-label text-[0.6rem] mb-1 text-noc-amber">
                  thinking…
                </div>
                <div className="font-mono text-[0.7rem] leading-relaxed text-noc-dim whitespace-pre-wrap max-h-32 overflow-hidden">
                  {thinking}
                </div>
              </div>
            )}

            {err && (
              <div className="bg-noc-deep border-l-2 border-noc-crit p-3 text-noc-crit text-sm font-mono">
                <div>{err}</div>
                {!text && (
                  <button
                    onClick={generate}
                    disabled={loading}
                    className="noc-btn flex items-center gap-2 text-xs mt-3 disabled:opacity-50"
                  >
                    <Sparkles size={12} /> Retry
                  </button>
                )}
              </div>
            )}

            {/* Render incrementally: once `text` has any content we
                show it even while still streaming, with a blinking
                cursor at the end so it's clear more is coming. */}
            {text && (
              <>
                <pre className="font-body text-sm leading-relaxed text-noc-text bg-noc-deep border border-noc-border p-4 whitespace-pre-wrap mb-4">
                  {text}
                  {loading && <span className="ml-1 inline-block w-2 h-4 bg-noc-cyan align-middle animate-pulse" />}
                </pre>
                <div className="flex justify-between items-center">
                  <span className="text-[0.7rem] text-noc-dim font-mono">
                    {loading
                      ? "streaming..."
                      : duration !== null ? `generated in ${(duration / 1000).toFixed(1)} s` : ""}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={copy} disabled={loading} className="noc-btn flex items-center gap-2 text-xs disabled:opacity-50">
                      <Copy size={12} /> Copy
                    </button>
                    <button onClick={generate} disabled={loading} className="noc-btn flex items-center gap-2 text-xs disabled:opacity-50">
                      <Sparkles size={12} /> Regenerate
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
