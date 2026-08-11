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
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-white placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
        maxLength={40}
        autoFocus
      />
      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="btn-accent w-full py-3 text-sm font-extrabold uppercase tracking-wide"
      >
        {pending ? "Loading..." : name.trim() ? `Continue as ${name.trim()}` : "Open Wallet"}
      </button>
    </form>
  );
}
