"use client";

import { useState } from "react";

type VerifyResult = {
  ok?: boolean;
  configured?: boolean;
  message?: string;
  tables?: Record<string, number>;
};

export function StorageVerifyPanel() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function verify() {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch("/api/storage/verify", { cache: "no-store" });
      const json = (await response.json()) as VerifyResult;
      setResult(json);
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Storage verification failed.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-black uppercase tracking-[0.16em] text-white">Verify Connection</h2>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-sm leading-6 text-[var(--muted)]">
          Run this after adding <span className="font-mono text-slate-300">DATABASE_URL</span>. It checks Neon and creates the public betting tables if needed.
        </p>
        <button
          type="button"
          onClick={verify}
          disabled={pending}
          className="w-full bg-[var(--accent)] px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white disabled:opacity-50 sm:w-auto"
        >
          {pending ? "Checking..." : "Verify Storage"}
        </button>

        {result ? (
          <div className={`border px-4 py-3 text-sm ${result.ok ? "border-green-500/35 bg-green-500/10 text-green-300" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
            <p className="font-bold">{result.message ?? (result.ok ? "Storage ready." : "Storage needs setup.")}</p>
            {result.tables ? (
              <div className="mt-3 grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
                {Object.entries(result.tables).map(([table, count]) => (
                  <div key={table} className="bg-[var(--surface)] px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-[var(--muted)]">{table}</p>
                    <p className="mt-1 text-sm font-black text-white">{count}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
