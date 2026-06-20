"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateAccountAction } from "@/app/actions";

export const ACCOUNT_NAME_KEY = "dirtiq:lastAccountName";

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
    const accountName = name.trim();
    const result = await getOrCreateAccountAction(accountName);
    setPending(false);
    if (result.error) {
      setError(result.error);
    } else {
      localStorage.setItem(ACCOUNT_NAME_KEY, accountName);
      router.push(`/bet?name=${encodeURIComponent(accountName)}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <input
        type="text"
        placeholder="Wallet name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-[var(--accent)] focus:outline-none"
        maxLength={40}
        autoFocus
      />
      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="w-full bg-[var(--accent)] py-3 text-sm font-black text-black disabled:opacity-40 hover:opacity-90 active:scale-[.98] transition-all"
      >
        {pending ? "Loading..." : name.trim() ? `Continue as ${name.trim()}` : "Open Wallet"}
      </button>
    </form>
  );
}
