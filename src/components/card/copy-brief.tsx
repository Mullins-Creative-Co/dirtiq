"use client";

import { useState } from "react";

/** Copies the agent instructions followed by the card JSON, ready to paste into any assistant. */
export function CopyBrief({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="btn-accent px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em]"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setState("copied"); } catch { setState("failed"); }
        window.setTimeout(() => setState("idle"), 2500);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed: select the text below" : label}
    </button>
  );
}
