"use client";

/** AI Brief — modal-style panel that calls /api/ai-brief and streams
 *  the generated text into a copyable block.  Powered by Azure OpenAI
 *  gpt-5-mini against live OWL scan + AWC SIGMETs.
 */

import { useState } from "react";
import { Sparkles, Copy, X } from "lucide-react";

export function AiBrief() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setText("");
    setErr(null);
    try {
      const r = await fetch("/api/ai-brief", { method: "POST" });
      const d = await r.json();
      if (!r.ok || !d?.text) {
        setErr(d?.text || `request failed (${r.status})`);
      } else {
        setText(d.text);
        setDuration(d.duration_ms || null);
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
                  Azure OpenAI gpt-5-mini &middot; live scan + active SIGMETs &middot; not human-reviewed
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

            {loading && (
              <div className="py-8 text-center">
                <div className="noc-light noc-light-warn inline-block" />
                <span className="noc-label text-noc-warn">
                  Generating brief from live scan + hazards...
                </span>
              </div>
            )}

            {err && (
              <div className="bg-noc-deep border-l-2 border-noc-crit p-3 text-noc-crit text-sm font-mono">
                {err}
              </div>
            )}

            {text && (
              <>
                <pre className="font-body text-sm leading-relaxed text-noc-text bg-noc-deep border border-noc-border p-4 whitespace-pre-wrap mb-4">
                  {text}
                </pre>
                <div className="flex justify-between items-center">
                  <span className="text-[0.7rem] text-noc-dim font-mono">
                    {duration !== null ? `generated in ${(duration / 1000).toFixed(1)} s` : ""}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={copy} className="noc-btn flex items-center gap-2 text-xs">
                      <Copy size={12} /> Copy
                    </button>
                    <button onClick={generate} className="noc-btn flex items-center gap-2 text-xs">
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
