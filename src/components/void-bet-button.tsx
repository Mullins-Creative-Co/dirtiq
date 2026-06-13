"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { voidBetAction } from "@/app/actions";

export function VoidBetButton({ betId }: { betId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleVoid() {
    if (!confirm("Void this bet?")) return;
    setPending(true);
    await voidBetAction(betId);
    setPending(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleVoid}
      disabled={pending}
      className="text-[10px] text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40"
    >
      {pending ? "…" : "void"}
    </button>
  );
}
