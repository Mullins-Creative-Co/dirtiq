"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateAccountAction } from "@/app/actions";

export function AccountPickerForm() {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    setError(null);
    const result = await getOrCreateAccountAction(name.trim());
    setPending(false);
    if (result.error) {
      setError(result.error);
    } else {
      router.push(`/bet?name=${encodeURIComponent(name.trim())}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <input
        type="text"
        placeholder="Your name (e.g. BigMike)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
        maxLength={40}
        autoFocus
      />
      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-black text-black disabled:opacity-40 hover:opacity-90 active:scale-[.98] transition-all"
      >
        {pending ? "Loading…" : "Start Betting →"}
      </button>
    </form>
  );
}
